// /api/automation/connections/[provider]
//
// POST   WEBHOOK { url }: connect, or point the connection at a new address.
//        The first connect returns { connection, secret } with the signing
//        secret, exactly once; later saves return secret: null.
// DELETE WEBHOOK: disconnect. The address is kept for an easy reconnect; the
//        secret is dropped, so nothing can send until it is connected again.
//
// Owner and Admin only (access 9, settings.manageIntegrations), audited.
// Every other provider answers 501: no UI calls it, and nothing is faked.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { forbidden, requireAutomation } from "@/lib/automation/gate";
import { webhookUrlProblem } from "@/lib/automation/webhook";
import { disconnectWebhook, loadWebhook, saveWebhookUrl, webhookView } from "@/lib/automation/webhook-server";

const PROVIDERS = ["WHATSAPP", "GMAIL", "GOOGLE_CALENDAR", "SLACK", "WEBHOOK", "ZAPIER", "CRM"] as const;
type Provider = (typeof PROVIDERS)[number];

// Every refusal is a sentence for the URL field, never a validator's wording.
const webhookSchema = z.object({
  url: z.string({ error: "Enter the address to send to" }).trim().min(1, "Enter the address to send to").max(2000, "That address is too long"),
}, { error: "Enter the address to send to" });

async function gate(params: Promise<{ provider: string }>) {
  const ctx = await requireAutomation();
  if ("error" in ctx) return { error: ctx.error };
  if (!ctx.isAdmin) return { error: forbidden("Connections are managed by workspace Owners and Admins.") };
  const { provider: raw } = await params;
  const provider = raw.toUpperCase() as Provider;
  if (!PROVIDERS.includes(provider)) {
    return { error: NextResponse.json({ error: `Unknown provider: ${raw}` }, { status: 400 }) };
  }
  if (provider !== "WEBHOOK") {
    return { error: NextResponse.json({ error: "This connection is not available yet" }, { status: 501 }) };
  }
  return { ctx };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const g = await gate(params);
  if ("error" in g) return g.error;
  const { ctx } = g;

  const body = await req.json().catch(() => null);
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body", field: "url" }, { status: 400 });
  }
  const problem = webhookUrlProblem(parsed.data.url);
  if (problem) return NextResponse.json({ error: problem, field: "url" }, { status: 400 });

  const { secret } = await saveWebhookUrl(ctx.orgId, ctx.userId, parsed.data.url);
  const connection = { provider: "WEBHOOK", ...webhookView(await loadWebhook(ctx.orgId)) };
  return NextResponse.json({ connection, secret }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const g = await gate(params);
  if ("error" in g) return g.error;
  const { ctx } = g;
  const done = await disconnectWebhook(ctx.orgId, ctx.userId);
  if (!done) return NextResponse.json({ error: "The webhook is not connected" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
