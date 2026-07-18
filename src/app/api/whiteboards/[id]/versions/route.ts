// GET /api/whiteboards/[id]/versions — list this whiteboard's version history.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { getSpaceForReader } from "@/lib/space";
import { listSnapshots } from "@/lib/snapshots";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const wb = await prisma.whiteboard.findFirst({
    where: { id, organizationId: ctx.orgId, archivedAt: null },
    select: { id: true, spaceId: true },
  });
  if (!wb) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (wb.spaceId) {
    const space = await getSpaceForReader(wb.spaceId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE");
    if (!space) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const versions = await listSnapshots("WHITEBOARD", id);
  return NextResponse.json({ versions });
}
