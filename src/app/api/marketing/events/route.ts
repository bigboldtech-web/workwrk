// GET /api/marketing/events: the legacy EventBrief rows, read-only, for one
// release (spec-tools-misc section 2.7 Data). Owner and Admin through the
// Data gate. POST is gone with the pages that called it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { viewer } = await requireCan("manage", { type: "settings", page: "data" });
    const events = await prisma.eventBrief.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ events });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
