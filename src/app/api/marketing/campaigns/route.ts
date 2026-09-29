// GET /api/marketing/campaigns: the legacy Campaign rows, read-only, for one
// release (spec-tools-misc section 2.7 Data). Owner and Admin through the
// Data gate. The POST and PATCH handlers are gone: they checked only the
// session, so any employee could create and patch campaigns, and the pages
// that called them are deleted. Retire this route with the import
// (scripts/MIGRATIONS.md, Phase 7 stage E).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { viewer } = await requireCan("manage", { type: "settings", page: "data" });
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ campaigns });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
