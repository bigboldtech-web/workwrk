// PUT /api/boards/[id]/order { movedId, afterId, beforeId, parentId? }: put
// one task between two neighbours by renumbering this List's order,
// POSITION_STEP apart. With `parentId`, the same among that task's subtasks.
//
// WHY. A drag puts a task at the midpoint of its new neighbours
// (src/lib/work/reorder.ts). A view sends it here when it cannot do that
// itself: the neighbours share a position (tasks some paths create all at 0)
// or repeated drops have used up the gap, or the view holds only some pages
// (a drop below the last card it loaded). The client names the task and the
// neighbours it was dropped between; this places it between its TRUE
// neighbours, with one write when they have room (placeInOrder) and by
// renumbering the List when they have none.
//
// THE WHOLE LIST, FROM THE DATABASE. The order is read here, never taken from
// the client: a view with a filter on holds only some of the List, and a
// renumber of what it holds would leave every hidden task at a stale number,
// shuffled among the rest once the filter is cleared. Read under the List's
// order lock, so a drop or a link added at the same moment cannot interleave.
//
// WHAT IT TOUCHES. Only this List's order: the position of each live,
// top-level task homed here, and the link position of each task shown here
// through a link (ItemListLink, Phase 5b), for a live top-level task homed in
// another live List; with `parentId`, only the live subtasks of that task
// homed here. The gate is the one for reordering one linked task here (PATCH
// /api/boards/[id]/links/[itemId]): the List must be readable (404 names
// nothing otherwise) and the viewer must contribute to it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx, itemServerError } from "@/lib/item-gate";
import { boardForViewer, canContributeFor, listLinksAvailable, listOrderLock } from "@/lib/list-links-server";
import { publishItemChanged } from "@/lib/notify-realtime";
import { prisma } from "@/lib/prisma";
import { moveInOrder, placeInOrder, renumberedPositions } from "@/lib/work/reorder";

const id64 = z.string().trim().min(1).max(64);
const bodySchema = z.object({
  movedId: id64,
  afterId: id64.nullable().optional(),
  beforeId: id64.nullable().optional(),
  parentId: id64.optional(),
});

/** Not saved because the List changed under the drop (a neighbour or the task left it). */
class OrderChanged extends Error {}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  if (!(await boardForViewer(c, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canContributeFor(c, id))) return NextResponse.json({ error: "no_access", reason: "list_read_only" }, { status: 403 });
  const { movedId, afterId = null, beforeId = null } = parsed.data;
  const parentId = parsed.data.parentId ?? null;
  // Asked BEFORE the transaction: the check queries the global pool.
  const linksOn = !parentId && (await listLinksAvailable());

  try {
    const positions = await prisma.$transaction(async (tx) => {
      await listOrderLock(tx, id);
      const homes = parentId
        ? await tx.$queryRaw<Array<{ id: string; position: number }>>`
            SELECT i.id, i.position FROM "Item" i
            WHERE i."boardId" = ${id} AND i."organizationId" = ${c.organizationId}
              AND i."parentItemId" = ${parentId} AND i."archivedAt" IS NULL
          `
        : await tx.$queryRaw<Array<{ id: string; position: number }>>`
            SELECT i.id, i.position FROM "Item" i
            WHERE i."boardId" = ${id} AND i."organizationId" = ${c.organizationId}
              AND i."parentItemId" IS NULL AND i."archivedAt" IS NULL
          `;
      const links = linksOn
        ? await tx.$queryRaw<Array<{ id: string; position: number }>>`
            SELECT l."itemId" AS id, l.position FROM "ItemListLink" l
            JOIN "Item" i ON i.id = l."itemId"
            JOIN "Board" hb ON hb.id = i."boardId"
            WHERE l."boardId" = ${id} AND i."organizationId" = ${c.organizationId}
              AND i."boardId" <> ${id} AND i."parentItemId" IS NULL AND i."archivedAt" IS NULL
              AND hb."archivedAt" IS NULL
          `
        : [];
      const order = moveInOrder(
        [...homes, ...links].map((r) => ({ id: r.id, position: Number(r.position) })),
        movedId,
        afterId,
        beforeId,
      );
      if (!order) throw new OrderChanged();
      const linkIds = new Set(links.map((l) => l.id));
      // The true neighbours have room: one write, the moved task alone.
      const stored = new Map([...homes, ...links].map((r) => [r.id, Number(r.position)] as const));
      const single = placeInOrder(order, stored, movedId);
      if (single !== null) {
        const now = new Date();
        if (linkIds.has(movedId)) {
          await tx.$executeRaw`UPDATE "ItemListLink" SET position = ${single} WHERE "itemId" = ${movedId} AND "boardId" = ${id}`;
        } else {
          await tx.$executeRaw`
            UPDATE "Item" SET position = ${single}, "updatedAt" = ${now}
            WHERE id = ${movedId} AND "boardId" = ${id} AND "organizationId" = ${c.organizationId}
          `;
        }
        return new Map([[movedId, single]]);
      }
      const next = renumberedPositions(order);
      const homeRows = order.filter((x) => !linkIds.has(x)).map((x) => ({ id: x, p: next.get(x)! }));
      const linkRows = order.filter((x) => linkIds.has(x)).map((x) => ({ id: x, p: next.get(x)! }));
      if (homeRows.length > 0) {
        // updatedAt moves with the place, only where the place changed: an
        // open List takes a row from its poll only when it is newer, so
        // without it everyone else would keep the old numbers (and drop by
        // them) until a reload. A parameter, so it is UTC like every other
        // write, never the database's own clock.
        const now = new Date();
        await tx.$executeRaw`
          UPDATE "Item" AS i SET position = v.p, "updatedAt" = ${now}
          FROM jsonb_to_recordset(${JSON.stringify(homeRows)}::jsonb) AS v(id text, p float8)
          WHERE i.id = v.id AND i."boardId" = ${id} AND i."organizationId" = ${c.organizationId}
            AND i.position IS DISTINCT FROM v.p
        `;
      }
      if (linkRows.length > 0) {
        await tx.$executeRaw`
          UPDATE "ItemListLink" AS l SET position = v.p
          FROM jsonb_to_recordset(${JSON.stringify(linkRows)}::jsonb) AS v(id text, p float8)
          WHERE l."itemId" = v.id AND l."boardId" = ${id}
            AND l.position IS DISTINCT FROM v.p
        `;
      }
      return next;
    });
    void publishItemChanged({ itemId: movedId, organizationId: c.organizationId, actorId: c.userId });
    return NextResponse.json({ ok: true, positions: Object.fromEntries(positions) });
  } catch (err) {
    if (err instanceof OrderChanged) {
      return NextResponse.json(
        { error: "order_changed", message: "This List changed while you were dragging. It has been reloaded, so try the move again." },
        { status: 409 },
      );
    }
    return itemServerError(err, `PUT /api/boards/${id}/order`);
  }
}
