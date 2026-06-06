// GET /api/me/items — items assigned to the viewer across all visible
// boards. Optional ?status=open|done|all (default open: any non-DONE
// status, including null). Sorted by dueAt asc nulls last, then position.
//
// Phase 90. Powers the /today personal list and any future "my work"
// surface. Visibility is composed per board via getBoardForReader so
// items in boards the viewer lost access to silently drop.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBoardForReader } from "@/lib/board";

const DONE_STATUSES = new Set(["done", "complete", "completed", "closed", "resolved"]);

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
    const s = (it.status ?? "").toLowerCase();
    const done = DONE_STATUSES.has(s);
    return statusFilter === "done" ? done : !done;
  });

  if (filteredByStatus.length === 0) return NextResponse.json({ items: [] });

  const boardIds = Array.from(new Set(filteredByStatus.map((it) => it.boardId)));
  const accessLevel = u.accessLevel ?? "EMPLOYEE";
  const readable = await Promise.all(
    boardIds.map(async (bid) => ((await getBoardForReader(bid, u.id!, accessLevel)) ? bid : null)),
  );
  const readableSet = new Set(readable.filter((x): x is string => x !== null));

  const boards = await prisma.board.findMany({
    where: { id: { in: Array.from(readableSet) } },
    select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true },
  });
  const boardById = new Map(boards.map((b) => [b.id, b]));

  const items = filteredByStatus
    .filter((it) => readableSet.has(it.boardId))
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
