import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { generateWebhookSecret } from "@/lib/api-auth";
import { logAuditEvent } from "@/lib/activity";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { WEBHOOK_ANY, WEBHOOK_EVENT_NAMES, unsentWebhookEvents } from "@/lib/webhook-events";

/**
 * Webhook subscription management (admin-only).
 *
 * GET    /api/webhooks   list subscriptions + recent delivery summary
 * POST   /api/webhooks   create; plaintext secret shown ONCE
 * DELETE /api/webhooks?id=  delete (also deletes delivery history)
 *
 * THE EVENTS. A subscription names "*" or events from WEBHOOK_EVENTS
 * (src/lib/webhook-events.ts), exactly the names something sends through
 * dispatchEvent, which delivers an event to every ACTIVE subscription whose
 * stored list holds its name or "*". The list used to offer seven names
 * nothing sends, plus task.completed, while three that are sent
 * (task.status_changed, task.assignee_changed, task.field_changed) could not
 * be named, so they reached "*" subscriptions only.
 *
 * A name nothing sends is refused out loud on create, never dropped in
 * silence (it used to be filtered out, and the rest saved). A subscription
 * stored before keeps every name it holds, sent or not: GET reports the
 * names nothing sends as `unsentEvents`, so an Admin can see why that part
 * of it stays quiet, and nothing is rewritten behind them.
 */

const VALID_EVENTS = [WEBHOOK_ANY, ...WEBHOOK_EVENT_NAMES];

export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api", { read: true });
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const subs = await prisma.webhookSubscription.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      secretPrefix: true,
      failureCount: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
  });
  return jsonSuccess({ data: subs.map((s) => ({ ...s, unsentEvents: unsentWebhookEvents(s.events) })), validEvents: VALID_EVENTS });
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    events?: string[];
  };

  if (!body.url || !/^https?:\/\//i.test(body.url)) {
    return jsonError("A valid https URL is required");
  }
  if (body.events !== undefined && (!Array.isArray(body.events) || !body.events.every((e) => typeof e === "string"))) {
    return jsonError("events is a list of event names");
  }
  const asked = [...new Set(body.events ?? [])];
  const unknown = asked.filter((e) => !VALID_EVENTS.includes(e));
  if (unknown.length > 0) {
    return jsonError(`Nothing sends ${unknown.length === 1 ? "this event" : "these events"}: ${unknown.join(", ")}. Pick from ${VALID_EVENTS.join(", ")}.`);
  }
  const events = asked.length > 0 ? asked : [WEBHOOK_ANY];

  const { plaintext, prefix, hash } = generateWebhookSecret();
  const row = await prisma.webhookSubscription.create({
    data: {
      url: body.url.trim(),
      events,
      secretHash: hash,
      secretPrefix: prefix,
      organizationId: orgId,
      createdById: userId,
    },
    select: {
      id: true,
      url: true,
      events: true,
      status: true,
      secretPrefix: true,
      createdAt: true,
    },
  });

  logAuditEvent({
    type: "webhook_subscription_created",
    actorId: userId,
    organizationId: orgId,
    description: `Created webhook subscription to ${row.url} for events [${row.events.join(", ")}]`,
    targetId: row.id,
    targetType: "webhook_subscription",
    metadata: { url: row.url, events: row.events, secretPrefix: row.secretPrefix },
  });

  return jsonSuccess({
    ...row,
    secret: plaintext,
    message:
      "This is the only time we'll show the webhook signing secret. Store it now: you'll use it to verify the X-Workwrk-Signature header on every delivery.",
  });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonError("id required");

  const orgId = getOrgId(session);
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, url: true, events: true, secretPrefix: true },
  });
  if (!sub) return jsonError("Subscription not found", 404);

  await prisma.webhookSubscription.delete({ where: { id } });

  logAuditEvent({
    type: "webhook_subscription_deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted webhook subscription to ${sub.url}`,
    targetId: id,
    targetType: "webhook_subscription",
    metadata: { url: sub.url, events: sub.events, secretPrefix: sub.secretPrefix },
  });

  return jsonSuccess({ deleted: true });
}
