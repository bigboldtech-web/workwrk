// GET /api/me/items — items assigned to the viewer. Optional
// ?status=open|done|all (default open: open in its own List's status set,
// including no status).
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
import { doneParamWhere, splitDoneByList } from "@/lib/list-done";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string; accessLevel?: string } | undefined;
  if (!u?.id || !u.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") ?? "open";

  const mine = {
    organizationId: u.organizationId,
    ...NOT_SYSTEM_ITEMS,
    // Any task I'm an assignee of — primary owner OR one of several assignees.
    OR: [{ ownerId: u.id }, { assigneeIds: { has: u.id } }],
    archivedAt: null,
  };

  // Done is decided by each task's own List, in SQL (src/lib/list-done.ts).
  // The five words isDoneStatusName knows were the whole rule here, after a
  // read of the 500 oldest tasks by due date: a Published post stayed in the
  // Clock and Timesheets pickers for good, and a person with 500 finished
  // tasks behind them had an empty picker with open work still to log.
  // `all` (the canvas link picker) needs no split.
  const split = statusFilter === "all" ? null : await splitDoneByList(mine, u.organizationId);
  const doneWhere = split ? doneParamWhere(statusFilter === "done" ? "only" : "0", split) : null;
  const raw = await prisma.item.findMany({
    where: doneWhere ? { AND: [mine, doneWhere] } : mine,
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

  // A row whose status moved after the groupBy is judged again here.
  const filteredByStatus = raw.filter((it) => {
    if (!split) return true;
    const done = split.isDone(it.boardId, it.status);
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
