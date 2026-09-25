// DELETE /api/boards/[id]/links/[itemId]: take a task out of THIS List only.
// PATCH  /api/boards/[id]/links/[itemId]: reorder it inside this List
//                                         ({ position }), or "Move to List"
//                                         pressed inside this List
//                                         ({ moveToBoardId }).
//
// Removing a link never touches the task: its row, its field values and its
// namespace for this List all stay, so adding it back brings the values back.
// The answers are chosen so that nobody learns a link exists who cannot see
// it (decideLinkRemoval): an unreadable List is 404 whatever the link state,
// and a missing link is 404 too.
//
// A move from INSIDE a secondary List moves the link, never the task's home.
// Re-homing a task is PATCH /api/items/[id] { boardId }, from its home.

import { NextResponse } from "next/server";
import { z } from "zod";
import { itemCtx, itemServerError } from "@/lib/item-gate";
import { decideLinkRemoval, isMissingListLinkTableError } from "@/lib/list-links";
import {
  boardForViewer,
  canContributeFor,
  isLinkTarget,
  linksUnavailableResponse,
  listLinksAvailable,
  listOrderLock,
  markListLinksMissing,
  nextPositionInList,
} from "@/lib/list-links-server";
import { publishItemChanged } from "@/lib/notify-realtime";
import { prisma } from "@/lib/prisma";

type Ctx = Exclude<Awaited<ReturnType<typeof itemCtx>>, { error: NextResponse }>;

async function listReadable(id: string, c: Ctx): Promise<boolean> {
  return !!(await boardForViewer(c, id));
}

/** The link and its task, in this org, or null. */
async function loadLink(boardId: string, itemId: string, c: Ctx) {
  const link = await prisma.itemListLink.findUnique({
    where: { itemId_boardId: { itemId, boardId } },
    include: { item: { select: { id: true, boardId: true, organizationId: true, parentItemId: true } } },
  });
  if (!link || link.item.organizationId !== c.organizationId) return null;
  return link;
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, itemId } = await params;
  if (!(await listReadable(id, c))) return notFound();
  if (!(await listLinksAvailable())) return linksUnavailableResponse();
  try {
    const link = await loadLink(id, itemId, c);
    const verdict = decideLinkRemoval({
      listReadable: true,
      linkExists: !!link,
      canContributeList: link ? await canContributeFor(c, id) : false,
      canContributeHome: link ? await canContributeFor(c, link.item.boardId) : false,
    });
    if (verdict === 404) return notFound();
    if (verdict === 403) return NextResponse.json({ error: "no_access", reason: "list_read_only" }, { status: 403 });
    await prisma.itemListLink.deleteMany({ where: { itemId, boardId: id } });
    void publishItemChanged({ itemId, organizationId: c.organizationId, actorId: c.userId, leftListIds: [id] });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isMissingListLinkTableError(err)) {
      markListLinksMissing();
      return linksUnavailableResponse();
    }
    return itemServerError(err, `DELETE /api/boards/${id}/links/${itemId}`);
  }
}

const patchSchema = z.union([
  z.object({ position: z.number().finite() }).strict(),
  z.object({ moveToBoardId: z.string().trim().min(1).max(64) }).strict(),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id, itemId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  if (!(await listReadable(id, c))) return notFound();
  if (!(await listLinksAvailable())) return linksUnavailableResponse();

  try {
    const link = await loadLink(id, itemId, c);
    if (!link) return notFound();

    // ── Reorder inside this List. Item.position is the HOME order and is
    // never written through a link.
    if ("position" in parsed.data) {
      if (!(await canContributeFor(c, id))) {
        return NextResponse.json({ error: "no_access", reason: "list_read_only" }, { status: 403 });
      }
      const position = parsed.data.position;
      await prisma.itemListLink.update({ where: { itemId_boardId: { itemId, boardId: id } }, data: { position } });
      void publishItemChanged({ itemId, organizationId: c.organizationId, actorId: c.userId });
      return NextResponse.json({ ok: true, position });
    }

    // ── Move the link to another List. The removal rule on this List AND the
    // add rule on the target, both, before anything is written.
    const targetId = parsed.data.moveToBoardId;
    const home = link.item.boardId;
    const [canList, canHome] = await Promise.all([
      canContributeFor(c, id),
      canContributeFor(c, home),
    ]);
    const removal = decideLinkRemoval({ listReadable: true, linkExists: true, canContributeList: canList, canContributeHome: canHome });
    if (removal === 404) return notFound();
    if (removal === 403) return NextResponse.json({ error: "no_access", reason: "list_read_only" }, { status: 403 });
    if (!(await listReadable(targetId, c))) return notFound();
    if (targetId === home) return NextResponse.json({ error: "already_home" }, { status: 409 });
    const target = await prisma.board.findFirst({
      where: { id: targetId, organizationId: c.organizationId },
      select: { id: true, archivedAt: true, itemType: true, productSlug: true, settings: true },
    });
    if (!target) return notFound();
    if (target.archivedAt) return NextResponse.json({ error: "list_archived" }, { status: 409 });
    if (target.productSlug === "personal-list") {
      return NextResponse.json({ error: "no_access", reason: "personal_list_not_a_link_target" }, { status: 403 });
    }
    if (!isLinkTarget(target)) return NextResponse.json({ error: "not_a_task_list" }, { status: 409 });
    const canTarget = await canContributeFor(c, targetId);
    if (!canTarget || !canHome) {
      return NextResponse.json({ error: "no_access", reason: canTarget ? "home_list_read_only" : "list_read_only", requestAccess: true }, { status: 403 });
    }

    const outcome = await prisma.$transaction(
      async (tx) => {
        await listOrderLock(tx, targetId);
        const locked = await tx.$queryRaw<Array<{ boardId: string; parentItemId: string | null }>>`
          SELECT "boardId", "parentItemId" FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
        const row = locked[0];
        // Re-checked on the locked row: a task that became home in the target,
        // or a subtask, cannot take this link.
        if (!row || row.parentItemId) return { kind: "gone" as const };
        if (row.boardId === targetId) return { kind: "home" as const };
        // The home write right was answered for the home read above. A task
        // that moved since is refused rather than re-asked from in here: the
        // access helpers use the global pool, which a transaction must not.
        if (row.boardId !== home) return { kind: "home_changed" as const };
        const current = await tx.itemListLink.findUnique({ where: { itemId_boardId: { itemId, boardId: id } } });
        if (!current) return { kind: "gone" as const };
        const already = await tx.itemListLink.findUnique({ where: { itemId_boardId: { itemId, boardId: targetId } } });
        await tx.itemListLink.delete({ where: { itemId_boardId: { itemId, boardId: id } } });
        if (already) return { kind: "already" as const, position: already.position };
        // listLinksAvailable() answered true before the transaction opened.
        const position = await nextPositionInList(tx, targetId, true);
        await tx.itemListLink.create({ data: { itemId, boardId: targetId, position, addedById: c.userId } });
        return { kind: "moved" as const, position };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (outcome.kind === "gone") return notFound();
    if (outcome.kind === "home") return NextResponse.json({ error: "already_home" }, { status: 409 });
    if (outcome.kind === "home_changed") return NextResponse.json({ error: "home_changed", retry: true }, { status: 409 });
    void publishItemChanged({ itemId, organizationId: c.organizationId, actorId: c.userId, leftListIds: [id] });
    if (outcome.kind === "already") return NextResponse.json({ ok: true, alreadyLinked: true });
    return NextResponse.json({ ok: true, position: outcome.position });
  } catch (err) {
    if (isMissingListLinkTableError(err)) {
      markListLinksMissing();
      return linksUnavailableResponse();
    }
    return itemServerError(err, `PATCH /api/boards/${id}/links/${itemId}`);
  }
}
