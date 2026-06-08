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
import { presignBlocksImagesAndFiles } from "@/lib/doc-block-enrich";
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
});

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

  // Refresh presigned URLs for image / file blocks backed by S3. The
  // stored URL is a 1-hour signature; re-signing per read keeps doc
  // viewing fast and the URL always usable, mirroring the SOP
  // screenshot enrichment pattern.
  const enriched = { ...doc, content: await presignBlocksImagesAndFiles(doc.content) };
  return NextResponse.json({ doc: enriched });
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
    select: { id: true, title: true, content: true, archivedAt: true, entityType: true, entityId: true, updatedAt: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(existing, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  // Fast-path: a pure tree update (move / reorder / mark-folder) carries no
  // title/content/excerpt — apply it directly without snapshotting a version
  // (reordering shouldn't bloat history). Guard against a doc being its own
  // parent.
  const isTreeOnly =
    parsed.data.title === undefined &&
    parsed.data.content === undefined &&
    parsed.data.excerpt === undefined &&
    (parsed.data.parentId !== undefined || parsed.data.position !== undefined || parsed.data.isFolder !== undefined);
  if (isTreeOnly) {
    if (parsed.data.parentId === id) {
      return NextResponse.json({ error: "cannot nest a note under itself" }, { status: 400 });
    }
    const doc = await prisma.doc.update({
      where: { id },
      data: {
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
        ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
        ...(parsed.data.isFolder !== undefined ? { isFolder: parsed.data.isFolder } : {}),
      },
      select: { id: true, parentId: true, position: true, isFolder: true },
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const existing = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(existing, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.archivedAt) return NextResponse.json({ ok: true, alreadyArchived: true });

  // Soft-archive only — the row stays, versions stay.
  await prisma.doc.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
