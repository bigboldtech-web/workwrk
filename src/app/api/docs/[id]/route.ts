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
import { docAccessible } from "@/lib/doc-access";
import { isDocFull, requireDocRole } from "@/lib/doc-sharing";
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
 * read it through the same two gates the parent's own GET applies
 * (docAccessible, then the per-doc role). A sub-page carries no anchor of its
 * own, so it can be readable while its parent is not; naming the parent then
 * would hand its title to someone its own URL answers 404. Unreadable is null,
 * exactly like a doc with no parent, so the page falls back to the anchor.
 */
async function readableParent(
  ctx: Parameters<typeof requireDocRole>[0],
  parentId: string,
): Promise<{ id: string; title: string } | null> {
  const p = await prisma.doc.findFirst({
    where: { id: parentId, organizationId: ctx.orgId },
    select: { id: true, title: true, entityType: true, entityId: true, createdById: true },
  });
  if (!p) return null;
  if (!(await docAccessible(p, ctx.userId, ctx.accessLevel))) return null;
  if (!(await requireDocRole(ctx, { id: p.id, createdById: p.createdById }))) return null;
  return { id: p.id, title: p.title };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Per-doc role (settings.docSharing). null = restricted + unlisted →
  // same 404 as an invisible anchor. "view" | "edit" rides back to the
  // editor so it can lock the canvas client-side.
  const role = await requireDocRole(ctx, { id: doc.id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

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
  // A4: below Full access a locked doc resolves to COMMENT, not view. The
  // content is read-only, the comment composer stays, and the chip reads
  // "Can comment". A Can view holder stays at view: a lock never widens.
  const full = isDocFull(ctx, { createdById: doc.createdById });
  const myRole: "edit" | "comment" | "view" = lock && !full ? (role === "view" ? "view" : "comment") : role;
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
    canManage: full,
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
    select: { id: true, title: true, content: true, archivedAt: true, entityType: true, entityId: true, updatedAt: true, createdById: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(existing, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  // Write gate — BEFORE the tree-only fast path, so a view-only member
  // can't move/re-anchor the doc either. 404 for unlisted-on-restricted,
  // 403 read-only for viewers; the client guards persist() so this is
  // only the backstop.
  const role = await requireDocRole(ctx, { id, createdById: existing.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role === "view") return NextResponse.json({ error: "read-only" }, { status: 403 });
  // Lock page (change request A4): a locked doc takes content from Full
  // access holders only. Everyone else gets the one 403 the editor already
  // renders as read-only; nothing is silently dropped.
  const lockRow = await readDocLock(id);
  if (lockRow?.lockedById && !isDocFull(ctx, { createdById: existing.createdById })) {
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
    const doc = await prisma.doc.update({
      where: { id },
      data: {
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
        ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
        ...(parsed.data.isFolder !== undefined ? { isFolder: parsed.data.isFolder } : {}),
        ...(parsed.data.entityType !== undefined ? { entityType: parsed.data.entityType } : {}),
        ...(parsed.data.entityId !== undefined ? { entityId: parsed.data.entityId } : {}),
      },
      select: { id: true, parentId: true, position: true, isFolder: true, entityType: true, entityId: true },
    });
    return NextResponse.json({ doc });
  }

  // Optimistic-concurrency precondition. The client sends the updatedAt
  // it last observed; if the row has moved on, we 409 and let the UI
  // prompt the writer to reload before overwriting a peer's work.
  if (parsed.data.knownUpdatedAt) {
    const observedMs = new Date(parsed.data.knownUpdatedAt).getTime();
    const liveMs = existing.updatedAt.getTime();
    if (observedMs < liveMs) {
      return NextResponse.json(
        {
          error: "conflict",
          message: "This note was edited elsewhere. Reload to see the latest version before saving again.",
          liveUpdatedAt: existing.updatedAt,
        },
        { status: 409 },
      );
    }
  }

  // Compute the next version number for this Doc. Versions are
  // monotonic + unique, so we just take MAX + 1.
  const last = await prisma.docVersion.findFirst({
    where: { docId: id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  const nextTitle = parsed.data.title ?? existing.title;
  const nextContent = (parsed.data.content as object) ?? (existing.content as object);

  // Two writes in a transaction: snapshot the new version + update the
  // live Doc. If either fails, both roll back.
  const [, doc] = await prisma.$transaction([
    prisma.docVersion.create({
      data: {
        docId: id,
        version: nextVersion,
        title: nextTitle,
        content: nextContent,
        authorId: ctx.userId,
      },
    }),
    prisma.doc.update({
      where: { id },
      data: {
        title: nextTitle,
        content: nextContent,
        ...(parsed.data.excerpt !== undefined ? { excerpt: parsed.data.excerpt } : {}),
      },
      select: { id: true, title: true, content: true, excerpt: true, updatedAt: true },
    }),
  ]);

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
