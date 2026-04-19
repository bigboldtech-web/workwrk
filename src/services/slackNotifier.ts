import { prisma } from "@/lib/prisma";

/**
 * Slack notifier.
 *
 * Reads the org's Slack integration config, posts a message to the
 * configured incoming webhook URL. Safe to call anywhere — every failure
 * path returns silently; no error ever propagates into the caller.
 *
 * Admin configures the webhook URL via the Integrations UI:
 *   Integration.type = "SLACK"
 *   Integration.config = { "webhookUrl": "https://hooks.slack.com/services/..." }
 *   Integration.status = "ACTIVE"
 *
 * Formats: https://api.slack.com/messaging/webhooks
 */

export type SlackNotification = {
  organizationId: string;
  /** Plain-text or Slack mrkdwn body. */
  text: string;
  /** Optional Slack Block Kit blocks for richer messages. */
  blocks?: unknown[];
  /** Channel override — most webhooks ignore this, but included for completeness. */
  channel?: string;
};

type SlackIntegrationConfig = {
  webhookUrl?: string;
  defaultChannel?: string;
  enabled?: boolean;
};

export async function notifySlack(n: SlackNotification): Promise<{
  ok: boolean;
  reason?: string;
}> {
  try {
    const integration = await prisma.integration.findFirst({
      where: {
        organizationId: n.organizationId,
        type: "SLACK",
        status: "ACTIVE",
      },
      select: { config: true },
    });

    if (!integration) return { ok: false, reason: "no_slack_integration" };

    const cfg = (integration.config ?? {}) as SlackIntegrationConfig;
    if (cfg.enabled === false) return { ok: false, reason: "disabled" };
    const webhookUrl = cfg.webhookUrl;
    if (!webhookUrl || !webhookUrl.startsWith("https://hooks.slack.com/"))
      return { ok: false, reason: "no_webhook_url" };

    const payload: Record<string, unknown> = { text: n.text };
    if (n.blocks) payload.blocks = n.blocks;
    if (n.channel ?? cfg.defaultChannel) payload.channel = n.channel ?? cfg.defaultChannel;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Fail fast — Slack should respond in well under a second.
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `slack_${res.status}:${body.slice(0, 80)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    };
  }
}

/**
 * Convenience helpers — event-specific formatters.
 */

export function notifyKudosPosted(params: {
  organizationId: string;
  giverName: string;
  receiverName: string;
  value: string | null;
  message: string;
}) {
  const { giverName, receiverName, value, message } = params;
  const valueTag = value ? ` *${value}*` : "";
  return notifySlack({
    organizationId: params.organizationId,
    text: `🎉 ${giverName} recognised *${receiverName}*${valueTag}\n> ${message.slice(0, 280)}`,
  });
}

export function notifyReviewReady(params: {
  organizationId: string;
  cycleName: string;
  subjectName: string;
  reviewerName: string;
  dueDate?: string;
}) {
  return notifySlack({
    organizationId: params.organizationId,
    text: `📝 *Review ready*: ${params.subjectName} · cycle _${params.cycleName}_ · reviewer ${params.reviewerName}${
      params.dueDate ? ` · due ${params.dueDate}` : ""
    }`,
  });
}

export function notifySignalDigest(params: {
  organizationId: string;
  counts: { high: number; med: number; low: number };
  topTargets: string[];
}) {
  const { counts, topTargets } = params;
  const total = counts.high + counts.med + counts.low;
  if (total === 0) return { ok: true };
  const list = topTargets.slice(0, 3).map((t) => `• ${t}`).join("\n");
  return notifySlack({
    organizationId: params.organizationId,
    text: `✦ *AI Engine · ${total} signal${total === 1 ? "" : "s"}* — ${counts.high} high / ${counts.med} med / ${counts.low} low\n${list}`,
  });
}
