// POST /api/automation/connections/WEBHOOK/test
//
// Sends one sample payload, signed with the live secret, and reports how the
// address answered: { ok, httpStatus, durationMs, message? }. It writes no
// run row, because it is not a run. Owner and Admin only.

import { NextResponse, type NextRequest } from "next/server";
import { forbidden, requireAutomation } from "@/lib/automation/gate";
import { sendThroughWebhook } from "@/lib/automation/webhook-server";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isAdmin) return forbidden("Connections are managed by workspace Owners and Admins.");
  const { provider } = await params;
  if (provider.toUpperCase() !== "WEBHOOK") return NextResponse.json({ error: "This connection is not available yet" }, { status: 501 });

  try {
    const delivery = await sendThroughWebhook(ctx.orgId, "webhook.test", {
      event: "webhook.test",
      sentAt: new Date().toISOString(),
      test: true,
      message: "This is a test from WorkwrK Automations.",
    });
    return NextResponse.json(delivery);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The webhook is not connected" }, { status: 409 });
  }
}
