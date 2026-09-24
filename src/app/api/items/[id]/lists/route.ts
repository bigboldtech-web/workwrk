// GET    /api/items/[id]/lists: the Lists this task appears in, as THIS viewer
//                              may see them (its home, and the secondary Lists
//                              they can read)
// DELETE /api/items/[id]/lists: take the task out of EVERY secondary List
//
// Phase 5b, tasks in more than one List (decision 7). Gated on the ITEM ref
// like every other item route (src/lib/item-gate.ts).
//
// NOTHING HERE COUNTS WHAT THE VIEWER CANNOT SEE. A secondary List the viewer
// cannot read is omitted and never counted, the DELETE answers no count, and
// a viewer who reached the task only through a List it is linked into is told
// nothing about its home: not its id, not its name.

import { NextResponse } from "next/server";
import { gateItem, itemCtx, itemServerError, listIsReadable } from "@/lib/item-gate";
import { isMissingListLinkTableError } from "@/lib/list-links";
import {
  canContributeFor,
  linkedListsOf,
  linksUnavailableResponse,
  listLinksAvailable,
  listReader,
  markListLinksMissing,
} from "@/lib/list-links-server";
import { publishItemChanged } from "@/lib/notify-realtime";
import { prisma } from "@/lib/prisma";
import { isSystemItemType } from "@/lib/system-items";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  try {
    const gate = await gateItem(id, c, "view");
    if ("error" in gate) return gate.error;
    const item = gate.item;
    const linkedOnly = gate.decision.via === "linked-list";

    // The home crumb, by the rule the task page already uses (access example
    // B): a link for a reader of the List, a grey label for someone holding a
    // personal role, and nothing at all for a linked-only reader.
    let home: { id: string; slug: string; name: string; readable: boolean } | { readable: false };
    if (linkedOnly) home = { readable: false };
    else {
      const readable = await listIsReadable(item, c);
      home = { id: item.board.id, slug: item.board.slug, name: item.board.name, readable };
    }

    const available = await listLinksAvailable();
    const { rootId, links } = available ? await linkedListsOf(item) : { rootId: item.id, links: [] };
    const reader = listReader(c);
    const linked: Array<{ boardId: string; slug: string; name: string; position: number; addedAt: string }> = [];
    for (const l of links) {
      const b = await reader.row(l.boardId);
      if (!b) continue;
      linked.push({ boardId: b.id, slug: b.slug, name: b.name, position: l.position, addedAt: l.createdAt.toISOString() });
    }

    const canShare =
      available &&
      !item.parentItemId &&
      !item.archivedAt &&
      !isSystemItemType(item.itemType) &&
      (await canContributeFor(c, item.boardId));

    return NextResponse.json(
      {
        home,
        linked,
        // Only when the task really appears in those Lists through its parent.
        viaParentId: rootId !== item.id && linked.length > 0 ? rootId : null,
        canShare,
        canUnshareAll: gate.decision.role === "FULL",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return itemServerError(err, `GET /api/items/${id}/lists`);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;
  // FULL only: an org admin, the creator, or the home List's managers. It
  // pulls the task out of Lists the caller may not be able to read, which is
  // exactly the point (a private task someone shared into a List the home
  // manager cannot see), and exactly why a linked-only VIEW reader cannot.
  if (gate.decision.role !== "FULL") {
    return NextResponse.json({ error: "no_access", reason: "role_too_low" }, { status: 403 });
  }
  if (!(await listLinksAvailable())) return linksUnavailableResponse();
  try {
    const removed = await prisma.$transaction(async (tx) => {
      const rows = await tx.itemListLink.findMany({ where: { itemId: id }, select: { boardId: true } });
      // The Item row is never written: only its links go.
      await tx.itemListLink.deleteMany({ where: { itemId: id } });
      return rows.map((r) => r.boardId);
    });
    if (removed.length) {
      void publishItemChanged({
        itemId: id,
        boardId: gate.item.boardId,
        organizationId: c.organizationId,
        actorId: c.userId,
        listIds: [gate.item.boardId],
        leftListIds: removed,
      });
    }
    // No count: a number would describe Lists the caller cannot read.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingListLinkTableError(err)) {
      markListLinksMissing();
      return linksUnavailableResponse();
    }
    return itemServerError(err, `DELETE /api/items/${id}/lists`);
  }
}
