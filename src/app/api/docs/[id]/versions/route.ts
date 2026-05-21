// /api/docs/[id]/versions — list the version trail for a Doc.
//
// Returns versions newest-first with the user-friendly metadata
// (author + timestamp). The actual `content` JSON is included so the
// client can preview/diff/restore without a second roundtrip.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;

  const doc = await prisma.doc.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await prisma.docVersion.findMany({
    where: { docId: id },
    orderBy: { version: "desc" },
    take: 200,
  });

  // Hydrate author names in a second pass — small N, no need for relation.
  const authorIds = Array.from(new Set(versions.map((v) => v.authorId).filter(Boolean) as string[]));
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  return NextResponse.json({
    versions: versions.map((v) => {
      const author = v.authorId ? authorMap.get(v.authorId) : null;
      return {
        id: v.id,
        version: v.version,
        title: v.title,
        createdAt: v.createdAt,
        authorId: v.authorId,
        authorName: author ? `${author.firstName ?? ""} ${author.lastName ?? ""}`.trim() || author.email : null,
      };
    }),
  });
}
