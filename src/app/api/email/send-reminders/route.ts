import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  reminderTemplate,
  evaluationReminderTemplate,
  overdueManagerTemplate,
} from "@/lib/email-templates";
import { filterNotifyUsers, placeMuteKeys, unmutedRows } from "@/lib/notify-prefs";
import { isDoneStatus, getBoardStatuses, type StatusOption } from "@/lib/board-items-shared";
import { remindPolicyAssignmentsDue } from "@/lib/policy-remind";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { HAS_ASSIGNEE, isSweepTask, liveInWorkspace, sweepBoards, taskPeople, type SweepPerson } from "@/lib/reminder-sweep";
import type { Prisma } from "@/generated/prisma";

// WHO GETS THESE. Live workspaces only (TRIAL, ACTIVE): a suspended or
// cancelled company's people cannot sign in, and every job here used to
// email them anyway (queueEmail now refuses them too). Live people only: not
// removed, not deactivated.
//
// HOW MUCH. Every read is per workspace, and each workspace is read in full,
// a page at a time: one capped slice across every customer covered only the
// companies with the oldest rows, and a capped slice inside one workspace
// did the same to its managers whose team's work was newer. A digest shows
// the 50 oldest lines and says how many there are. Done tasks are left out by
// the read itself (each List's own done values), so finished work never
// fills a page.
//
// WHOSE MANAGER. A digest names one workspace's work, so it goes only to a
// manager who is in that workspace (anchored there, or a member): a person's
// manager is one field for every workspace they work in, and a client
// workspace's task titles used to reach the manager in the agency.
//
// WHICH TASKS (src/lib/reminder-sweep.ts, docs-found fixes batch 3). Tasks
// only: never a meeting's Item on the hidden Meetings List (a meeting's
// creator got a "Task Due Today" row per meeting, and their manager's
// Monday email listed every meeting they ever made, private titles
// included). Only in a List people can still see: not archived, not under an
// archived Space or Folder. Every assignee hears of a task, not only the
// first, and only a live person in this workspace.
const LIVE_ORG = { status: { in: ["TRIAL", "ACTIVE"] as Array<"TRIAL" | "ACTIVE"> } };
const LIVE_PERSON = { deletedAt: null, status: { not: "INACTIVE" as const } };
/** Rows read at a time. */
const PAGE = 1000;
/** Lines in one manager's digest (the oldest first). */
const PER_DIGEST = 50;

/**
 * Every row of a read, a page at a time, so no workspace is cut at a fixed
 * number of rows. Keyset paging on the last row's own values, held here (the
 * read turns `last` into "after it" in its order): a cursor re-reads the last
 * row from the database, so a row that changed between two pages could end
 * the read early or lose a row.
 */
type PageRow = { id: string; dueAt?: Date | null; dueDate?: Date | null };

async function eachPage<T extends PageRow>(
  read: (page: { take: number; last: PageRow | null }) => Promise<T[]>,
  onPage: (rows: T[]) => Promise<void> | void,
): Promise<void> {
  let last: PageRow | null = null;
  for (;;) {
    const rows: T[] = await read({ take: PAGE, last });
    if (rows.length > 0) await onPage(rows);
    if (rows.length < PAGE) return;
    last = rows[rows.length - 1];
  }
}

/** "After this row" in an order of (a date, then id). */
function afterRow(field: "dueAt" | "dueDate", last: PageRow | null) {
  if (!last) return [];
  const at = last[field];
  if (!at) return [{ id: { gt: last.id } }];
  return [{ OR: [{ [field]: { gt: at } }, { [field]: at, id: { gt: last.id } }] }];
}

type DigestLine = { type: string; title: string; personName: string; daysOverdue: number };
type DigestManager = { id: string; email: string; firstName: string };
type ManagerFacts = DigestManager & { deletedAt: Date | null; status: string; organizationId: string; organizationMemberships: Array<{ id: string }> };

/** The manager fields a digest needs, with whether they are in `organizationId`. */
function managerSelect(organizationId: string) {
  return {
    select: {
      id: true, email: true, firstName: true, deletedAt: true, status: true, organizationId: true,
      organizationMemberships: { where: { organizationId }, select: { id: true } },
    },
  } as const;
}

/** A live manager who is in this workspace, or null. */
function digestManager(m: ManagerFacts | null | undefined, organizationId: string): DigestManager | null {
  if (!m || m.deletedAt || m.status === "INACTIVE") return null;
  if (m.organizationId !== organizationId && m.organizationMemberships.length === 0) return null;
  return { id: m.id, email: m.email, firstName: m.firstName };
}

/** Lines kept per manager (the oldest, as rows arrive oldest first) and every line counted. */
class Digests {
  readonly byManager = new Map<string, { mgr: DigestManager; items: DigestLine[]; total: number }>();
  add(mgr: DigestManager, line: DigestLine) {
    const e = this.byManager.get(mgr.id) ?? { mgr, items: [], total: 0 };
    e.total += 1;
    if (e.items.length < PER_DIGEST) e.items.push(line);
    this.byManager.set(mgr.id, e);
  }
}

async function liveWorkspaceIds(): Promise<string[]> {
  return (await prisma.organization.findMany({ where: LIVE_ORG, select: { id: true } })).map((o) => o.id);
}

/**
 * A workspace's Lists, and the filter that leaves their done rows out in the
 * read: each List's own done values (a status whose group is not ACTIVE),
 * grouped so Lists that share a set share one condition. isDoneStatus still
 * runs on what comes back, for statuses no List lists (the name heuristic).
 */
async function openItemsOf(organizationId: string): Promise<{ statuses: Map<string, StatusOption[]>; where: Prisma.ItemWhereInput }> {
  // The live Lists only (reminder-sweep.ts sweepBoards): the hidden Meetings
  // List and every List in an archived place are left out of the read, as
  // `statuses` is the set the rows are checked against afterwards.
  const [allBoards, spaces, folders] = await Promise.all([
    prisma.board.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, statuses: true, archivedAt: true, spaceId: true, folderId: true, settings: true, itemType: true },
    }),
    prisma.space.findMany({ where: { organizationId }, select: { id: true, parentSpaceId: true, archivedAt: true } }),
    prisma.folder.findMany({ where: { organizationId }, select: { id: true, parentFolderId: true, spaceId: true, archivedAt: true } }),
  ]);
  const boards = sweepBoards(allBoards, spaces, folders);
  const statuses = new Map(boards.map((b) => [b.id, getBoardStatuses(b)]));
  const groups = new Map<string, { boardIds: string[]; done: string[] }>();
  for (const b of boards) {
    const done = (statuses.get(b.id) ?? []).filter((o) => o.group !== "ACTIVE").map((o) => o.value).sort();
    const key = done.join("\u0000");
    const g = groups.get(key) ?? { boardIds: [], done };
    g.boardIds.push(b.id);
    groups.set(key, g);
  }
  const where: Prisma.ItemWhereInput = {
    organizationId,
    ...NOT_SYSTEM_ITEMS,
    OR: [...groups.values()].map((g) => ({ boardId: { in: g.boardIds }, OR: [{ status: null }, { status: { notIn: g.done } }] })),
  };
  return { statuses, where };
}

/** A row the read returned that is an open task on a live List (the read's own rules, checked again on what came back). */
function openTask(open: { statuses: Map<string, StatusOption[]> }, r: { boardId: string; status: string | null; itemType?: string | null }): boolean {
  const own = open.statuses.get(r.boardId);
  return own !== undefined && isSweepTask(r) && !isDoneStatus(own, r.status);
}

/** The people a page of tasks names, live and in this workspace, with what a sweep needs of them. */
function personSelect(organizationId: string) {
  return {
    id: true, email: true, firstName: true, lastName: true, deletedAt: true, status: true, organizationId: true,
    organizationMemberships: { where: { organizationId }, select: { id: true } },
  } as const;
}

// Triggered by cron: 1st of month (monthly-evaluation, kpi-recording) + every Monday (overdue, policy-ack)
// Authorization: Bearer CRON_SECRET
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const { type } = await req.json().catch(() => ({ type: "all" }));
  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  const results: string[] = [];
  const now = new Date();

  // ──────────────────────────────────────
  // 1. MONTHLY EVALUATION REMINDERS (1st of month)
  // Send to every manager who has direct reports
  // ──────────────────────────────────────
  if (type === "all" || type === "monthly-evaluation") {
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const lastMonth = monthNames[now.getMonth() === 0 ? 11 : now.getMonth() - 1];
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const managers = await prisma.user.findMany({
      where: { ...LIVE_PERSON, directReports: { some: { ...LIVE_PERSON, organization: LIVE_ORG } } },
      select: {
        id: true, email: true, firstName: true,
        directReports: { where: { ...LIVE_PERSON, organization: LIVE_ORG }, select: { firstName: true, lastName: true, organizationId: true } },
      },
    });

    // One reminder per manager and company, tagged with the company whose
    // people it names (a manager's reports can sit in more than one), so it
    // goes with that company when it is deleted for good.
    const reminders = managers.flatMap((mgr) => {
      const byCompany = new Map<string, string[]>();
      for (const r of mgr.directReports) {
        byCompany.set(r.organizationId, [...(byCompany.get(r.organizationId) ?? []), `${r.firstName} ${r.lastName}`]);
      }
      return [...byCompany].map(([organizationId, names]) => ({ mgr, organizationId, names }));
    });
    await Promise.all(
      reminders.map(({ mgr, organizationId, names }) => {
        const { subject, html } = evaluationReminderTemplate({
          managerName: mgr.firstName,
          teamMembers: names,
          month: `${lastMonth} ${year}`,
          evaluationLink: `${baseUrl}/kra-kpi`,
        });
        return sendEmail({ to: mgr.email, subject, html, template: "evaluation-reminder",
          // byReportCompany marks a reminder sent one per company (the purge
          // script deletes only the older ones, which lack it).
          variables: { month: `${lastMonth} ${year}`, teamCount: names.length, byReportCompany: true },
          organizationId, category: "reminder" })
          .catch((err: any) => console.error(`[Reminder] Evaluation to ${mgr.email}:`, err.message));
      }),
    );
    results.push(`Monthly evaluation: ${managers.length} managers, ${reminders.length} reminders`);
  }

  // ──────────────────────────────────────
  // 2. OVERDUE SOPs → user + manager summary
  // ──────────────────────────────────────
  if (type === "all" || type === "overdue-sops") {
    let assignments = 0;
    let digests = 0;
    for (const organizationId of await liveWorkspaceIds()) {
      const digest = new Digests();
      await eachPage(
        ({ take, last }) => prisma.sOPAssignment.findMany({
          where: { status: { not: "COMPLETED" }, dueDate: { lt: now }, sop: { organizationId }, user: LIVE_PERSON, AND: afterRow("dueDate", last) as Prisma.SOPAssignmentWhereInput[] },
          include: {
            sop: { select: { title: true, organizationId: true } },
            user: { select: { id: true, email: true, firstName: true, lastName: true, manager: managerSelect(organizationId) } },
          },
          orderBy: [{ dueDate: "asc" }, { id: "asc" }],
          take,
        }),
        async (overdueSops) => {
          assignments += overdueSops.length;
          // Notify users
          await Promise.all(
            overdueSops.map((a) => {
              const days = Math.floor((now.getTime() - new Date(a.dueDate!).getTime()) / 86400000);
              const { subject, html } = reminderTemplate({
                itemType: "SOP", itemTitle: a.sop.title,
                dueInfo: `overdue by ${days} day${days > 1 ? "s" : ""}`,
                itemLink: `${baseUrl}/sops/my-sops`,
              });
              return sendEmail({ to: a.user.email, subject, html, template: "overdue-sop",
                variables: { itemTitle: a.sop.title, daysOverdue: days },
                organizationId: a.sop.organizationId, userId: a.user.id, category: "sop" })
                .catch(() => {});
            }),
          );
          for (const a of overdueSops) {
            const mgr = digestManager(a.user.manager as ManagerFacts | null, organizationId);
            if (!mgr) continue;
            digest.add(mgr, {
              type: "SOP", title: a.sop.title,
              personName: `${a.user.firstName} ${a.user.lastName}`,
              daysOverdue: Math.floor((now.getTime() - new Date(a.dueDate!).getTime()) / 86400000),
            });
          }
        },
      );

      // Manager summary, one per manager in this company: each digest is
      // tagged with the company whose people it names, so it goes with that
      // company when it is deleted for good (/api/cron/org-hard-delete).
      await Promise.all(
        Array.from(digest.byManager.values()).map((e) => {
          const { subject, html } = overdueManagerTemplate({
            managerName: e.mgr.firstName, items: e.items, total: e.total, dashboardLink: `${baseUrl}/home`,
          });
          return sendEmail({ to: e.mgr.email, subject, html, template: "overdue-manager",
            variables: { count: e.total }, organizationId, category: "reminder" })
            .catch(() => {});
        }),
      );
      digests += digest.byManager.size;
    }
    results.push(`Overdue SOPs: ${assignments} assignments, ${digests} manager digests`);
  }

  // ──────────────────────────────────────
  // 3. OVERDUE TASKS → manager summary
  // ──────────────────────────────────────
  if (type === "all" || type === "overdue-tasks") {
    // Phase 2 W4: Items, not the legacy `Task` table (scripts/migrate-legacy-
    // tasks.ts). "Overdue" is a due date in the past on a row whose status is
    // not one of its List's done values.
    let tasks = 0;
    let digests = 0;
    for (const organizationId of await liveWorkspaceIds()) {
      const open = await openItemsOf(organizationId);
      if (!open.where.OR || (open.where.OR as unknown[]).length === 0) continue;
      const digest = new Digests();
      await eachPage(
        ({ take, last }) => prisma.item.findMany({
          where: { ...open.where, archivedAt: null, dueAt: { lt: now }, AND: [HAS_ASSIGNEE, ...afterRow("dueAt", last)] as Prisma.ItemWhereInput[] },
          select: { id: true, title: true, dueAt: true, status: true, boardId: true, ownerId: true, assigneeIds: true, itemType: true },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take,
        }),
        async (overdueRows) => {
          const overdueTasks = overdueRows.filter((r) => openTask(open, r));
          if (overdueTasks.length === 0) return;
          tasks += overdueTasks.length;
          // `Item.ownerId` and `assigneeIds` are plain columns, not
          // relations, so the people are read in one batch per page rather
          // than per row. Every assignee's manager hears of the task, each
          // line naming that assignee.
          const people = await prisma.user.findMany({
            where: { id: { in: [...new Set(overdueTasks.flatMap(taskPeople))] }, ...LIVE_PERSON },
            select: { ...personSelect(organizationId), manager: managerSelect(organizationId) },
          });
          const personById = new Map(people.filter((u) => liveInWorkspace(u as SweepPerson, organizationId)).map((u) => [u.id, u]));
          for (const t of overdueTasks) {
            for (const id of taskPeople(t)) {
              const assignee = personById.get(id);
              const mgr = assignee ? digestManager(assignee.manager as ManagerFacts | null, organizationId) : null;
              if (!assignee || !mgr) continue;
              digest.add(mgr, {
                type: "Task", title: t.title,
                personName: `${assignee.firstName} ${assignee.lastName}`,
                daysOverdue: t.dueAt ? Math.floor((now.getTime() - new Date(t.dueAt).getTime()) / 86400000) : 0,
              });
            }
          }
        },
      );

      // One digest per manager in this company, tagged with it (as above).
      await Promise.all(
        Array.from(digest.byManager.values()).map((e) => {
          const { subject, html } = overdueManagerTemplate({
            // Phase 2 W4: /tasks/assigned-to-me is gone with the legacy task
            // grid. My work is the one list of everything assigned to a person.
            managerName: e.mgr.firstName, items: e.items, total: e.total, dashboardLink: `${baseUrl}/my-work`,
          });
          return sendEmail({ to: e.mgr.email, subject, html, template: "overdue-tasks-manager",
            variables: { count: e.total }, organizationId, category: "reminder" })
            .catch(() => {});
        }),
      );
      digests += digest.byManager.size;
    }
    results.push(`Overdue tasks: ${tasks} tasks, ${digests} manager digests`);
  }

  // ──────────────────────────────────────
  // 3b. TASK DUE TODAY — in-app notification
  // ──────────────────────────────────────
  if (type === "all" || type === "tasks-due-today") {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    let due = 0;
    let notified = 0;
    for (const organizationId of await liveWorkspaceIds()) {
      const open = await openItemsOf(organizationId);
      if (!open.where.OR || (open.where.OR as unknown[]).length === 0) continue;
      // Phase 2 W4, as above: Items, not the legacy `Task` table. Every
      // row, a page at a time.
      await eachPage(
        ({ take, last }) => prisma.item.findMany({
          where: { ...open.where, archivedAt: null, dueAt: { gte: startOfDay, lte: endOfDay }, AND: [HAS_ASSIGNEE] as Prisma.ItemWhereInput[], ...(last ? { id: { gt: last.id } } : {}) },
          select: { id: true, title: true, status: true, boardId: true, ownerId: true, assigneeIds: true, itemType: true, board: { select: { folderId: true, spaceId: true } } },
          orderBy: { id: "asc" },
          take,
        }),
        async (dueRows) => {
          const dueToday = dueRows.filter((r) => openTask(open, r));
          if (dueToday.length === 0) return;
          due += dueToday.length;
          // One row per task and person: every assignee, live and in this
          // workspace (a removed or deactivated person, or one who left
          // this workspace, hears nothing).
          const named = [...new Set(dueToday.flatMap(taskPeople))];
          const people = await prisma.user.findMany({
            where: { id: { in: named }, ...LIVE_PERSON },
            select: { id: true, deletedAt: true, status: true, organizationId: true, organizationMemberships: { where: { organizationId }, select: { id: true } } },
          });
          const live = new Set(people.filter((u) => liveInWorkspace(u as SweepPerson, organizationId)).map((u) => u.id));
          const pairs = dueToday.flatMap((t) => taskPeople(t).filter((id) => live.has(id)).map((userId) => ({ ...t, userId })));
          if (pairs.length === 0) return;
          // Honor the "Due-date reminders" inbox toggle (batched, one query).
          const wantsDue = await filterNotifyUsers([...new Set(pairs.map((t) => t.userId))], "due_reminders");
          // And the per-object mute every other task notification honours
          // (notify-item.ts emit): a person who muted the task's List, Folder
          // or Space hears nothing about its due date, as the Muted items
          // card on My settings > Notifications says.
          const wanted = await unmutedRows(
            pairs
              .filter((t) => wantsDue.has(t.userId))
              .map((t) => ({ ...t, placeKeys: placeMuteKeys({ boardId: t.boardId, folderId: t.board?.folderId, spaceId: t.board?.spaceId }) })),
            "due_reminders",
          );
          // ONCE A DAY per person and task, as notifyItemsDueToday was: a
          // second run the same day (a retried cron, a run by hand) writes
          // nothing it already wrote. Read by person (Notification's index
          // leads with userId), never by link, which has no index. A read
          // that fails sends anyway: a duplicate beats a missed deadline.
          const sent = new Set<string>();
          if (wanted.length > 0) {
            try {
              const already = await prisma.notification.findMany({
                where: { userId: { in: [...new Set(wanted.map((t) => t.userId))] }, type: "task_due_today", createdAt: { gte: startOfDay } },
                select: { userId: true, link: true },
              });
              for (const a of already) sent.add(`${a.userId}|${a.link}`);
            } catch {
              /* fail open, as above */
            }
          }
          const toNotify = wanted.filter((t) => !sent.has(`${t.userId}|/item/${t.id}`));
          if (toNotify.length > 0) {
            await prisma.notification.createMany({
              // The link names THE TASK, not a landing. It used to be the bare
              // "/tasks", which is a 308 to /home since Phase 2 W4, so a
              // notification that named one task in its message dropped the
              // reader on Home with no way back to it.
              data: toNotify.map((t) => ({
                userId: t.userId,
                type: "task_due_today",
                title: "Task Due Today",
                message: t.title,
                link: `/item/${t.id}`,
              })),
            });
            notified += toNotify.length;
          }
        },
      );
    }
    results.push(`Tasks due today notifications: ${notified} (of ${due} due)`);
  }

  // ──────────────────────────────────────
  // 4. KPI RECORDING REMINDERS (monthly)
  // ──────────────────────────────────────
  if (type === "all" || type === "kpi-recording") {
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const assignments = await prisma.kRAAssignment.findMany({
      where: { status: "ACTIVE", user: { ...LIVE_PERSON, organization: LIVE_ORG } },
      select: { userId: true, user: { select: { id: true, email: true, firstName: true, organizationId: true } } },
    });
    const uniqueUsers = new Map<string, any>();
    for (const a of assignments) uniqueUsers.set(a.userId, a.user);

    // Fetch all users' existing KPI records for the period in ONE query
    // instead of N per-user counts (previously: 500 users = 500 round trips).
    const usersWithRecords = new Set(
      (await prisma.kPIRecord.findMany({
        where: { userId: { in: Array.from(uniqueUsers.keys()) }, period: currentPeriod },
        select: { userId: true },
        distinct: ["userId"],
      })).map((r) => r.userId),
    );

    const toRemind = Array.from(uniqueUsers.entries()).filter(([userId]) => !usersWithRecords.has(userId));
    const sendResults = await Promise.all(
      toRemind.map(async ([userId, user]) => {
        const { subject, html } = reminderTemplate({
          itemType: "KPI Recording", itemTitle: `Monthly update for ${currentPeriod}`,
          dueInfo: "due this month", itemLink: `${baseUrl}/kra-kpi`,
        });
        try {
          await sendEmail({ to: user.email, subject: "Time to record your KPIs", html,
            template: "kpi-recording", variables: { period: currentPeriod },
            organizationId: user.organizationId, userId, category: "kra" });
          return 1 as number;
        } catch { return 0 as number; }
      }),
    );
    const sent = sendResults.reduce((a, b) => a + b, 0);
    results.push(`KPI recording reminders: ${sent} of ${uniqueUsers.size} users`);
  }

  // ──────────────────────────────────────
  // 5. POLICY ACKNOWLEDGMENT REMINDERS (weekly)
  // ──────────────────────────────────────
  if (type === "all" || type === "policy-ack") {
    const policies = await prisma.policy.findMany({
      where: { status: "PUBLISHED", requiresAck: true, organization: LIVE_ORG },
      select: { id: true, title: true, organizationId: true },
    });
    // Fan out across policies, and within each policy fan out across users.
    const perPolicyCounts = await Promise.all(
      policies.map(async (p) => {
        const [allUsers, ackRows] = await Promise.all([
          prisma.user.findMany({
            where: { organizationId: p.organizationId, ...LIVE_PERSON },
            select: { id: true, email: true },
          }),
          prisma.policyAcknowledgment.findMany({
            where: { policyId: p.id }, select: { userId: true },
          }),
        ]);
        const acked = new Set(ackRows.map((a) => a.userId));
        const pending = allUsers.filter((u) => !acked.has(u.id));
        const results = await Promise.all(
          pending.map(async (u) => {
            const { subject, html } = reminderTemplate({
              itemType: "Policy", itemTitle: p.title,
              dueInfo: "pending acknowledgment", itemLink: `${baseUrl}/policies`,
            });
            try {
              await sendEmail({ to: u.email, subject: `Please acknowledge: ${p.title}`, html,
                template: "policy-ack", variables: { title: p.title },
                organizationId: p.organizationId, userId: u.id, category: "reminder" });
              return 1 as number;
            } catch { return 0 as number; }
          }),
        );
        return results.reduce((a, b) => a + b, 0);
      }),
    );
    const reminded = perPolicyCounts.reduce((a, b) => a + b, 0);
    results.push(`Policy ack reminders: ${reminded} users`);
  }

  // ──────────────────────────────────────
  // 6. "REMIND BEFORE DUE" (daily): Organize › Defaults process.ack.remindDays
  // ──────────────────────────────────────
  if (type === "all" || type === "policy-ack-due") {
    const r = await remindPolicyAssignmentsDue(now);
    results.push(`Policy due-soon reminders: ${r.reminded} people across ${r.orgs} orgs`);
  }

  return NextResponse.json({ success: true, results });
}

// Seven crontab rows call this route (scripts/CRON-SETUP.md), so it answers
// a throw like every scheduled job: 500, a [cron-failure] line and the alert
// (src/lib/cron-result.ts).
export const POST = cronJob("send-reminders", handle);
