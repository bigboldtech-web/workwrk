// /api/docs/[id] — load, save, soft-archive a Doc.
//
// Critical guarantees:
//   - Every save creates a new immutable DocVersion. No save is silent.
//   - DELETE is soft-archive only (sets archivedAt). The row stays.
//   - Versions are NEVER touched on archive — full history persists.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { z } from "zod";
import { canCreateDocAt, docAccess, docAccessible } from "@/lib/doc-access";
import { requireDocRole } from "@/lib/doc-sharing";
import { canReadDocPlace, nodeCtxFromLevel } from "@/lib/access/node-access";
import { DOC_PARENT_EMPTY_REFUSAL, anchorAgreesWithParent, docAnchorInput, isDocAnchorKind, roleAtLeast, type DocHome, type Place } from "@/lib/access/node-rules";
import { checkMove, docAnchorPlaceOf, docHomeOf, docPlaceLive, moveDestinations, writeDocTreeMove } from "@/lib/access/node-placement";
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
import { syncLinksFromBlocks } from "@/lib/doc-link-extract";
import { withArchivedBy } from "@/lib/archived-by";
import { resolveDocLocation } from "@/lib/doc-location";
import { readDocLock } from "@/lib/doc-lock";

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

/**
 * The parent page the crumb and the Back link name, ONLY when this viewer can
 * read it through the SAME gate the parent's own GET applies (docAccess, the
 * one resolver). A sub-page follows its parent (A6), but it can carry a grant
 * of its own, so it can be readable while its parent is not; naming the
 * parent then would hand its title to someone its own URL answers 404.
 * Unreadable is null, exactly like a doc with no parent, so the page falls
 * back to the anchor.
 */
async function readableParent(
  ctx: { orgId: string; userId: string; accessLevel: string | null | undefined },
  parentId: string,
): Promise<{ id: string; title: string } | null> {
  const p = await prisma.doc.findFirst({
    where: { id: parentId, organizationId: ctx.orgId },
    select: { id: true, title: true },
  });
  if (!p) return null;
  if (!(await docAccess(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), p.id))) return null;
  return { id: p.id, title: p.title };
}


function sameHome(a: DocHome, b: DocHome): boolean {
  if (a.kind !== "anchor" || b.kind !== "anchor") return a.kind === b.kind;
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

type TreeRow = { entityType: string | null; entityId: string | null; parentId: string | null };
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

type MenuSpace = { id: string; name: string; slug: string; icon: string | null; color: string | null };

/**
 * GET ?menu=1: what the doc's row menu may offer, from the rules the writes
 * apply, so it never shows a control that can only fail (a Can edit grant on
 * one doc was offered Duplicate, "No location" and every Space, and each was
 * refused). Duplicate asks canCreateDocAt for the place the copy lands,
 * exactly as POST /duplicate does. A move is the placement rule's: Full
 * access on the doc (a notepad note never re-anchors), and the places
 * moveDestinations accepts, "No location" and each Space's root.
 */
async function menuCaps(
  ctx: { orgId: string; userId: string; accessLevel: string | null | undefined },
  doc: TreeRow & { id: string; archivedAt: Date | null },
  access: { unlockedRole: Parameters<typeof roleAtLeast>[0]; canManage: boolean; locked: boolean },
): Promise<{ canDuplicate: boolean; move: { none: boolean; spaces: MenuSpace[] } }> {
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  const nothing = { none: false, spaces: [] as MenuSpace[] };
  if (doc.archivedAt) return { canDuplicate: false, move: nothing };
  const anchor = doc.entityType && doc.entityId ? { entityType: doc.entityType, entityId: doc.entityId } : null;
  const canDuplicate = await canCreateDocAt(nodeCtx, anchor, doc.parentId);
  if (!access.canManage || doc.entityType === "NOTEPAD") return { canDuplicate, move: nothing };
  const dests = await moveDestinations(nodeCtx, { kind: "doc", id: doc.id });
  if (!dests) return { canDuplicate, move: nothing };
  return {
    canDuplicate,
    move: {
      none: dests.root?.pickable === true,
      spaces: dests.spaces.filter((s) => s.pickable).map((s) => ({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, color: s.color })),
    },
  };
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 50,
        select: { id: true, version: true, title: true, authorId: true, createdAt: true },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The one resolver: anchor, parent page, listings, restricted, the note
  // rule and the page lock, in one world. No role is the same 404 as an
  // invisible anchor.
  const access = await docAccess(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), doc.id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The row menu's read: the role fields it has always read, plus what it
  // may offer (menuCaps). Lean, because a menu opening needs no content,
  // signed URLs, lock owner, location or versions.
  if (new URL(req.url).searchParams.get("menu") === "1") {
    const caps = await menuCaps(ctx, doc, access);
    return NextResponse.json({
      doc: { id: doc.id, createdById: doc.createdById },
      myRole: roleAtLeast(access.role, "EDIT") ? "edit" : access.role === "COMMENT" ? "comment" : "view",
      canManage: access.canManage,
      canShare: access.canShare,
      canComment: access.canComment,
      ...caps,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // Refresh presigned URLs for image / file blocks backed by S3. The
  // stored URL is a 1-hour signature; re-signing per read keeps doc
  // viewing fast and the URL always usable, mirroring the SOP
  // screenshot enrichment pattern.
  const enriched = { ...doc, content: await presignBlocksImagesAndFiles(doc.content) };

  // Lock page (change request A4): while lockedById is set everyone below
  // Full access reads as view-only on the CONTENT; comments keep working, which
  // is the point of locking rather than restricting. The lock row rides back
  // so the editor can name who locked it and offer Unlock to a Full holder.
  const lockRow = await readDocLock(doc.id);
  let lock: { byId: string; byName: string | null; at: Date | null } | null = null;
  if (lockRow?.lockedById) {
    const by = await prisma.user.findFirst({ where: { id: lockRow.lockedById }, select: { firstName: true, lastName: true } });
    lock = { byId: lockRow.lockedById, byName: by ? `${by.firstName ?? ""} ${by.lastName ?? ""}`.trim() || null : null, at: lockRow.lockedAt };
  }
  // A4: below Full access a locked doc resolves to COMMENT, not view (the
  // resolver applies it). The content is read-only, the comment composer
  // stays, and the chip reads "Can comment". "view" is read only: a Can view
  // grant never comments, and a lock never widens.
  const myRole: "edit" | "comment" | "view" = roleAtLeast(access.role, "EDIT") ? "edit" : access.role === "COMMENT" ? "comment" : "view";
  // The anchor as a Location (spec-docs-knowledge section 1, Back / close):
  // the editor's BackButton falls back to the anchor page for an anchored
  // doc, and the breadcrumb names it.
  const [location, parent, owner] = await Promise.all([
    resolveDocLocation(doc),
    doc.parentId ? readableParent(ctx, doc.parentId) : Promise.resolve(null),
    doc.createdById ? prisma.user.findFirst({ where: { id: doc.createdById }, select: { id: true, firstName: true, lastName: true, avatar: true } }) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    doc: enriched,
    myRole,
    lock,
    // Full access: lock, Trash, save as template.
    canManage: access.canManage,
    // Can edit or higher changes who can open it (today's doc sharing rule).
    canShare: access.canShare,
    // Can comment or higher: a Can view grant reads only.
    canComment: access.canComment,
    location,
    parent,
    owner: owner ? { id: owner.id, name: `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || null, avatar: owner.avatar } : null,
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
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

// PATCH is an alias of PUT. Some clients (the topbar Notepad quick-tool) issue
// PATCH for partial title/content updates; without this export Next returns 405
// and the write is silently lost. PUT already handles partial bodies
// (title ?? existing, content ?? existing), so delegating is correct + safe.
export const PATCH = PUT;

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const existing = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true, createdById: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(existing, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const role = await requireDocRole(ctx, { id, createdById: existing.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role === "view") return NextResponse.json({ error: "read-only" }, { status: 403 });
  if (existing.archivedAt) return NextResponse.json({ ok: true, alreadyArchived: true });

  // Soft-archive only — the row stays, versions stay.
  // archivedById is what Trash's "Archived by" column reads; the helper keeps
  // the archive working if the column has not been added yet.
  await withArchivedBy(ctx.userId, (extra) =>
    prisma.doc.update({ where: { id }, data: { archivedAt: new Date(), ...extra } }),
  );
  return NextResponse.json({ ok: true });
}
