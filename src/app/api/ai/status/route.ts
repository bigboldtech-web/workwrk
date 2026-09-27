// GET /api/ai/status: whether Ask AI can answer right now, so the page and
// the panel show the honest state instead of a composer that fails.
//
// { enabled, configured }
//   enabled    settings.data.aiEnabled ("AI features for members", default on)
//   configured an AI key exists: the workspace's own (BYOK) or the shared one
//
// Never reveals which key or any part of it.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApp } from "@/lib/app-gate";
import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { isAiConfigured } from "@/lib/ai-client";

export const dynamic = "force-dynamic";

export async function GET() {
  // `ai` resolves off when AI features are off (403 { error: "app_off" }),
  // which is itself the answer the client renders.
  const gate = await requireApp("ai");
  if ("error" in gate) return gate.error;
  const orgId = gate.viewer.organizationId;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const configured = await isAiConfigured(orgId);
  return NextResponse.json(
    { enabled: aiEnabledFromSettings(org?.settings), configured },
    { headers: { "Cache-Control": "no-store" } },
  );
}
