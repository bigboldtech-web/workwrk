// Analytics: how the people you manage are doing on their work.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics).
//
// WHAT THE PAGE USED TO DO. It fired five parallel list fetches
// (`/api/tasks?limit=200`, `/api/users?limit=200`, `/api/purchase-orders`,
// `/api/sops`, `/api/timesheets`), unwrapped each through four shape guesses,
// and counted them in the browser with `.filter().length`. `GET /api/tasks`
// ignores `?limit` and is scoped to the CALLER, so the "total" tile printed the
// viewer's own assigned count under an org-wide label. Six of its ten tiles
// pointed at route directories that do not exist. And a separate
// `GET /api/analytics` existed with zero consumers.
//
// WHAT IT DOES NOW. Five numbers, computed on the server, over Items and the
// people the viewer can actually see. No purchase orders, no financial tiles,
// no invented "company health score" (a composite of KPI 50 percent plus SOP
// compliance 30 percent plus mood 20 percent, which is a number no customer
// could check).
//
// Server-only: prisma and the access engine.

import { prisma } from "./prisma";
import { isDoneStatusName } from "./board-items-shared";
import { getTeamUserIds } from "./team";
import type { Viewer } from "./access/types";
import type { Prisma } from "@/generated/prisma";
import {
  type AnalyticsList,
  type AnalyticsPerson,
  type AnalyticsResult,
  type AnalyticsScope,
  type AnalyticsTotals,
  weekKeyOf,
  weekSeries,
} from "./analytics-view";

// The vocabulary (scopes, periods, tiles, week maths, delta) lives in the pure
// analytics-view.ts so it can be unit-tested without a database; re-exported
// here so a caller needs one import.
export * from "./analytics-view";

/** Who this viewer's numbers are about. */
export async function analyticsPeopleIds(viewer: Viewer, scope: AnalyticsScope): Promise<string[]> {
  if (scope === "org") {
    const rows = await prisma.user.findMany({
      where: { organizationId: viewer.organizationId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  // The viewer's own chain, including themselves: a manager's own work is part
  // of their team's numbers.
  const ids = await getTeamUserIds(viewer.organizationId, viewer.userId);
  return [...new Set([viewer.userId, ...ids])];
}

function emptyTotals(): AnalyticsTotals {
  return { openTasks: 0, completed: 0, overdue: 0, hoursLogged: 0, sopAcks: 0 };
}

export async function buildAnalytics(
  viewer: Viewer,
  opts: { scope: AnalyticsScope; days: number; personId?: string | null; departmentId?: string | null },
): Promise<AnalyticsResult> {
  const orgId = viewer.organizationId;
  let peopleIds = await analyticsPeopleIds(viewer, opts.scope);

  if (opts.departmentId) {
    const inDept = await prisma.user.findMany({
      where: { organizationId: orgId, departmentId: opts.departmentId, id: { in: peopleIds } },
      select: { id: true },
    });
    peopleIds = inDept.map((u) => u.id);
  }
  if (opts.personId) {
    // Narrow within the set, never outside it.
    peopleIds = peopleIds.filter((id) => id === opts.personId);
  }

  const now = new Date();
  const from = new Date(now.getTime() - opts.days * 86_400_000);
  const prevFrom = new Date(from.getTime() - opts.days * 86_400_000);

  if (peopleIds.length === 0) {
    return {
      scope: opts.scope,
      from: from.toISOString(),
      to: now.toISOString(),
      totals: emptyTotals(),
      previous: emptyTotals(),
      weekly: [],
      people: [],
      lists: [],
      peopleCount: 0,
    };
  }

  const mine: Prisma.ItemWhereInput = {
    organizationId: orgId,
    archivedAt: null,
    OR: [{ ownerId: { in: peopleIds } }, { assigneeIds: { hasSome: peopleIds } }],
  };

  const [items, prevItems, timers, prevTimers, acks, prevAcks, people] = await Promise.all([
    prisma.item.findMany({
      where: mine,
      select: {
        id: true, status: true, dueAt: true, updatedAt: true, createdAt: true,
        ownerId: true, assigneeIds: true, boardId: true,
        board: { select: { id: true, slug: true, name: true, space: { select: { name: true } } } },
      },
      take: 20_000,
    }),
    // Only what the previous window's deltas need.
    prisma.item.findMany({
      where: { ...mine, updatedAt: { gte: prevFrom, lt: from } },
      select: { status: true, dueAt: true },
      take: 20_000,
    }),
    prisma.timerSession.aggregate({
      where: { organizationId: orgId, userId: { in: peopleIds }, startedAt: { gte: from } },
      _sum: { durationMs: true },
    }),
    prisma.timerSession.aggregate({
      where: { organizationId: orgId, userId: { in: peopleIds }, startedAt: { gte: prevFrom, lt: from } },
      _sum: { durationMs: true },
    }),
    prisma.sOPAssignment.count({
      where: { userId: { in: peopleIds }, status: "COMPLETED", completedAt: { gte: from } },
    }),
    prisma.sOPAssignment.count({
      where: { userId: { in: peopleIds }, status: "COMPLETED", completedAt: { gte: prevFrom, lt: from } },
    }),
    prisma.user.findMany({
      where: { id: { in: peopleIds }, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true, avatar: true },
    }),
  ]);

  const perPerson = new Map<string, AnalyticsPerson>(
    people.map((p) => [p.id, { ...p, open: 0, done: 0, overdue: 0, hours: 0, sopAcks: 0 }]),
  );
  const perList = new Map<string, AnalyticsList>();
  const weekBuckets = new Map<string, number>();
  const totals = emptyTotals();

  for (const it of items) {
    const done = isDoneStatusName(it.status);
    const overdue = !done && it.dueAt !== null && it.dueAt < now;
    // "Completed this period" is an updatedAt window: Item has no completedAt
    // column, and the status change is what last touched the row.
    const completedInPeriod = done && it.updatedAt >= from;

    if (done) { if (completedInPeriod) totals.completed += 1; }
    else totals.openTasks += 1;
    if (overdue) totals.overdue += 1;

    if (completedInPeriod) {
      const ws = weekKeyOf(it.updatedAt);
      weekBuckets.set(ws, (weekBuckets.get(ws) ?? 0) + 1);
    }

    // A task counts for everybody on it, which is what "how is my team doing"
    // means: a shared task is not somebody else's problem.
    const owners = [...new Set([it.ownerId, ...(it.assigneeIds ?? [])].filter((v): v is string => !!v))];
    for (const uid of owners) {
      const row = perPerson.get(uid);
      if (!row) continue;
      if (done) { if (completedInPeriod) row.done += 1; } else row.open += 1;
      if (overdue) row.overdue += 1;
    }

    if (it.board) {
      const row = perList.get(it.board.id) ?? {
        id: it.board.id,
        slug: it.board.slug,
        name: it.board.name,
        spaceName: it.board.space?.name ?? null,
        open: 0, done: 0, overdue: 0,
      };
      if (done) { if (completedInPeriod) row.done += 1; } else row.open += 1;
      if (overdue) row.overdue += 1;
      perList.set(it.board.id, row);
    }
  }

  const previous = emptyTotals();
  for (const it of prevItems) {
    if (isDoneStatusName(it.status)) previous.completed += 1;
    else if (it.dueAt !== null && it.dueAt < from) previous.overdue += 1;
  }
  previous.openTasks = totals.openTasks; // no history for a point-in-time count
  previous.hoursLogged = Math.round(((prevTimers._sum.durationMs ?? 0) / 3_600_000) * 10) / 10;
  previous.sopAcks = prevAcks;

  totals.hoursLogged = Math.round(((timers._sum.durationMs ?? 0) / 3_600_000) * 10) / 10;
  totals.sopAcks = acks;

  // Hours per person, one grouped query rather than one per person.
  const byUser = await prisma.timerSession.groupBy({
    by: ["userId"],
    where: { organizationId: orgId, userId: { in: peopleIds }, startedAt: { gte: from } },
    _sum: { durationMs: true },
  });
  for (const row of byUser) {
    const p = perPerson.get(row.userId);
    if (p) p.hours = Math.round(((row._sum.durationMs ?? 0) / 3_600_000) * 10) / 10;
  }
  const acksByUser = await prisma.sOPAssignment.groupBy({
    by: ["userId"],
    where: { userId: { in: peopleIds }, status: "COMPLETED", completedAt: { gte: from } },
    _count: { _all: true },
  });
  for (const row of acksByUser) {
    const p = perPerson.get(row.userId);
    if (p) p.sopAcks = row._count._all;
  }

  const weekly = weekSeries(from, now).map((ws) => ({ weekStart: ws, completed: weekBuckets.get(ws) ?? 0 }));

  return {
    scope: opts.scope,
    from: from.toISOString(),
    to: now.toISOString(),
    totals,
    previous,
    weekly,
    people: [...perPerson.values()].sort((a, b) => b.done - a.done || b.open - a.open),
    lists: [...perList.values()].sort((a, b) => b.open - a.open).slice(0, 30),
    peopleCount: peopleIds.length,
  };
}
