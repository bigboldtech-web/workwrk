// POST /api/whiteboards/[id]/versions/[versionId]/restore
// Restore a whiteboard to a prior snapshot. Snapshots the CURRENT scene first
// (force, so a restore is itself reversible), then copies the chosen snapshot's
// scene onto the live record. Restoring is an edit: Can edit on the canvas.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { whiteboardReadable } from "@/lib/whiteboard-gate";
import { nodeCtxFromLevel } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";
import { recordSnapshot, getSnapshotContent } from "@/lib/snapshots";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const wb = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
    select: { id: true, spaceId: true, scene: true },
  });
  if (!wb) return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = await whiteboardReadable(nodeCtxFromLevel(ctx.userId, ctx.orgId, ctx.accessLevel), wb);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!roleAtLeast(role, "EDIT")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const content = await getSnapshotContent("WHITEBOARD", id, versionId);
  if (content == null) return NextResponse.json({ error: "version not found" }, { status: 404 });

  // Capture the current state first (force past the throttle) so this restore
  // can itself be undone, then apply the chosen version.
  await recordSnapshot("WHITEBOARD", id, ctx.orgId, wb.scene, ctx.userId, true);
  await prisma.whiteboard.update({
    where: { id },
    data: { scene: content as object, lastEditedById: ctx.userId, lastEditedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
