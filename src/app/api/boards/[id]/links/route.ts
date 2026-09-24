// POST /api/boards/[id]/links: add existing tasks to this List (ClickUp "Add
//                              to List"; decision 7). Partial success is the
//                              contract, as in /api/items/bulk.
// GET  /api/boards/[id]/links: how many tasks this List shares in and out, for
//                              the delete and archive confirmations.
//
// ADDING needs content-write on BOTH the task's home List and this one: a link
// is an explicit share, so the person making it must be able to write where
// the task lives and where it is going. The List is gated before any task is
// read, and each task is answered IN AN ORDER THAT REVEALS NOTHING
// (decideAddLink): a task the caller cannot read is "item_not_found" before
// anything else about it is consulted.
//
// The write is ONE transaction under the List's order lock with the task rows
// locked (addItemsToList), so a move into this List that committed first is
// seen, and a task can never be both home here and linked here. Every access
// question is answered before that transaction opens; a task that moved in
// between answers home_changed, and the caller retries it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx, itemServerError } from "@/lib/item-gate";
import { isMissingListLinkTableError } from "@/lib/list-links";
import {
  addItemsToList,
  boardForViewer,
  canContributeFor,
  linksUnavailableResponse,
  listLinksAvailable,
  listReader,
  markListLinksMissing,
  readableItemsVia,
  withListLinks,
} from "@/lib/list-links-server";
import { publishItemChanged } from "@/lib/notify-realtime";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  itemIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
});

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

/** The List, when the caller can read it in their own org; else null (404). */
async function readableList(id: string, c: Ctx) {
  if (!(await boardForViewer(c, id))) return null;
  return prisma.board.findFirst({
    where: { id, organizationId: c.organizationId },
    select: { id: true, archivedAt: true, itemType: true, productSlug: true, settings: true },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;

  const list = await readableList(id, c);
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (list.archivedAt) return NextResponse.json({ error: "list_archived" }, { status: 409 });
  const system = !!list.settings && typeof list.settings === "object" && (list.settings as Record<string, unknown>).system === true;
  if (system || list.itemType !== "studio-item") return NextResponse.json({ error: "not_a_task_list" }, { status: 409 });
  if (list.productSlug === "personal-list") {
    return NextResponse.json({ error: "no_access", reason: "personal_list_not_a_link_target" }, { status: 403 });
  }
  if (!(await canContributeFor(c, id))) {
    return NextResponse.json({ error: "no_access", reason: "list_read_only", requestAccess: true }, { status: 403 });
  }
  if (!(await listLinksAvailable())) return linksUnavailableResponse();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const itemIds = Array.from(new Set(parsed.data.itemIds));

  try {
    // (1) One org-scoped read for every id, and one readability pass. A
    // missing id, another org's id and an unreadable id all end the same way.
    const items = await prisma.item.findMany({
      where: { id: { in: itemIds }, organizationId: c.organizationId },
      select: { id: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true, itemType: true },
    });
    const reader = listReader(c);
    const access = await readableItemsVia(c, items, reader);
    const readable = new Map(items.map((i) => [i.id, access.get(i.id)?.readable ?? false] as const));
    const preReadHome = new Map(items.map((i) => [i.id, i.boardId] as const));
    // (2) Can the caller write each readable task's home? Asked HERE, before
    // the transaction: the access helpers query the global pool, and asking
    // from inside the transaction deadlocked the pool under a burst of adds.
    const homes = Array.from(new Set(items.filter((i) => readable.get(i.id)).map((i) => i.boardId)));
    const contributeHome = new Map(
      await Promise.all(homes.map(async (h) => [h, await canContributeFor(c, h)] as const)),
    );

    // (3) The write, on locked rows, querying nothing but its transaction.
    const results = await addItemsToList({
      viewer: c,
      boardId: id,
      itemIds,
      readable,
      preReadHome,
      contributeHome,
    });

    for (const r of results) {
      if (r.ok && r.created) {
        void publishItemChanged({ itemId: r.itemId, organizationId: c.organizationId, actorId: c.userId });
      }
    }
    return NextResponse.json({ results });
  } catch (err) {
    if (isMissingListLinkTableError(err)) {
      markListLinksMissing();
      return linksUnavailableResponse();
    }
    return itemServerError(err, `POST /api/boards/${id}/links`);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  if (!(await boardForViewer(c, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const counts = await withListLinks(
      async () => {
        // Tasks from other Lists shown here, top level and live, with a live home.
        const sharedIn = await prisma.itemListLink.count({
          where: {
            boardId: id,
            item: { parentItemId: null, boardId: { not: id }, archivedAt: null, board: { archivedAt: null } },
          },
        });
        // This List's tasks shown in OTHER Lists, counting only Lists the
        // caller can read: an unreadable List is never counted.
        const out = await prisma.itemListLink.findMany({
          where: { item: { boardId: id }, boardId: { not: id } },
          select: { itemId: true, boardId: true },
        });
        const reader = listReader(c);
        const shared = new Set<string>();
        for (const l of out) {
          if (shared.has(l.itemId)) continue;
          if (await reader.row(l.boardId)) shared.add(l.itemId);
        }
        return { sharedIn, sharedOut: shared.size };
      },
      { sharedIn: 0, sharedOut: 0 },
    );
    return NextResponse.json(counts, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return itemServerError(err, `GET /api/boards/${id}/links`);
  }
}
