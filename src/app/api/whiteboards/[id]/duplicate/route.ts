// POST /api/whiteboards/[id]/duplicate: copy a canvas (scene, name "Copy of
// …", same Space and Folder) and return the new row. The row menu's
// Duplicate (spec-docs-knowledge section 2, /canvas).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { canCreateAt, nodeCtxFromLevel } from "@/lib/access/node-access";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const source = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
  });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  const nodeCtx = nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel);
  if (!(await whiteboardReadable(nodeCtx, source))) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The copy lands beside the original, so it takes the canvas create rule
  // there: Full access on its Folder, Can view on its Space at the root, any
  // Member for a canvas in no Space.
  const container = source.folderId && source.spaceId
    ? { kind: "folder" as const, id: source.folderId }
    : source.spaceId ? { kind: "space" as const, id: source.spaceId } : null;
  if (!(await canCreateAt(nodeCtx, container, "canvas"))) {
    return NextResponse.json({ error: "You need edit access where this canvas lives." }, { status: 403 });
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
