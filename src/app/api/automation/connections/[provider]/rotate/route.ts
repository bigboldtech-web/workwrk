// POST /api/automation/connections/WEBHOOK/rotate
//
// Mints a new signing secret and returns it exactly once: { secret }.
// Anything still verifying with the old secret stops verifying. Owner and
// Admin only, audited.

import { NextResponse, type NextRequest } from "next/server";
import { forbidden, requireAutomation } from "@/lib/automation/gate";
import { rotateWebhookSecret } from "@/lib/automation/webhook-server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isAdmin) return forbidden("Connections are managed by workspace Owners and Admins.");
  const { provider } = await params;
  if (provider.toUpperCase() !== "WEBHOOK") return NextResponse.json({ error: "This connection is not available yet" }, { status: 501 });

  const rotated = await rotateWebhookSecret(ctx.orgId, ctx.userId);
  if (!rotated) return NextResponse.json({ error: "Connect the webhook first" }, { status: 409 });
  return NextResponse.json(rotated, { headers: { "Cache-Control": "private, no-store" } });
}
