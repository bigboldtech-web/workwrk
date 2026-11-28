// /api/docs/[id]/versions/[versionId] — fetch one version's content,
// and POST to restore it as a new live version.
//
// Restore is non-destructive: it creates a new version with the old
// content, leaving the original version row untouched. Time-travel
// without data loss.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { docAccessible } from "@/lib/doc-access";
import { docStandingNow, requireDocRole } from "@/lib/doc-sharing";
import { roleAtLeast } from "@/lib/access/node-rules";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id, versionId } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, entityType: true, entityId: true, createdById: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Viewers may read history; unlisted-on-restricted see nothing.
  const role = await requireDocRole(ctx, { id, createdById: doc.createdById });
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });

  const version = await prisma.docVersion.findFirst({
    where: { id: versionId, docId: id },
  });
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });

  return NextResponse.json({ version });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id, versionId } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, archivedAt: true, entityType: true, entityId: true, createdById: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await docAccessible(doc, ctx.userId, ctx.accessLevel))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Restoring a version rewrites live content — an edit, not a read.
  // Restoring replaces the page: Can edit with the page lock applied (pen
  // test 2026-11-28, V-14: a member the lock left on Can comment restored an
  // old version over a locked page).
  const standing = await docStandingNow(ctx, { id });
  if (!roleAtLeast(standing.unlockedRole, "VIEW")) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!roleAtLeast(standing.role, "EDIT")) {
    const message = standing.locked ? "This doc is locked." : "You can view this doc but not edit it.";
    return NextResponse.json({ error: message, code: standing.locked ? "locked" : "read-only", message }, { status: 403 });
  }
  if (doc.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  const source = await prisma.docVersion.findFirst({
    where: { id: versionId, docId: id },
  });
  if (!source) return NextResponse.json({ error: "version not found" }, { status: 404 });

  // Under a lock on the doc (the final review of pen test 2026-11-28): the
  // live text is kept as a version FIRST when no version holds it yet, then
  // the old version becomes live. A restore used to overwrite whatever was
  // typed since the last version with no copy anywhere, and a save landing in
  // the middle could interleave with it.
  const { doc2, nextVersion } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Doc" WHERE id = ${id} FOR UPDATE`;
    const live = await tx.doc.findUnique({ where: { id }, select: { title: true, content: true } });
    const last = await tx.docVersion.findFirst({
      where: { docId: id },
      orderBy: { version: "desc" },
      select: { version: true, title: true, content: true },
    });
    let next = (last?.version ?? 0) + 1;
    const liveKept = !!last && last.title === live?.title && JSON.stringify(last.content) === JSON.stringify(live?.content);
    if (live && !liveKept) {
      await tx.docVersion.create({
        data: { docId: id, version: next, title: live.title, content: (live.content ?? {}) as object, authorId: ctx.userId },
      });
      next += 1;
    }
    // A new live version snapshotting the old content. The old version row
    // stays exactly where it is: the auditable trail is intact.
    await tx.docVersion.create({
      data: { docId: id, version: next, title: source.title, content: source.content as object, authorId: ctx.userId },
    });
    const updated = await tx.doc.update({
      where: { id },
      data: { title: source.title, content: source.content as object },
      select: { id: true, title: true, content: true, updatedAt: true },
    });
    return { doc2: updated, nextVersion: next };
  }, { timeout: 30_000, maxWait: 10_000 });

  return NextResponse.json({ doc: doc2, restoredFromVersion: source.version, newVersion: nextVersion });
}
