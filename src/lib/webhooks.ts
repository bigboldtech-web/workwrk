import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { checkWebhookTarget, sendPinned } from "@/lib/webhook-target";

/** Said for an address that is not a public https one: never more, so the
 *  Test button is no probe of anyone's network. */
const NOT_PUBLIC = "This address is not allowed: use a public https address.";

/**
 * A connection's webhook address, checked when it is saved (the send checks
 * again, and pins): null when allowed or absent, else the sentence to show.
 */
export async function webhookConfigRefusal(config: unknown): Promise<string | null> {
  const url = config && typeof config === "object" ? (config as { webhookUrl?: unknown }).webhookUrl : undefined;
  if (url === undefined || url === null || url === "") return null;
  const target = await checkWebhookTarget(url, { signal: AbortSignal.timeout(5000) }).catch(() => ({ ok: false as const }));
  return target.ok ? null : NOT_PUBLIC;
}

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
      "X-WorkwrK-Event": event,
    };
    if (signature) {
      headers["X-WorkwrK-Signature"] = `sha256=${signature}`;
    }

    // The webhook rule (src/lib/webhook-target.ts), as /api/webhooks sends:
    // https, a public address for every name the host resolves to, the
    // connection pinned to those addresses, no redirect followed (pen test
    // 2026-11-28, V-26: this bare fetch posted workspace events to internal
    // addresses, and the Test button reported each one's status).
    const signal = AbortSignal.timeout(10000);
    const target = await checkWebhookTarget(webhookUrl, { signal });
    if (!target.ok) {
      await prisma.webhookLog.create({
        data: {
          integrationId,
          direction: "outgoing",
          event,
          payload: { url: String(webhookUrl), body: payload },
          status: "failed",
          error: NOT_PUBLIC,
        },
      });
      return;
    }
    const res = await sendPinned(target, { headers, body, signal });
    await res.body?.cancel().catch(() => {});
    const ok = res.status >= 200 && res.status < 300;

    await prisma.webhookLog.create({
      data: {
        integrationId,
        direction: "outgoing",
        event,
        payload: { url: webhookUrl, body: payload },
        status: ok ? "sent" : "failed",
        responseCode: res.status,
        error: ok ? null : `HTTP ${res.status}`,
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
