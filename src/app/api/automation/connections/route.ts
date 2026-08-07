// GET /api/automation/connections
//
// Lists the org's IntegrationConnection rows for the hub's Connections
// page. Token columns are never selected; an org with no rows returns an
// empty list (the UI renders the provider gallery from its own catalog).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAutomationContext } from "@/lib/automation/hub-access";

export async function GET() {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;

  const connections = await prisma.integrationConnection.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      status: true,
      connectedByUserId: true,
      tokenExpiresAt: true,
      scopesJson: true,
      metadataJson: true,
      lastSyncAt: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ connections });
}
