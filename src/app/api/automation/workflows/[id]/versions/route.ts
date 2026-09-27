// GET /api/automation/workflows/[id]/versions
//
// The version history, newest first: { versions: [{ number, publishedAt,
// publishedBy, isLive, kind, restoredFrom }] }. Every Member who can read
// the workflow list can read it; the definitions are not returned.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAutomation } from "@/lib/automation/gate";
import { listVersions } from "@/lib/automation/versions-server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  const { id } = await params;
  const wf = await prisma.automationWorkflow.findFirst({
    where: { id, organizationId: ctx.orgId },
    select: { id: true, publishedVersionId: true },
  });
  if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  return NextResponse.json(
    { versions: await listVersions(ctx.orgId, wf.id, wf.publishedVersionId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
