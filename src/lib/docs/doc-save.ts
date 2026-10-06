// PUT /api/docs/[id] (and its PATCH alias), as a function of WHO is saving.
//
// AI teammates (docs/plans/ai-teammates.md 3.15) add to docs AS the person they
// work for, who is not at the keyboard. A teammate's save has to be the save
// that person would make: the doc gate, Can edit, the page lock, the
// knownUpdatedAt conflict (409), the placement rule for a move, one new
// DocVersion per save and the link sync, in the same order. So the route's
// body lives here, moved verbatim, and both callers come through it:
//
//   PUT /api/docs/[id]    reads the session (resolveSuiteContext) and the JSON
//                         body, then hands both here
//   the teammate tools    build the person's context (the plan's 3.2) and
//                         hand it here with the tool's body
//
// The caller answers only "who is calling". Everything about the doc is
// decided below for the context it is given. The answer is the route's own
// NextResponse.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { docAccess } from "@/lib/doc-access";
import { canReadDocPlace, nodeCtxFromLevel } from "@/lib/access/node-access";
import { DOC_PARENT_EMPTY_REFUSAL, anchorAgreesWithParent, docAnchorInput, isDocAnchorKind, roleAtLeast, type DocHome, type Place } from "@/lib/access/node-rules";
import { checkMove, docAnchorPlaceOf, docHomeOf, docPlaceLive, writeDocTreeMove } from "@/lib/access/node-placement";
import { syncLinksFromBlocks } from "@/lib/doc-link-extract";

const putSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.unknown().optional(),
  // Plain-text excerpt the client extracted from the rich content,
  // for list previews + search.
  excerpt: z.string().max(2000).nullable().optional(),
  // Conflict-detection precondition: the updatedAt the client last
  // observed. When provided and stale, we return 409 instead of
  // silently overwriting a peer's edits.
  knownUpdatedAt: z.string().datetime().optional(),
  // Page-tree placement (Notion-style). These can be patched on their
  // own (a move/reorder) without snapshotting a new version.
  parentId: z.string().nullable().optional(),
  position: z.number().optional(),
  isFolder: z.boolean().optional(),
  // Polymorphic anchor (which Space / Folder this doc lives under in the
  // sidebar tree). Re-anchoring is how a doc moves between a Space root
  // (entityType="SPACE") and a Folder (entityType="FOLDER").
  entityType: z.string().max(40).nullable().optional(),
  entityId: z.string().nullable().optional(),
});

function sameHome(a: DocHome, b: DocHome): boolean {
  if (a.kind !== "anchor" || b.kind !== "anchor") return a.kind === b.kind;
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

export type TreeRow = { entityType: string | null; entityId: string | null; parentId: string | null };
type Refusal = { status: number; body: { error: string; code: string; message: string } };

/**
 * A refusal the person reads. `error` carries the sentence because apiFetch
 * (and so every toast built on r.error) shows `error` before `message`: the
 * row menu used to toast the bare word "forbidden" while the explanation sat
 * unread in `message`. The machine code rides in `code`; `message` keeps the
 * sentence for any caller that reads it.
 */
function refusal(status: number, code: string, message: string): Refusal {
  return { status, body: { error: message, code, message } };
}

/** The anchor or page a move names is out of the viewer's reach. Still a 404, so nothing about that place is confirmed. */
const MOVE_OUT_OF_REACH = "You can't move this doc there: you can't add docs to that place.";

/**
 * A doc move under the placement rule (node-rules P2 and P3), from the doc's
 * place before to its place after. The one copy: PUT refuses with it, and GET
 * ?menu=1 lists the places moveDestinations (the same rule) accepts, so the
 * menu never offers a move the write would refuse.
 *   - A page's anchor must be its parent page's (P3): a split is a 400.
 *   - The destination is the parent page when it has one, else its anchor's
 *     Space, Folder or List (a task's doc goes on the task's List), else the
 *     org root. Moving needs Full access on the doc and on the place it
 *     leaves (and its Space when it leaves every Space), and Can edit where it
 *     goes (P2). Full access on the doc covers what used to be gated on its
 *     own: opening it to the whole org, and leaving a restricted page tree.
 *   - Nesting under a page moves the doc into that page's container too, so
 *     the viewer must reach that container itself, not only the one page
 *     they were shared.
 */
async function treeMoveRefusal(
  ctx: { orgId: string },
  nodeCtx: ReturnType<typeof nodeCtxFromLevel>,
  id: string,
  existing: TreeRow,
  after: TreeRow,
): Promise<Refusal | null> {
  if (after.parentId && after.entityType && after.entityId) {
    const parentHome = await docHomeOf(ctx.orgId, { entityType: null, entityId: null, parentId: after.parentId });
    if (!anchorAgreesWithParent(after, parentHome)) {
      return refusal(400, "invalid_anchor", "A sub-page lives where its parent page lives. Take it out of the page to give it a place of its own.");
    }
  }
  let dest: Place;
  if (after.parentId) {
    dest = { kind: "doc", id: after.parentId };
  } else {
    const anchorPlace = await docAnchorPlaceOf(ctx.orgId, after);
    if (anchorPlace === undefined) return refusal(404, "not found", MOVE_OUT_OF_REACH);
    dest = anchorPlace;
  }
  const check = await checkMove(nodeCtx, { kind: "doc", id }, dest);
  if (!check.ok) return refusal(check.status, check.status === 404 ? "not found" : "forbidden", check.status === 404 ? MOVE_OUT_OF_REACH : check.error);
  // P1: nothing lands in a place that is archived or in Trash (a Folder of an
  // archived Space, a List in a trashed Folder, a page in Trash), the same
  // check a new doc there answers. Asked once the viewer is known to reach
  // the place, so a probe learns nothing about one they cannot open.
  if (!(await docPlaceLive(ctx.orgId, after))) {
    return refusal(400, "place_gone", "That place is archived or in Trash, so nothing can be moved into it.");
  }
  if (after.parentId && !after.entityType) {
    const [homeBefore, homeAfter] = await Promise.all([docHomeOf(ctx.orgId, existing), docHomeOf(ctx.orgId, after)]);
    if (homeAfter.kind === "anchor" && !sameHome(homeBefore, homeAfter)
      && !(await canReadDocPlace(nodeCtx, { entityType: homeAfter.entityType, entityId: homeAfter.entityId }, null))) {
      return refusal(404, "not found", MOVE_OUT_OF_REACH);
    }
  }
  return null;
}

/** Would nesting `docId` under `parentId` put the doc inside its own subtree? */
async function nestsUnderItself(orgId: string, docId: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  for (let hops = 0; cursor && hops < 32; hops += 1) {
    if (cursor === docId) return true;
    const row: { parentId: string | null } | null = await prisma.doc.findFirst({ where: { id: cursor, organizationId: orgId }, select: { parentId: true } });
    cursor = row?.parentId ?? null;
  }
  return false;
}

/**
 * Save one doc body for `ctx`, exactly as PUT /api/docs/[id] does. `body` is
 * the request's JSON (null when it did not parse); the answer is the route's
 * response, status and body included.
 */
export async function saveDocAs(
  ctx: { userId: string; orgId: string; accessLevel: string | null | undefined },
  id: string,
  body: unknown,
): Promise<NextResponse> {
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const existing = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, title: true, content: true, archivedAt: true, entityType: true, entityId: true, updatedAt: true, createdById: true, parentId: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const access = await docAccess(nodeCtx, existing.id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  // Write gate — BEFORE the tree-only fast path, so a view-only member
  // can't move/re-anchor the doc either. 404 for unlisted-on-restricted,
  // 403 read-only for viewers; the client guards persist() so this is
  // only the backstop.
  if (!roleAtLeast(access.unlockedRole, "EDIT")) return NextResponse.json({ error: "read-only" }, { status: 403 });
  // Lock page (change request A4): a locked doc takes content from Full
  // access holders only. Everyone else gets the one 403 the editor already
  // renders as read-only; nothing is silently dropped.
  if (access.locked && !access.canManage) {
    return NextResponse.json({ error: "locked", message: "This doc is locked. Ask the person who locked it to unlock it." }, { status: 403 });
  }

  // Fast-path: a pure tree update (move / reorder / mark-folder) carries no
  // title/content/excerpt — apply it directly without snapshotting a version
  // (reordering shouldn't bloat history). Guard against a doc being its own
  // parent.
  const isTreeOnly =
    parsed.data.title === undefined &&
    parsed.data.content === undefined &&
    parsed.data.excerpt === undefined &&
    (parsed.data.parentId !== undefined || parsed.data.position !== undefined ||
     parsed.data.isFolder !== undefined || parsed.data.entityType !== undefined ||
     parsed.data.entityId !== undefined);
  if (isTreeOnly) {
    if (parsed.data.parentId === id) {
      return NextResponse.json({ error: "cannot nest a note under itself" }, { status: 400 });
    }
    // P3: a parent page is an id or nothing; an empty string once reached the
    // database as a foreign key and answered a bare 500 (round seven, item 4).
    if (parsed.data.parentId === "") {
      return NextResponse.json({ error: DOC_PARENT_EMPTY_REFUSAL, code: "invalid_parent", message: DOC_PARENT_EMPTY_REFUSAL }, { status: 400 });
    }
    // NOTEPAD anchors are create-only and immutable: re-anchoring TO a
    // notepad would plant a doc in someone's private note list (or hide an
    // org doc as the caller's own note), and re-anchoring AWAY would leak a
    // personal note into /docs. Neither has a legitimate caller.
    if (
      parsed.data.entityType === "NOTEPAD" ||
      (existing.entityType === "NOTEPAD" &&
        (parsed.data.entityType !== undefined || parsed.data.entityId !== undefined))
    ) {
      return NextResponse.json({ error: "notepad notes cannot be re-anchored" }, { status: 400 });
    }
    // A change of anchor or parent page is a MOVE under the placement rule
    // (node-rules P2 and P3, treeMoveRefusal). A doc moves only onto an
    // anchor type the model knows (M2) and never under itself. A position or
    // folder-flag change under the same parent is a reorder and keeps the Can
    // edit gate above (P4).
    const anchorChanges = parsed.data.entityType !== undefined || parsed.data.entityId !== undefined;
    // P3: both halves of the anchor or neither, once the patch is laid over
    // the row (docAnchorInput): a kind with an empty id, or an id with no
    // kind, was once stored as-is (round seven, item 3).
    const anchorIn = docAnchorInput(
      parsed.data.entityType !== undefined ? parsed.data.entityType : existing.entityType,
      parsed.data.entityId !== undefined ? parsed.data.entityId : existing.entityId,
    );
    if (anchorChanges && !anchorIn.ok) {
      return NextResponse.json({ error: anchorIn.error, code: "invalid_anchor", message: anchorIn.error }, { status: 400 });
    }
    const nextType = anchorIn.ok ? anchorIn.entityType : existing.entityType;
    const nextId = anchorIn.ok ? anchorIn.entityId : existing.entityId;
    const parentChanges = parsed.data.parentId !== undefined && parsed.data.parentId !== existing.parentId;
    // M2: only onto an anchor the model knows (node-rules DOC_ANCHOR_KINDS, the set POST /api/docs makes docs on).
    if (anchorChanges && nextType && !isDocAnchorKind(nextType)) {
      return NextResponse.json({ error: "invalid_anchor", message: "A doc can move to a Space, a Folder, a List or a task." }, { status: 400 });
    }
    if (parentChanges && parsed.data.parentId && (await nestsUnderItself(ctx.orgId, id, parsed.data.parentId))) {
      return NextResponse.json({ error: "cannot nest a note under itself" }, { status: 400 });
    }
    const nextParent = parsed.data.parentId !== undefined ? parsed.data.parentId : existing.parentId;
    const after = { entityType: nextType ?? null, entityId: nextId ?? null, parentId: nextParent ?? null };
    const placeChanges = parentChanges || (anchorChanges && (after.entityType !== existing.entityType || after.entityId !== existing.entityId));
    if (placeChanges) {
      const refused = await treeMoveRefusal(ctx, nodeCtx, id, existing, after);
      if (refused) return NextResponse.json(refused.body, { status: refused.status });
    }
    // P3: a move takes the whole page tree with it. A page beneath this one
    // that carries a place of its own takes this doc's new home in the same
    // transaction (writeDocTreeMove), so a sub-page never stays in the old
    // Folder or Space under a parent in the new one.
    const written = await writeDocTreeMove(ctx.orgId, id, {
      ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
      ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
      ...(parsed.data.isFolder !== undefined ? { isFolder: parsed.data.isFolder } : {}),
      ...(anchorChanges ? { entityType: nextType, entityId: nextId } : {}),
    }, placeChanges ? after : null);
    if (!written.ok) return NextResponse.json(refusal(written.status, written.status === 400 ? "cannot_nest" : "split_tree", written.error).body, { status: written.status });
    return NextResponse.json({ doc: written.doc, movedPages: written.rewritten });
  }

  // One save of a doc at a time. The conflict check, the next version number
  // and what a partial save keeps (the title or the content it does not send)
  // are read from the live row under its lock, in the same transaction as the
  // writes. Read before it, two saves at once (a person and their AI teammate,
  // say) could both pass the check and one silently overwrite the other, take
  // the same version number (the second then failed on the unique key and was
  // lost), or put back content the other had just saved.
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Doc" WHERE "id" = ${id} FOR UPDATE`;
    const live = await tx.doc.findUnique({ where: { id }, select: { title: true, content: true, updatedAt: true } });
    if (!live) return { missing: true as const };

    // Optimistic-concurrency precondition. The client sends the updatedAt
    // it last observed; if the row has moved on, we 409 and let the UI
    // prompt the writer to reload before overwriting a peer's work.
    if (parsed.data.knownUpdatedAt && new Date(parsed.data.knownUpdatedAt).getTime() < live.updatedAt.getTime()) {
      return { conflict: live.updatedAt };
    }

    // Compute the next version number for this Doc. Versions are
    // monotonic + unique, so we just take MAX + 1 (under the lock).
    const last = await tx.docVersion.findFirst({
      where: { docId: id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    const nextTitle = parsed.data.title ?? live.title;
    const nextContent = (parsed.data.content as object) ?? (live.content as object);

    // Snapshot the new version + update the live Doc. If either fails, both
    // roll back.
    await tx.docVersion.create({
      data: {
        docId: id,
        version: nextVersion,
        title: nextTitle,
        content: nextContent,
        authorId: ctx.userId,
      },
    });
    const doc = await tx.doc.update({
      where: { id },
      data: {
        title: nextTitle,
        content: nextContent,
        ...(parsed.data.excerpt !== undefined ? { excerpt: parsed.data.excerpt } : {}),
      },
      select: { id: true, title: true, content: true, excerpt: true, updatedAt: true },
    });
    return { doc, nextVersion, nextContent };
  }, { timeout: 30_000, maxWait: 10_000 });
  if ("missing" in saved) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ("conflict" in saved) {
    return NextResponse.json(
      {
        error: "conflict",
        message: "This note was edited elsewhere. Reload to see the latest version before saving again.",
        liveUpdatedAt: saved.conflict,
      },
      { status: 409 },
    );
  }
  const { doc, nextVersion, nextContent } = saved;

  // Outgoing-link sync — fire-and-forget. Keeps the EntityLink graph
  // current so backlinks queries are an indexed lookup, not a scan.
  void syncLinksFromBlocks({
    organizationId: ctx.orgId,
    sourceType: "DOC",
    sourceId: id,
    content: nextContent,
    createdById: ctx.userId,
  }).catch((err) => {
    console.warn("[docs PUT] syncLinksFromBlocks failed", err);
  });

  return NextResponse.json({ doc, version: nextVersion });
}
