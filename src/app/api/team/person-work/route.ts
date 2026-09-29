// GET /api/team/person-work?userId=: one person's open work, for the
// "Working on" list on their record's Overview tab (spec-teams-people /team,
// the "+2" on a My team row). The viewer must be able to read the person's
// people data (their chain, the People team, Admin, the legacy org-wide
// levels); the items are only those on Lists the VIEWER can read, so a title
// on a List they cannot open never appears. Soonest due first, undated last,
// with the honest total, a page of 50 at a time: `cursor` is the offset
// into that ordering and `nextCursor` is null on the last page, so every
// open item is reachable (Show more), never a silent cap.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { peopleCtx, relationTo } from "@/lib/people/person-access.server";
import { readableBoardsFor } from "@/lib/people/team-boards.server";

export async function GET(req: NextRequest) {
  const ctx = await peopleCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  const cursorRaw = Number(req.nextUrl.searchParams.get("cursor") ?? "0");
  const offset = Number.isFinite(cursorRaw) && cursorRaw > 0 ? Math.floor(cursorRaw) : 0;
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const relation = userId ? relationTo(ctx, userId) : "none";
  if (relation === "none" || relation === "self") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const person = await prisma.user.findFirst({ where: { id: userId, organizationId: ctx.organizationId }, select: { id: true } });
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const boards = await readableBoardsFor(ctx.viewer);
  if (!boards.ids.length) return NextResponse.json({ items: [], total: 0, nextCursor: null }, { headers: { "Cache-Control": "no-store" } });
  const rows = await prisma.item.findMany({
    where: {
      organizationId: ctx.organizationId,
      archivedAt: null,
      boardId: { in: boards.ids },
      OR: [{ ownerId: userId }, { assigneeIds: { has: userId } }],
    },
    select: { id: true, title: true, status: true, dueAt: true, priority: true, boardId: true },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }, { id: "asc" }],
  });
  const open = rows.filter((r) => !boards.isDone(r.boardId, r.status));
  const end = offset + limit;
  return NextResponse.json(
    {
      total: open.length,
      nextCursor: end < open.length ? String(end) : null,
      items: open.slice(offset, end).map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
        board: { id: r.boardId, name: boards.byId.get(r.boardId)?.name ?? "" },
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
