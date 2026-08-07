// GET /api/team/members-work — the Team pulse feed: every member the
// caller may see (admins = org-wide, everyone else = self + reports via
// getTeamUserIds, mirroring /api/users scope enforcement) with their
// current work summarized per person: status counts, open/done/overdue,
// up to 3 "working on" items and 2 recent activity rows.
//
// Read-only. Item visibility composes through getBoardForReader exactly
// like src/lib/everything.ts — boards are gated ONCE for the caller,
// then a single Item query covers all members, so titles from boards
// the viewer can't read never leak.
//
// Caps: newest 2000 items / 300 activity rows across the whole member
// set — very large orgs truncate oldest data and counts read low, which
// is acceptable for v1 (matches the Everything feed's windowing).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBoardForReader } from "@/lib/board";
import { getTeamUserIds } from "@/lib/team";

function normalizeStatus(s?: string | null): "done" | "in-progress" | "todo" {
  const t = (s ?? "").toLowerCase();
  if (/(done|complete|closed|resolved|shipped)/.test(t)) return "done";
  if (/(progress|doing|active|review|started|working)/.test(t)) return "in-progress";
  return "todo";
}

interface PulseBoardRef {
  id: string;
  slug: string;
  name: string;
}

interface PulseItem {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: string | null;
  board: PulseBoardRef;
}

interface PulseActivity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
}

interface ItemRow {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: Date | null;
  updatedAt: Date;
  ownerId: string | null;
  boardId: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = u.organizationId;
  const userId = u.id;
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const isAdmin = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  // Member scope — same enforcement as /api/users: non-admins can never
  // escape team scope (self + all direct/indirect reports).
  const teamIds = isAdmin ? null : await getTeamUserIds(orgId, userId);
  const members = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      ...(teamIds ? { id: { in: teamIds.length > 0 ? teamIds : [userId] } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      status: true,
      role: { select: { title: true } },
      department: { select: { name: true } },
    },
    orderBy: { firstName: "asc" },
  });
  if (members.length === 0) return NextResponse.json({ members: [] });
  const memberIds = members.map((m) => m.id);

  // Board gating — gate once for the caller (NOT per member), then one
  // Item query across all members. Same N+1 fan-out everything.ts accepts.
  const boards = await prisma.board.findMany({
    where: { organizationId: orgId, archivedAt: null },
    select: { id: true, slug: true, name: true },
  });
  const readable = await Promise.all(
    boards.map(async (b) => ((await getBoardForReader(b.id, userId, accessLevel)) ? b : null)),
  );
  const readableBoards = readable.filter((b): b is (typeof boards)[number] => b !== null);
  const boardById = new Map(readableBoards.map((b) => [b.id, b] as const));

  const [items, activity] = await Promise.all([
    boardById.size > 0
      ? prisma.item.findMany({
          where: {
            organizationId: orgId,
            boardId: { in: Array.from(boardById.keys()) },
            ownerId: { in: memberIds },
            archivedAt: null,
          },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            updatedAt: true,
            ownerId: true,
            boardId: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 2000,
        })
      : Promise.resolve([] as ItemRow[]),
    prisma.activityLog.findMany({
      where: { organizationId: orgId, actorId: { in: memberIds } },
      select: { id: true, actorId: true, type: true, description: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  const itemsByOwner = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.ownerId) continue;
    const list = itemsByOwner.get(it.ownerId);
    if (list) list.push(it);
    else itemsByOwner.set(it.ownerId, [it]);
  }
  const activityByActor = new Map<string, typeof activity>();
  for (const a of activity) {
    const list = activityByActor.get(a.actorId);
    if (list) {
      if (list.length < 2) list.push(a);
    } else {
      activityByActor.set(a.actorId, [a]);
    }
  }

  const now = new Date();

  const payload = members.map((m) => {
    const mine = itemsByOwner.get(m.id) ?? [];
    const statusCounts: Record<string, number> = {};
    let open = 0;
    let done = 0;
    let overdue = 0;
    for (const it of mine) {
      const key = it.status ?? "__unset__";
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      const isDone = normalizeStatus(it.status) === "done";
      if (isDone) done += 1;
      else open += 1;
      if (it.dueAt && it.dueAt < now && !isDone) overdue += 1;
    }

    // "Working on" — in-progress first; when custom statuses defeat the
    // regex (e.g. "On hold" reads as todo), fall back to the 3 most
    // recently touched non-done items so the strip never sits empty
    // while open work exists.
    const toPulseItem = (it: (typeof mine)[number]): PulseItem => {
      const board = boardById.get(it.boardId)!;
      return {
        id: it.id,
        title: it.title,
        status: it.status,
        priority: it.priority,
        dueAt: it.dueAt ? it.dueAt.toISOString() : null,
        board: { id: board.id, slug: board.slug, name: board.name },
      };
    };
    let working = mine.filter((it) => normalizeStatus(it.status) === "in-progress").slice(0, 3);
    if (working.length === 0) {
      working = mine.filter((it) => normalizeStatus(it.status) !== "done").slice(0, 3);
    }
    const inProgress: PulseItem[] = working.map(toPulseItem);

    const recent: PulseActivity[] = (activityByActor.get(m.id) ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
    }));

    return {
      id: m.id,
      name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim(),
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email,
      avatar: m.avatar,
      roleTitle: m.role?.title ?? null,
      department: m.department?.name ?? null,
      status: m.status,
      total: mine.length,
      open,
      done,
      overdue,
      statusCounts,
      inProgress,
      recent,
    };
  });

  // Most loaded first — mirrors board-workload-view's ordering.
  payload.sort((a, b) => b.open - a.open);

  return NextResponse.json({ members: payload });
}
