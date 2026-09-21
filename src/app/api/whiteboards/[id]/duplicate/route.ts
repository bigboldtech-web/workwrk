// POST /api/whiteboards/[id]/duplicate: copy a canvas (scene, name "Copy of
// …", same Space and Folder) and return the new row. The row menu's
// Duplicate (spec-docs-knowledge section 2, /canvas).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canEditSpace, getSpaceForReader } from "@/lib/space";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const source = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (source.spaceId) {
    const level = ctx.accessLevel ?? "EMPLOYEE";
    if (!(await getSpaceForReader(source.spaceId, ctx.userId, level))) return NextResponse.json({ error: "not found" }, { status: 404 });
    // The copy lands in the same Space, so that needs edit.
    if (!(await canEditSpace(source.spaceId, ctx.userId, level))) {
      return NextResponse.json({ error: "You need edit access to that Space." }, { status: 403 });
    }
  }

  const whiteboard = await prisma.whiteboard.create({
    data: {
      organizationId: ctx.orgId,
      name: `Copy of ${source.name}`.slice(0, 160),
      description: source.description,
      productSlug: source.productSlug,
      spaceId: source.spaceId,
      folderId: source.folderId,
      ownerId: ctx.userId,
      lastEditedById: ctx.userId,
      lastEditedAt: new Date(),
      scene: (source.scene ?? {}) as object,
      thumbnail: source.thumbnail,
    },
    select: { id: true, name: true, createdAt: true },
  });
  return NextResponse.json({ whiteboard });
}
