// GET /api/me/items — items assigned to the viewer. Optional
// ?status=open|done|all (default open: any non-DONE status, including null).
// Sorted by dueAt asc nulls last, then position.
//
// Phase 90. Powers the /today personal list and any future "my work" surface.
// These are all tasks the viewer is the assignee of, so they ALWAYS belong
// here: being assigned a task grants access to that task even if you aren't a
// member of its List. (Board access no longer filters this list — that
// silently hid people's own assigned work.)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDoneStatusName } from "@/lib/board-items-shared";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") ?? "open";

  const raw = await prisma.item.findMany({
    where: {
      organizationId: u.organizationId,
      ownerId: u.id,
      archivedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      startAt: true,
      dueAt: true,
      position: true,
      boardId: true,
      parentItemId: true,
    },
    orderBy: [{ dueAt: "asc" }, { position: "asc" }],
    take: 500,
  });

  const filteredByStatus = raw.filter((it) => {
    if (statusFilter === "all") return true;
    // Shared cross-board done rule — same helper /team/workload uses.
    const done = isDoneStatusName(it.status);
    return statusFilter === "done" ? done : !done;
  });

  if (filteredByStatus.length === 0) return NextResponse.json({ items: [] });

  const boardIds = Array.from(new Set(filteredByStatus.map((it) => it.boardId)));
  // Fetch the board only for display (name/list) — assignment already grants
  // access, so we never drop a task the viewer owns.
  const boards = await prisma.board.findMany({
    where: { id: { in: boardIds }, organizationId: u.organizationId },
    select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true },
  });
  const boardById = new Map(boards.map((b) => [b.id, b]));

  const items = filteredByStatus
    .map((it) => ({
      id: it.id,
      title: it.title,
      status: it.status,
      startAt: it.startAt,
      dueAt: it.dueAt,
      parentItemId: it.parentItemId,
      board: boardById.get(it.boardId) ?? null,
    }));

  return NextResponse.json({ items });
}
