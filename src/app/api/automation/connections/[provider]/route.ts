// POST /api/automation/connections/[provider]
//
// Connect an integration provider (admin only).
//
// Honest stub: OAuth-backed providers (WhatsApp/Gmail/Calendar/Slack/
// Zapier/CRM) return 501 until their flows ship; the UI shows "coming
// soon" instead of a dead connect flow. WEBHOOK is real today: it
// upserts a CONNECTED row with the target URL in metadataJson, which is
// all a webhook needs.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { forbidden, resolveAutomationContext } from "@/lib/automation/hub-access";

const PROVIDERS = ["WHATSAPP", "GMAIL", "GOOGLE_CALENDAR", "SLACK", "WEBHOOK", "ZAPIER", "CRM"] as const;
type Provider = (typeof PROVIDERS)[number];

const webhookSchema = z.object({
  url: z.url({ protocol: /^https?$/, error: "A valid http(s) webhook URL is required" }),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const ctx = await resolveAutomationContext();
  if ("error" in ctx) return ctx.error;
  if (ctx.role !== "admin") {
    return forbidden("Forbidden: only workspace admins can connect integrations");
  }

  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase() as Provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `Unknown provider: ${rawProvider}` }, { status: 400 });
  }

  if (provider !== "WEBHOOK") {
    return NextResponse.json({ error: "provider connection coming soon" }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const connection = await prisma.integrationConnection.upsert({
    where: { organizationId_provider: { organizationId: ctx.orgId, provider: "WEBHOOK" } },
    create: {
      organizationId: ctx.orgId,
      provider: "WEBHOOK",
      status: "CONNECTED",
      connectedByUserId: ctx.userId,
      metadataJson: { url: parsed.data.url },
    },
    update: {
      status: "CONNECTED",
      connectedByUserId: ctx.userId,
      metadataJson: { url: parsed.data.url },
      errorMessage: null,
    },
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

  return NextResponse.json({ connection });
}
