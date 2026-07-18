// POST /api/whiteboards/[id]/versions/[versionId]/restore
// Restore a whiteboard to a prior snapshot. Snapshots the CURRENT scene first
// (force, so a restore is itself reversible), then copies the chosen snapshot's
// scene onto the live record. Edit access is gated via the parent Space.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { getSpaceForReader, canEditSpace } from "@/lib/space";
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
  if (wb.spaceId) {
    const space = await getSpaceForReader(wb.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE");
    if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!(await canEditSpace(wb.spaceId, ctx.userId, ctx.accessLevel))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

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
