// /api/calendar — unified work-schedule feed.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=mine|team&userId=...&spaceId=...
//
// Returns scheduled work events the viewer can see, scoped by hierarchy:
//   mine — only events owned by the viewer
//   team — viewer + recursive direct reports (default for managers)
//   all  — admin-only: any user in the org
//
// Sources (in priority order):
//   1. Item with metadata.dueDate set      → kind: TASK
//   2. WeeklyReview.periodStart            → kind: WEEKLY_REVIEW
//   3. SOPAssignment with dueDate          → kind: SOP_ASSIGNMENT
//
// Items are filtered in app code on `metadata.dueDate` (JSONB) — fine for
// MVP, swap to an indexed dueAt column when scale demands it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTeamUserIds } from "@/lib/team";

const ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);
const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR",
  "MANAGER", "TEAM_LEAD",
]);

interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  end?: string | null;
  kind: "TASK" | "WEEKLY_REVIEW" | "SOP_ASSIGNMENT";
  ownerId: string | null;
  ownerName: string | null;
  spaceId?: string | null;
  url: string;
}

async function ctx() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const u = session.user as { id?: string; accessLevel?: string; organizationId?: string };
  if (!u.id || !u.organizationId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId: u.organizationId };
}

function parseDate(input: string | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  const c = await ctx();
  if ("error" in c) return c.error;

  const url = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = parseDate(url.searchParams.get("from")) ?? defaultFrom;
  const to = parseDate(url.searchParams.get("to")) ?? defaultTo;
  const requestedScope = url.searchParams.get("scope");
  const userFilter = url.searchParams.get("userId");
  const spaceFilter = url.searchParams.get("spaceId");

  const isAdmin = ADMIN_LEVELS.has(c.accessLevel);
  const isManager = MANAGER_LEVELS.has(c.accessLevel);

  // Resolve effective scope. Non-managers are pinned to "mine" — they
  // can never see other people's work via this endpoint regardless of
  // what scope they request.
  const effectiveScope = !isManager
    ? "mine"
    : (requestedScope === "all" && isAdmin
        ? "all"
        : requestedScope === "mine"
          ? "mine"
          : "team");

  let userIds: string[] | null = null;
  if (effectiveScope === "mine") {
    userIds = [c.userId];
  } else if (effectiveScope === "team") {
    userIds = await getTeamUserIds(c.organizationId, c.userId);
  } else if (effectiveScope === "all") {
    userIds = null; // any user in org
  }

  // Optional single-user filter (must intersect with scope).
  if (userFilter) {
    if (userIds === null) userIds = [userFilter];
    else if (userIds.includes(userFilter)) userIds = [userFilter];
    else userIds = [];
  }

  if (userIds && userIds.length === 0) {
    return NextResponse.json({ events: [], scope: effectiveScope });
  }

  const userWhere = userIds ? { in: userIds } : undefined;

  // Hydrate names once for all three queries.
  const usersInScope = await prisma.user.findMany({
    where: userIds
      ? { id: { in: userIds }, organizationId: c.organizationId, deletedAt: null }
      : { organizationId: c.organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const nameById = new Map(
    usersInScope.map((u) => [
      u.id,
      ([u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email) as string,
    ]),
  );

  // ── 1. Items with metadata.dueDate in range ─────────────────────
  const items = await prisma.item.findMany({
    where: {
      organizationId: c.organizationId,
      archivedAt: null,
      ownerId: userWhere,
      ...(spaceFilter ? { board: { spaceId: spaceFilter } } : {}),
    },
    select: {
      id: true,
      title: true,
      ownerId: true,
      metadata: true,
      boardId: true,
      board: { select: { slug: true, spaceId: true } },
    },
  });

  const taskEvents: CalendarEvent[] = [];
  for (const it of items) {
    const meta = (it.metadata ?? {}) as Record<string, unknown>;
    const raw = meta.dueDate ?? meta.due_date ?? meta.due ?? meta.endDate;
    if (typeof raw !== "string") continue;
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) continue;
    if (dt < from || dt > to) continue;
    taskEvents.push({
      id: `task:${it.id}`,
      title: it.title,
      start: dt.toISOString(),
      kind: "TASK",
      ownerId: it.ownerId,
      ownerName: it.ownerId ? nameById.get(it.ownerId) ?? null : null,
      spaceId: it.board?.spaceId ?? null,
      url: `/boards/${it.board?.slug ?? it.boardId}?item=${it.id}`,
    });
  }

  // ── 2. WeeklyReview periodStart in range ─────────────────────────
  const reviews = await prisma.weeklyReview.findMany({
    where: {
      organizationId: c.organizationId,
      userId: userWhere,
      periodStart: { gte: from, lte: to },
    },
    select: { id: true, userId: true, periodStart: true, status: true },
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

  // ── 3. SOPAssignment with dueDate in range ───────────────────────
  const sopAssignments = await prisma.sOPAssignment.findMany({
    where: {
      sop: { organizationId: c.organizationId },
      userId: userWhere,
      dueDate: { gte: from, lte: to },
      status: { not: "COMPLETED" },
    },
    select: {
      id: true,
      userId: true,
      dueDate: true,
      sop: { select: { id: true, title: true } },
    },
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

  return NextResponse.json({
    events,
    scope: effectiveScope,
    range: { from: from.toISOString(), to: to.toISOString() },
    people: usersInScope.map((u) => ({
      id: u.id,
      name: nameById.get(u.id) ?? u.email,
    })),
  });
}
