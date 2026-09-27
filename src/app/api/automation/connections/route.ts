// GET /api/automation/connections
//
// The Connections page's read (spec-ai-automation /automation/connections):
// Owner and Admin only, like every write beside it. Returns
//   { connections: [{ provider: "WEBHOOK", status, errorMessage, url,
//     secretHint, secretCreatedAt, lastDeliveryAt, lastDeliveryStatus }] }
// The signing secret itself is never returned; it is shown once, by the
// connect and rotate responses. Token columns are never selected. Rows of
// providers nothing can use (ZAPIER, CRM and the rest) are not listed.

import { NextResponse } from "next/server";
import { forbidden, requireAutomation } from "@/lib/automation/gate";
import { loadWebhook, webhookView } from "@/lib/automation/webhook-server";

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  if (!ctx.isAdmin) return forbidden("Connections are managed by workspace Owners and Admins.");

  const webhook = webhookView(await loadWebhook(ctx.orgId));
  return NextResponse.json(
    { connections: [{ provider: "WEBHOOK", ...webhook }] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
