// /api/calendar — unified work-schedule + time feed.
//
// GET ?from=ISO&to=ISO&calendar=my|team&userId=...&spaceId=...
//
//   my   — the viewer's own scheduled work + time
//   team — manager-only: the viewer's report tree (their reportings), so a
//          manager can see what each report is working on and how long they
//          spent. Non-managers always fall back to "my".
//
// Sources:
//   1. Item.dueAt / startAt in range            → kind TASK
//   2. WeeklyReview.periodStart in range        → kind WEEKLY_REVIEW
//   3. SOPAssignment.dueDate in range           → kind SOP_ASSIGNMENT
//   4. TimerSession (logged time) in range      → per-day + per-task totals
//
// Backward compatible: still returns { events, scope, range, people } and
// adds { calendar, canTeam, timeByUserDay, taskTime, activeByUser }.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectiveReportTree } from "@/lib/reporting-line";

const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR",
  "MANAGER", "TEAM_LEAD",
]);

interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO
  end?: string | null;
  kind: "TASK" | "WEEKLY_REVIEW" | "SOP_ASSIGNMENT";
  ownerId: string | null;
  ownerName: string | null;
  status?: string | null;
  priority?: string | null;
  loggedMs?: number;  // time tracked on this item (by its owner) in range
  spaceId?: string | null;
  url: string;
}

async function ctx() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; accessLevel?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

function parseDate(input: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;

  const url = new URL(req.url);
  const now = new Date();
  const from = parseDate(url.searchParams.get("from")) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseDate(url.searchParams.get("to")) ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const spaceFilter = url.searchParams.get("spaceId");
  const drillUser = url.searchParams.get("userId");

  const canTeam = MANAGER_LEVELS.has(c.accessLevel);
  let calendar = (url.searchParams.get("calendar") ?? url.searchParams.get("scope") ?? "my").toLowerCase();
  if (calendar === "mine") calendar = "my";
  if (calendar !== "team") calendar = "my";
  if (calendar === "team" && !canTeam) calendar = "my";

  // Resolve which users' work is in scope.
  let userIds: string[];
  if (calendar === "team") {
    const tree = await getEffectiveReportTree(c.userId); // self + transitive reports
    userIds = tree.filter((id) => id !== c.userId);      // team = the reportings only
  } else {
    userIds = [c.userId];
  }
  // Optional drill-down to one person (must be inside scope).
  if (drillUser) userIds = userIds.includes(drillUser) ? [drillUser] : [];

  const emptyBody = {
    calendar, canTeam, scope: calendar === "team" ? "team" : "mine",
    range: { from: from.toISOString(), to: to.toISOString() },
    events: [], people: [], timeByUserDay: [], taskTime: [], activeByUser: [],
  };
  if (userIds.length === 0) return NextResponse.json(emptyBody);

  // ── People in scope (name + avatar + role) ──────────────────────
  const usersInScope = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: c.organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true },
  });
  const nameById = new Map(
    usersInScope.map((u) => [u.id, ([u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email) as string]),
  );

  // ── Logged time (TimerSession) ──────────────────────────────────
  const sessions = await prisma.timerSession.findMany({
    where: { organizationId: c.organizationId, userId: { in: userIds }, stoppedAt: { not: null }, startedAt: { gte: from, lte: to } },
    select: { userId: true, entityId: true, durationMs: true, startedAt: true },
  });
  const timeByUserDayMap = new Map<string, number>();    // `${userId}|${YYYY-MM-DD}` → ms
  const userTaskMs = new Map<string, number>();           // `${userId}|${entityId}` → ms
  for (const s of sessions) {
    const ms = s.durationMs ?? 0;
    const dk = `${s.userId}|${dayKey(s.startedAt)}`;
    timeByUserDayMap.set(dk, (timeByUserDayMap.get(dk) ?? 0) + ms);
    const tk = `${s.userId}|${s.entityId}`;
    userTaskMs.set(tk, (userTaskMs.get(tk) ?? 0) + ms);
  }

  // Currently-running timers (one per user).
  const active = await prisma.timerSession.findMany({
    where: { organizationId: c.organizationId, userId: { in: userIds }, stoppedAt: null },
    select: { userId: true, entityId: true, startedAt: true },
  });

  // ── 1. Items with a real date in range ──────────────────────────
  const items = await prisma.item.findMany({
    where: {
      organizationId: c.organizationId, archivedAt: null, ownerId: { in: userIds },
      OR: [{ dueAt: { gte: from, lte: to } }, { startAt: { gte: from, lte: to } }],
      ...(spaceFilter ? { board: { spaceId: spaceFilter } } : {}),
    },
    select: {
      id: true, title: true, ownerId: true, status: true, priority: true,
      startAt: true, dueAt: true, boardId: true,
      board: { select: { slug: true, spaceId: true } },
    },
    take: 1500,
  });
  const taskEvents: CalendarEvent[] = items.map((it) => {
    const when = it.dueAt ?? it.startAt!;
    return {
      id: `task:${it.id}`,
      title: it.title,
      start: when.toISOString(),
      end: it.dueAt && it.startAt ? it.dueAt.toISOString() : null,
      kind: "TASK",
      ownerId: it.ownerId,
      ownerName: it.ownerId ? nameById.get(it.ownerId) ?? null : null,
      status: it.status,
      priority: it.priority,
      loggedMs: it.ownerId ? userTaskMs.get(`${it.ownerId}|${it.id}`) ?? 0 : 0,
      spaceId: it.board?.spaceId ?? null,
      url: `/boards/${it.board?.slug ?? it.boardId}?item=${it.id}`,
    };
  });

  // ── 2. Weekly reviews ───────────────────────────────────────────
  const reviews = await prisma.weeklyReview.findMany({
    where: { organizationId: c.organizationId, userId: { in: userIds }, periodStart: { gte: from, lte: to } },
    select: { id: true, userId: true, periodStart: true },
  });
  const reviewEvents: CalendarEvent[] = reviews.map((r) => ({
    id: `review:${r.id}`,
    title: `Weekly review · ${nameById.get(r.userId) ?? "Unknown"}`,
    start: r.periodStart.toISOString(),
    kind: "WEEKLY_REVIEW",
    ownerId: r.userId,
    ownerName: nameById.get(r.userId) ?? null,
    url: r.userId === c.userId ? "/me/weekly-review" : `/team/reviews?user=${r.userId}`,
  }));

  // ── 3. SOP assignments ──────────────────────────────────────────
  const sopAssignments = await prisma.sOPAssignment.findMany({
    where: { sop: { organizationId: c.organizationId }, userId: { in: userIds }, dueDate: { gte: from, lte: to }, status: { not: "COMPLETED" } },
    select: { id: true, userId: true, dueDate: true, sop: { select: { id: true, title: true } } },
  });
  const sopEvents: CalendarEvent[] = sopAssignments
    .filter((a) => a.dueDate !== null)
    .map((a) => ({
      id: `sop:${a.id}`,
      title: `SOP · ${a.sop?.title ?? "Untitled"}`,
      start: a.dueDate!.toISOString(),
      kind: "SOP_ASSIGNMENT",
      ownerId: a.userId,
      ownerName: nameById.get(a.userId) ?? null,
      url: `/sops/${a.sop?.id ?? ""}`,
    }));

  const events = [...taskEvents, ...reviewEvents, ...sopEvents].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  // ── Resolve titles for tracked entities (for the People view) ───
  const trackedIds = Array.from(new Set([...sessions.map((s) => s.entityId), ...active.map((a) => a.entityId)]));
  const titleById = new Map<string, string>();
  if (trackedIds.length) {
    const [trackedItems, trackedTasks] = await Promise.all([
      prisma.item.findMany({ where: { id: { in: trackedIds }, organizationId: c.organizationId }, select: { id: true, title: true } }),
      prisma.task.findMany({ where: { id: { in: trackedIds }, organizationId: c.organizationId }, select: { id: true, title: true } }),
    ]);
    for (const t of trackedItems) titleById.set(t.id, t.title);
    for (const t of trackedTasks) if (!titleById.has(t.id)) titleById.set(t.id, t.title);
  }

  // Per-(user, task) tracked totals → array for the People view.
  const taskTime = Array.from(userTaskMs.entries()).map(([key, ms]) => {
    const [userId, entityId] = key.split("|");
    return { userId, entityId, title: titleById.get(entityId) ?? "Tracked work", ms };
  }).sort((a, b) => b.ms - a.ms);

  const timeByUserDay = Array.from(timeByUserDayMap.entries()).map(([key, ms]) => {
    const [userId, day] = key.split("|");
    return { userId, day, ms };
  });

  const activeByUser = active.map((a) => ({
    userId: a.userId,
    entityId: a.entityId,
    title: titleById.get(a.entityId) ?? "Tracked work",
    since: a.startedAt.toISOString(),
  }));

  return NextResponse.json({
    calendar,
    canTeam,
    scope: calendar === "team" ? "team" : "mine",
    range: { from: from.toISOString(), to: to.toISOString() },
    events,
    people: usersInScope.map((u) => ({
      id: u.id,
      name: nameById.get(u.id) ?? u.email,
      avatar: u.avatar ?? null,
      role: u.accessLevel ?? null,
    })),
    timeByUserDay,
    taskTime,
    activeByUser,
  });
}
