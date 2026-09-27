// GET /api/marketing/content: the legacy ContentItem rows, read-only, for one
// release (spec-tools-misc section 2.7 Data). Owner and Admin through the
// Data gate. POST and PATCH are gone with the pages that called them.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { viewer } = await requireCan("manage", { type: "settings", page: "data" });
    const items = await prisma.contentItem.findMany({
      where: { organizationId: viewer.organizationId },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
      take: 300,
    });
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
