import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Send an outgoing webhook to a configured integration
export async function sendWebhook(params: {
  integrationId: string;
  event: string;
  payload: Record<string, any>;
}) {
  const { integrationId, event, payload } = params;

  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
  });

  if (!integration || integration.status !== "ACTIVE") return;

  const config = integration.config as any;
  const webhookUrl = config?.webhookUrl;
  if (!webhookUrl) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  // Sign payload if secret is configured
  const signature = config?.secret
    ? crypto.createHmac("sha256", config.secret).update(body).digest("hex")
    : undefined;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-TheywrK-Event": event,
    };
    if (signature) {
      headers["X-TheywrK-Signature"] = `sha256=${signature}`;
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    await prisma.webhookLog.create({
      data: {
        integrationId,
        direction: "outgoing",
        event,
        payload: { url: webhookUrl, body: payload },
        status: res.ok ? "sent" : "failed",
        responseCode: res.status,
        error: res.ok ? null : `HTTP ${res.status}`,
      },
    });
  } catch (err: any) {
    await prisma.webhookLog.create({
      data: {
        integrationId,
        direction: "outgoing",
        event,
        payload: { url: webhookUrl, body: payload },
        status: "failed",
        error: err.message || "Unknown error",
      },
    });
  }
}

// Send outgoing webhooks to all active Slack and Custom Webhook integrations for an org
export async function broadcastWebhook(params: {
  organizationId: string;
  event: string;
  payload: Record<string, any>;
}) {
  const { organizationId, event, payload } = params;

  try {
    const integrations = await prisma.integration.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        type: { in: ["SLACK", "CUSTOM_WEBHOOK"] },
      },
    });

    await Promise.allSettled(
      integrations.map((integration) =>
        sendWebhook({ integrationId: integration.id, event, payload })
      )
    );
  } catch (err) {
    console.error("broadcastWebhook error:", err);
  }
}

// Verify incoming webhook signature
export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const sig = signature.replace("sha256=", "");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
