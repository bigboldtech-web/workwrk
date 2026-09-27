// POST /api/whiteboards/[id]/duplicate: copy a canvas (scene, name "Copy of
// …", same Space and Folder) and return the new row. The row menu's
// Duplicate (spec-docs-knowledge section 2, /canvas).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { canCreateAt, nodeCtxFromLevel } from "@/lib/access/node-access";
import { createRefusal } from "@/lib/access/node-rules";
import { PlacementConflict, lockParentFolder } from "@/lib/access/node-placement";

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
  // The copy lands beside the original, so it takes the one create rule
  // there (node-rules P1): Can edit or higher on its Folder, or on its Space
  // at the root; any Member for a canvas in no Space. Can view never creates.
  const container = source.folderId && source.spaceId
    ? { kind: "folder" as const, id: source.folderId }
    : source.spaceId ? { kind: "space" as const, id: source.spaceId } : null;
  if (!(await canCreateAt(nodeCtx, container, "canvas"))) {
    return NextResponse.json({ error: createRefusal("canvas", container) }, { status: 403 });
  }

  // The create half of P3: in a Folder, the copy's Space is read from the
  // Folder under a share lock inside the write, never copied from the source
  // row, so a move of that Folder meanwhile can never split the copy from it.
  try {
    const whiteboard = await prisma.$transaction(async (tx) => {
      let spaceId = source.spaceId;
      const folderId = container?.kind === "folder" ? container.id : null;
      if (folderId) {
        const parent = await lockParentFolder(tx, ctx.orgId, folderId);
        if (!parent) throw new PlacementConflict("That folder just moved or went to Trash. Try again.");
        spaceId = parent.spaceId;
      }
      return tx.whiteboard.create({
        data: {
          organizationId: ctx.orgId,
          name: `Copy of ${source.name}`.slice(0, 160),
          description: source.description,
          productSlug: source.productSlug,
          spaceId,
          folderId,
          ownerId: ctx.userId,
          lastEditedById: ctx.userId,
          lastEditedAt: new Date(),
          scene: (source.scene ?? {}) as object,
          thumbnail: source.thumbnail,
        },
        select: { id: true, name: true, createdAt: true },
      });
    });
    return NextResponse.json({ whiteboard });
  } catch (err) {
    if (err instanceof PlacementConflict) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
