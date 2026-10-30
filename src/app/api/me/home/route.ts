// GET /api/me/home: everything the Home page draws, in ONE call.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/home, Data):
// `{ work, inbox, reminders, goals, weeklyReview, recentDocs }` "composed
// server-side from the existing helpers behind /api/me/work (widened to
// assigneeIds), /api/notifications, /api/reminders, /api/okrs/my-okrs,
// /api/me/weekly-review, /api/me/recent-docs, scoped by can()".
//
// ONE CALL, ON PURPOSE. The page it replaces fired four fetches from four
// cards and rendered seven more from hard-coded strings. Six widgets firing
// six requests on every focus is the same mistake with better manners, and it
// makes "focus re-fetches everything" (the spec's Realtime line) six races
// instead of one.
//
// EVERY WIDGET FAILS ALONE. A widget whose data could not be read comes back
// as `null` and renders "Couldn't load · Retry" in its own body. The page is
// never empty because one query was slow, and it never claims Inbox Zero
// because a count threw: which is the exact failure the old Inbox had.
//
// GUESTS GET TWO WIDGETS. Access section 5.2.1's `home` row grants a Guest
// "My work over shared objects, Inbox" and nothing else, so the other four
// keys come back null for a Guest rather than being computed and hidden by the
// client. Nothing about a person's goals, reminders, reviews or documents
// leaves the server for someone the workspace does not keep those for.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentPeriodPayload, orgPeriodSettings, settleOnRead } from "@/lib/goals/goal-periods.server";
import { isGoalCadence, type GoalCadence } from "@/lib/goals/goal-period";
import { getEffectivePreferences } from "@/lib/preferences";
import { liftWithheldListIds } from "@/lib/assignee-lift";
import { getBoardStatuses, isDoneStatusName } from "@/lib/board-items-shared";
import { parseRecentDocViews } from "@/lib/recent-doc-views";
import { nodeCtxFromLevel, nodeRoleMap } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { addDays, civilDayIn, endOfWeekInstant, homeBucketFor, startOfTodayInstant, zonedStartOfDay, type LocaleContext } from "@/lib/work-buckets";
import { splitDoneByList } from "@/lib/list-done";
import { kindFor } from "@/lib/inbox-kinds";
import { tabUnreadWhere, unreadWhere, withClearedAtFallback } from "@/lib/inbox-query";
import { notificationTarget } from "@/lib/notification-target";
import type { HomePayload, HomeTaskRow } from "@/lib/home-payload";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";

export const dynamic = "force-dynamic";

/** At most ten task rows across the three groups (spec: the content budget). */
const WORK_ROW_BUDGET = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = u.id;
  const organizationId = u.organizationId;
  const isGuest = (u.accessLevel ?? "").toUpperCase() === "GUEST";

  const prefs = await getEffectivePreferences(userId, organizationId).catch(() => null);
  const locale: LocaleContext = {
    timeZone: prefs?.home?.locale?.timezone ?? null,
    weekStart: prefs?.home?.locale?.weekStart ?? null,
  };
  const now = new Date();

  // `settled` rather than `all`: one widget's failure is that widget's error
  // row, never the page's.
  const [work, inbox, reminders, goals, weeklyReview, recentDocs] = await Promise.all([
    loadWork(userId, organizationId, u.accessLevel, now, locale).catch(() => null),
    loadInbox(userId, organizationId, now).catch(() => null),
    isGuest ? Promise.resolve(null) : loadReminders(userId, organizationId, now, locale).catch(() => null),
    isGuest ? Promise.resolve(null) : loadGoals(userId, organizationId).catch(() => null),
    isGuest ? Promise.resolve(null) : loadWeeklyReview(userId, organizationId, now, locale).catch(() => null),
    isGuest ? Promise.resolve(null) : loadRecentDocs(userId, organizationId, u.accessLevel, prefs).catch(() => null),
  ]);

  const payload: HomePayload = {
    isGuest,
    locale: { timeZone: locale.timeZone ?? null, weekStart: locale.weekStart ?? null },
    work,
    inbox,
    reminders,
    goals,
    weeklyReview,
    recentDocs,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}

// ── My work ───────────────────────────────────────────────────────

async function loadWork(userId: string, organizationId: string, accessLevel: string | null | undefined, now: Date, locale: LocaleContext) {
  const endOfWeek = endOfWeekInstant(now, locale);
  const startOfToday = startOfTodayInstant(now, locale);
  const startOfTomorrow = zonedStartOfDay(addDays(civilDayIn(now, locale.timeZone ?? null), 1), locale.timeZone ?? null);
  // A task's day is its due date, else its start date: the anchor
  // homeBucketFor reads. These say "the anchor falls before / inside" in SQL.
  const anchorBefore = (t: Date) => ({ OR: [{ dueAt: { lt: t } }, { dueAt: null, startAt: { lt: t } }] });
  const anchorIn = (lo: Date, hi: Date) => ({ OR: [{ dueAt: { gte: lo, lt: hi } }, { dueAt: null, startAt: { gte: lo, lt: hi } }] });
  const mine = {
    organizationId,
    archivedAt: null,
    ...NOT_SYSTEM_ITEMS,
    // Mine: primary assignee or one of several.
    OR: [{ ownerId: userId }, { assigneeIds: { has: userId } }],
    // Anything that could land in one of the three groups. Everything
    // further out is "Later", which this widget does not draw, so it is
    // never read.
    AND: [anchorBefore(endOfWeek)],
  };
  // OPEN WORK IS DECIDED IN SQL, BY EACH TASK'S OWN LIST (src/lib/list-done.ts).
  // This read used to take the oldest 200 of the viewer's tasks by due date
  // with no status filter and drop the done ones afterwards, by the five
  // words isDoneStatusName knows. Two failures came of it: ticking a task in
  // a List whose done status is Published wrote PUBLISHED, which those words
  // do not know, so the task stayed under Overdue for good; and once a
  // person had 200 finished past-due tasks, every open task was cut off and
  // the widget said "Nothing due this week".
  const split = await splitDoneByList(mine, organizationId);
  const open = { AND: [mine, split.open] };
  const [rows, overdueCount, todayCount, weekCount] = await Promise.all([
    prisma.item.findMany({
      where: open,
      select: {
        id: true, title: true, status: true, priority: true, dueAt: true, startAt: true,
        // `statuses` travels with the row so the widget's checkbox knows which
        // word "done" is in THIS List. Without it the tick would have to guess
        // ("DONE"), and a List whose done status is "Shipped" would silently
        // write a status it does not have.
        board: { select: { id: true, slug: true, name: true, statuses: true } },
      },
      orderBy: [{ dueAt: "asc" }, { position: "asc" }],
      // Bounded, and far above the ten rows drawn, so the nearest ten are
      // among them whichever date a task is anchored on.
      take: 200,
    }),
    // The group counts and the "N more" footer are counted, not read off the
    // capped rows: a count of the rows a cap let through is the cap.
    prisma.item.count({ where: { AND: [open, anchorBefore(startOfToday)] } }),
    prisma.item.count({ where: { AND: [open, anchorIn(startOfToday, startOfTomorrow)] } }),
    prisma.item.count({ where: { AND: [open, anchorIn(startOfTomorrow, endOfWeek)] } }),
  ]);

  // The Lists where being assigned does not let this viewer change a task.
  const readOnlyBoardIds = await liftWithheldListIds({ userId, organizationId, accessLevel }, rows.map((r) => r.board?.id));
  const groups: { overdue: HomeTaskRow[]; today: HomeTaskRow[]; week: HomeTaskRow[] } = { overdue: [], today: [], week: [] };
  for (const r of rows) {
    // A row whose status moved to a done one after the groupBy.
    if (split.isDone(r.board?.id, r.status)) continue;
    const bucket = homeBucketFor(r.dueAt ?? r.startAt, now, locale);
    if (!bucket) continue;
    groups[bucket].push({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      list: r.board ? { id: r.board.id, slug: r.board.slug, name: r.board.name } : null,
      doneStatus: firstDoneStatus(r.board),
      canEdit: !(r.board && readOnlyBoardIds.has(r.board.id)),
    });
  }

  const totalOpen = overdueCount + todayCount + weekCount;
  // Trim to the budget across the three groups, nearest first, so the ten rows
  // a person sees are the ten that matter today.
  let remaining = WORK_ROW_BUDGET;
  const trimmed = {
    overdue: take(groups.overdue, () => remaining, (n) => { remaining -= n; }),
    today: take(groups.today, () => remaining, (n) => { remaining -= n; }),
    week: take(groups.week, () => remaining, (n) => { remaining -= n; }),
  };

  return {
    ...trimmed,
    counts: {
      overdue: overdueCount,
      today: todayCount,
      week: weekCount,
      shown: WORK_ROW_BUDGET - remaining,
      more: Math.max(0, totalOpen - (WORK_ROW_BUDGET - remaining)),
    },
  };
}

/** The value the checkbox writes: this List's own first done status. */
function firstDoneStatus(board: { statuses?: unknown } | null): string | null {
  const options = getBoardStatuses(board);
  const done = options.find((o) => o.group === "DONE") ?? options.find((o) => isDoneStatusName(o.value));
  return done?.value ?? null;
}

function take<T>(rows: T[], budget: () => number, spend: (n: number) => void): T[] {
  const n = Math.max(0, Math.min(rows.length, budget()));
  spend(n);
  return rows.slice(0, n);
}

// ── Inbox ─────────────────────────────────────────────────────────

async function loadInbox(userId: string, organizationId: string, now: Date) {
  // "the 5 newest UNREAD Primary notifications" (spec section 2, widget 2):
  // the tab itself now also holds rows the viewer has read, which belong in
  // the Inbox list and not in a five-row summary of what is new.
  const [unread, rows] = await withClearedAtFallback(() =>
    Promise.all([
      prisma.notification.count({ where: unreadWhere(userId, now) }),
      prisma.notification.findMany({
        where: tabUnreadWhere("primary", userId, now),
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]),
  );
  void organizationId;
  return {
    unread,
    rows: rows.map((n) => {
      const kind = kindFor(n.type);
      const target = notificationTarget(n.link);
      return {
        id: n.id,
        title: n.title,
        message: n.message,
        createdAt: n.createdAt.toISOString(),
        kind: { label: kind.label, icon: kind.icon },
        href: target.href,
      };
    }),
  };
}

// ── Reminders ─────────────────────────────────────────────────────

async function loadReminders(userId: string, organizationId: string, now: Date, locale: LocaleContext) {
  void locale;
  const rows = await prisma.reminder.findMany({
    where: {
      userId,
      organizationId,
      status: { in: ["PENDING", "FIRED"] },
      // Due today or already past: a reminder for next Tuesday is not a thing
      // to do this morning.
      remindAt: { lt: new Date(now.getTime() + 86_400_000) },
    },
    orderBy: { remindAt: "asc" },
    take: 8,
    select: { id: true, title: true, remindAt: true, status: true, entityType: true, entityId: true },
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      remindAt: r.remindAt.toISOString(),
      overdue: r.remindAt < now,
      href: r.entityType === "BOARD_ITEM" && r.entityId ? `/item/${r.entityId}` : null,
    })),
  };
}

// ── My goals ──────────────────────────────────────────────────────

async function loadGoals(userId: string, organizationId: string) {
  // Repeating goals open any period they are missing first (docs/plans/
  // recurring-goals.md B3). A running repeating goal never stores COMPLETED
  // (B8), so one that hit its number mid-month stays on this card.
  const repeating = await prisma.oKR.findMany({
    where: { organizationId, repeat: { not: null }, OR: [{ ownerId: userId }, { assignees: { some: { userId } } }] },
    select: { id: true },
  });
  if (repeating.length > 0) await settleOnRead(organizationId, repeating.map((g) => g.id), "Home");
  const mine = { organizationId, OR: [{ ownerId: userId }, { assignees: { some: { userId } } }], status: { not: "COMPLETED" } };
  const select = { id: true, title: true, progress: true, endDate: true, status: true, repeat: true, repeatUntil: true, createdAt: true } as const;
  // The five due soonest. A repeating goal has no due date, so it is "due"
  // at its current period's last day (E1, E4) and sorts among the dated
  // ones; otherwise a person with five dated goals would never see their
  // monthly goal here.
  const [dated, running, periodRows] = await Promise.all([
    prisma.oKR.findMany({ where: { ...mine, repeat: null }, orderBy: [{ endDate: "asc" }, { createdAt: "desc" }], take: 5, select }),
    repeating.length ? prisma.oKR.findMany({ where: { ...mine, id: { in: repeating.map((g) => g.id) } }, select }) : Promise.resolve([]),
    // Each goal's period shown for now and no more: its latest one that has
    // started (periods open only once they start, so that is the one
    // running, or a stopped goal's last), never its whole history.
    repeating.length
      ? prisma.goalPeriod.findMany({
          where: { okrId: { in: repeating.map((g) => g.id) }, startsAt: { lte: new Date() } },
          orderBy: [{ okrId: "asc" }, { startsAt: "desc" }],
          distinct: ["okrId"],
          select: { okrId: true, key: true, cadence: true, startsAt: true, endsAt: true, graceEndsAt: true, closesAt: true, trackedFrom: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const settings = running.length ? await orgPeriodSettings(organizationId) : null;
  const byGoal = new Map<string, Array<(typeof periodRows)[number] & { cadence: GoalCadence }>>();
  for (const p of periodRows) {
    if (!isGoalCadence(p.cadence)) continue;
    byGoal.set(p.okrId, [...(byGoal.get(p.okrId) ?? []), { ...p, cadence: p.cadence }]);
  }
  const now = new Date();
  const periodOf = new Map(running.map((g) => [g.id, settings ? currentPeriodPayload(byGoal.get(g.id) ?? [], settings, now) : null]));
  const dueOf = (g: (typeof dated)[number]) => (g.repeat ? periodOf.get(g.id)?.lastDay ?? null : g.endDate ? g.endDate.toISOString().slice(0, 10) : null);
  const rows = [...dated, ...running]
    .sort((a, b) => {
      const da = dueOf(a), db = dueOf(b);
      if (da !== db) return da == null ? 1 : db == null ? -1 : da < db ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 5);
  return {
    rows: rows.map((g) => {
      // A repeating goal's row reads "Resets 1 Nov" (E4): its current period's days.
      const p = periodOf.get(g.id) ?? null;
      return {
        id: g.id,
        title: g.title,
        progress: typeof g.progress === "number" ? g.progress : 0,
        endDate: g.endDate ? g.endDate.toISOString() : null,
        status: g.status,
        ...(g.repeat
          ? { repeat: g.repeat, repeatUntil: g.repeatUntil, period: p ? { label: p.label, lastDay: p.lastDay, nominalLastDay: p.nominalLastDay, resetsOn: p.resetsOn } : null }
          : {}),
      };
    }),
  };
}

// ── Weekly review ─────────────────────────────────────────────────

/**
 * Rendered only when the viewer actually has something to review: an active
 * KRA assignment, a KPI number waiting, or a review row that already exists.
 * `null` means "do not draw this widget", which is how the spec asks a
 * data-derived widget to disappear rather than render an empty card.
 *
 * It READS. `getOrCreateWeeklyReview` in lib/weekly-review.ts creates a DRAFT
 * row as a side effect of being asked, and a widget that silently creates a
 * review every time somebody opens Home is a widget that writes to the
 * database on a page load. The page itself still creates the row when the
 * person opens it.
 */
async function loadWeeklyReview(userId: string, organizationId: string, now: Date, locale: LocaleContext) {
  const [assignments, review, pendingKpis] = await Promise.all([
    prisma.kRAAssignment.count({ where: { userId, status: "ACTIVE" } }),
    prisma.weeklyReview.findFirst({
      where: { userId, organizationId },
      orderBy: { periodStart: "desc" },
      select: { id: true, periodStart: true, status: true },
    }).catch(() => null),
    prisma.kPIRecord.count({ where: { userId, status: "PENDING" } }).catch(() => 0),
  ]);

  if (assignments === 0 && !review && pendingKpis === 0) return null;
  void now;
  void locale;
  return {
    weekStart: review?.periodStart ? review.periodStart.toISOString() : null,
    status: review?.status ?? "NOT_STARTED",
    kpisToRecord: pendingKpis,
  };
}

// ── Recent docs ───────────────────────────────────────────────────

async function loadRecentDocs(
  userId: string,
  organizationId: string,
  accessLevel: string | null | undefined,
  prefs: Awaited<ReturnType<typeof getEffectivePreferences>> | null,
) {
  // The stored shape is { id, at } (POST /api/me/recent-docs); this card
  // used to read only { docId }, so it matched nothing and was always empty.
  const { ids, viewedAt } = parseRecentDocViews(prefs?.home?.recentDocViews);
  if (ids.length === 0) return { rows: [] };

  const docs = await prisma.doc.findMany({
    where: { id: { in: ids.slice(0, 20) }, organizationId, archivedAt: null },
    select: { id: true, title: true, updatedAt: true },
  });
  // A doc the viewer can no longer open is DROPPED rather than rendered as a
  // row that 404s: GET /api/docs/[id]'s own gate (the one node-access
  // resolver), over one world for every row, so no row here names a doc its
  // own page would refuse.
  const roles = await nodeRoleMap(nodeCtxFromLevel(userId, organizationId, accessLevel), "doc", docs.map((d) => d.id));
  const allowedIds = new Set(docs.filter((d) => roleAtLeast(roles.get(d.id) ?? "none", "VIEW")).map((d) => d.id));
  // Keep the preference's order (most recent first), not the query's.
  const byId = new Map(docs.map((d) => [d.id, d]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d && allowedIds.has(d.id))
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      title: d.title,
      viewedAt: viewedAt.get(d.id) ?? d.updatedAt.toISOString(),
    }));
  return { rows };
}
