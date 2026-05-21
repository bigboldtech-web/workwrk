// /api/docs/[id]/versions/[versionId] — fetch one version's content,
// and POST to restore it as a new live version.
//
// Restore is non-destructive: it creates a new version with the old
// content, leaving the original version row untouched. Time-travel
// without data loss.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id, versionId } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    select: { id: true, archivedAt: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.archivedAt) return NextResponse.json({ error: "archived" }, { status: 410 });

  const source = await prisma.docVersion.findFirst({
    where: { id: versionId, docId: id },
  });
  if (!source) return NextResponse.json({ error: "version not found" }, { status: 404 });

  const last = await prisma.docVersion.findFirst({
    where: { docId: id },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  // Create a new live version snapshotting the old content. Old
  // version row stays exactly where it is — auditable trail intact.
  const [, doc2] = await prisma.$transaction([
    prisma.docVersion.create({
      data: {
        docId: id,
        version: nextVersion,
        title: source.title,
        content: source.content as object,
        authorId: ctx.userId,
      },
    }),
    prisma.doc.update({
      where: { id },
      data: { title: source.title, content: source.content as object },
      select: { id: true, title: true, content: true, updatedAt: true },
    }),
  ]);

  return NextResponse.json({ doc: doc2, restoredFromVersion: source.version, newVersion: nextVersion });
}
