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
import { digestManagersOf, listsEachCanRead, type DigestManager } from "@/lib/access/digest-recipients";
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
// workspace's task titles used to reach the manager in the agency. And it
// is the manager the person reports to for every read that grants reach,
// never an Agent (src/lib/access/digest-recipients.ts, docs-found fixes
// batch 4): the stored line was read as it stands, so an Agent who kept
// reports from before rule 6 got their people's overdue work every Monday.
//
// WHAT A MANAGER IS TOLD. Only tasks the manager can open in the app (Can
// view on the task's List, or they are one of its assignees), as the team
// pages show them, and one line per task, naming each of their people on
// it: every assignee's manager hears of a task, and two of the same
// manager's people on one task are one overdue item, not two.
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
/** The advisory lock a due-today check and write take, per workspace (hashtext of this and the workspace id). */
const DUE_TODAY_LOCK = "due-today";

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

/** Lines kept per manager (the oldest, as rows arrive oldest first) and every line counted: one line per overdue item. */
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
  // Send to every manager of a live person (their digest manager)
  // ──────────────────────────────────────
  if (type === "all" || type === "monthly-evaluation") {
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const lastMonth = monthNames[now.getMonth() === 0 ? 11 : now.getMonth() - 1];
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    // Per live workspace, its live people who have a stored manager, a page
    // at a time, each named in the reminder of their digest manager there
    // (src/lib/access/digest-recipients.ts): the manager they report to for
    // every read that grants reach, in that workspace, never an Agent. An
    // Agent who kept reports from before rule 6 got this reminder naming
    // them; the people listed under an Agent are now named in the reminder
    // of the manager above (docs-found fixes batch 4). One reminder per
    // manager and company, tagged with the company whose people it names, so
    // it goes with that company when it is deleted for good.
    const managers = new Set<string>();
    let reminders = 0;
    for (const organizationId of await liveWorkspaceIds()) {
      const byManager = new Map<string, { mgr: DigestManager; names: string[] }>();
      await eachPage(
        ({ take, last }) => prisma.user.findMany({
          where: { organizationId, ...LIVE_PERSON, managerId: { not: null }, ...(last ? { id: { gt: last.id } } : {}) },
          select: { id: true, firstName: true, lastName: true },
          orderBy: { id: "asc" },
          take,
        }),
        async (people) => {
          const mgrOf = await digestManagersOf(organizationId, people.map((p) => p.id));
          for (const p of people) {
            const mgr = mgrOf.get(p.id);
            if (!mgr) continue;
            const e = byManager.get(mgr.id) ?? { mgr, names: [] };
            e.names.push(`${p.firstName} ${p.lastName}`);
            byManager.set(mgr.id, e);
          }
        },
      );
      await Promise.all(
        [...byManager.values()].map(({ mgr, names }) => {
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
      for (const id of byManager.keys()) managers.add(id);
      reminders += byManager.size;
    }
    results.push(`Monthly evaluation: ${managers.size} managers, ${reminders} reminders`);
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
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
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
          // Each person's digest manager (digest-recipients.ts): the one they
          // report to for every read that grants reach, never an Agent.
          const mgrOf = await digestManagersOf(organizationId, overdueSops.map((a) => a.user.id));
          for (const a of overdueSops) {
            const mgr = mgrOf.get(a.user.id);
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
      /** "manager, List" to whether the manager can open that List, answered once per workspace run. */
      const canOpen = new Map<string, boolean>();
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
          // than per row, and so are their digest managers.
          const people = await prisma.user.findMany({
            where: { id: { in: [...new Set(overdueTasks.flatMap(taskPeople))] }, ...LIVE_PERSON },
            select: personSelect(organizationId),
          });
          const personById = new Map(people.filter((u) => liveInWorkspace(u as SweepPerson, organizationId)).map((u) => [u.id, u]));
          const mgrOf = await digestManagersOf(organizationId, [...personById.keys()]);
          // Every assignee's manager hears of the task: one line per task
          // and manager, naming each of that manager's people on it.
          const lines: Array<{ t: (typeof overdueTasks)[number]; mgr: DigestManager; names: string[] }> = [];
          for (const t of overdueTasks) {
            const byMgr = new Map<string, { t: (typeof overdueTasks)[number]; mgr: DigestManager; names: string[] }>();
            for (const id of taskPeople(t)) {
              const assignee = personById.get(id);
              const mgr = assignee ? mgrOf.get(id) : undefined;
              if (!assignee || !mgr) continue;
              const line = byMgr.get(mgr.id) ?? { t, mgr, names: [] };
              line.names.push(`${assignee.firstName} ${assignee.lastName}`);
              byMgr.set(mgr.id, line);
            }
            lines.push(...byMgr.values());
          }
          // Only a task the manager can open: Can view on its List (one
          // world for the page's (manager, List) pairs not answered yet,
          // each manager evaluated on their own Lists only), or they are one
          // of its assignees. Every answer is kept for the workspace run.
          const pair = (l: { t: { boardId: string }; mgr: DigestManager }) => `${l.mgr.id}\u0000${l.t.boardId}`;
          const unknown = lines.filter((l) => !taskPeople(l.t).includes(l.mgr.id) && !canOpen.has(pair(l)));
          if (unknown.length > 0) {
            const readable = await listsEachCanRead(organizationId, unknown.map((l) => ({ viewer: l.mgr.viewer, listId: l.t.boardId })));
            for (const l of unknown) canOpen.set(pair(l), readable.get(l.mgr.id)?.has(l.t.boardId) ?? false);
          }
          for (const { t, mgr, names } of lines) {
            if (!taskPeople(t).includes(mgr.id) && !canOpen.get(pair({ t, mgr }))) continue;
            digest.add(mgr, {
              type: "Task", title: t.title,
              personName: names.join(", "),
              daysOverdue: t.dueAt ? Math.floor((now.getTime() - new Date(t.dueAt).getTime()) / 86400000) : 0,
            });
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
          // ONCE A DAY per person and task (the server's day), as
          // notifyItemsDueToday was: a second run the same day (a retried
          // cron, a run by hand) writes nothing it already wrote. Read by
          // person (Notification's index leads with userId), never by link,
          // which has no index. The check and the write run under one lock
          // per workspace (docs-found fixes batch 4), so two runs at the same
          // moment take turns: the second reads what the first wrote. A check
          // that fails sends anyway, outside the lock: a duplicate beats a
          // missed deadline.
          if (wanted.length === 0) return;
          // The link names THE TASK, not a landing. It used to be the bare
          // "/tasks", which is a 308 to /home since Phase 2 W4, so a
          // notification that named one task in its message dropped the
          // reader on Home with no way back to it.
          const rowsFor = (list: typeof wanted) => list.map((t) => ({
            userId: t.userId,
            type: "task_due_today",
            title: "Task Due Today",
            message: t.title,
            link: `/item/${t.id}`,
          }));
          let written: number;
          try {
            written = await prisma.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${DUE_TODAY_LOCK}:${organizationId}`}))`;
              const already = await tx.notification.findMany({
                where: { userId: { in: [...new Set(wanted.map((t) => t.userId))] }, type: "task_due_today", createdAt: { gte: startOfDay } },
                select: { userId: true, link: true },
              });
              const sent = new Set(already.map((a) => `${a.userId}|${a.link}`));
              const toNotify = wanted.filter((t) => !sent.has(`${t.userId}|/item/${t.id}`));
              if (toNotify.length > 0) await tx.notification.createMany({ data: rowsFor(toNotify) });
              return toNotify.length;
            }, { timeout: 15_000, maxWait: 10_000 });
          } catch {
            // Fail open, as above: nothing of this transaction was written.
            await prisma.notification.createMany({ data: rowsFor(wanted) });
            written = wanted.length;
          }
          notified += written;
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
