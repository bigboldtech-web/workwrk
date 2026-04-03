import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/webhooks";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> }
) {
  const { integrationId } = await params;

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const rawBody = await req.text();
  const config = integration.config as any;

  // Verify signature if secret is configured
  if (config?.secret) {
    const signature = req.headers.get("x-workwrk-signature") || req.headers.get("x-hub-signature-256");
    if (!verifyWebhookSignature(rawBody, signature, config.secret)) {
      await prisma.webhookLog.create({
        data: {
          integrationId,
          direction: "incoming",
          event: "signature_failed",
          payload: {},
          status: "failed",
          error: "Invalid webhook signature",
        },
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }

  // Log the incoming webhook
  const log = await prisma.webhookLog.create({
    data: {
      integrationId,
      direction: "incoming",
      event: payload.event || payload.type || "unknown",
      payload,
      status: "received",
    },
  });

  // Process based on integration type
  try {
    switch (integration.type) {
      case "SLACK":
        // Handle Slack URL verification challenge
        if (payload.type === "url_verification") {
          return NextResponse.json({ challenge: payload.challenge });
        }
        break;

      case "CUSTOM_WEBHOOK":
        // Generic webhook — just log it
        break;

      default:
        break;
    }

    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { status: "processed" },
    });
  } catch (err: any) {
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: { status: "failed", error: err.message },
    });
  }

  return NextResponse.json({ received: true, logId: log.id });
}
