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
import { sealToken } from "@/lib/connectors/seal";

/**
 * Webhook subscription management (admin-only).
 *
 * GET    /api/webhooks   list subscriptions + recent delivery summary
 * POST   /api/webhooks   create; plaintext secret shown ONCE
 * PATCH  /api/webhooks   { id, rotateSecret: true }: a new secret, shown ONCE
 * DELETE /api/webhooks?id=  delete (also deletes delivery history)
 *
 * THE SECRET (docs-found fixes batch 3). The secret shown once is the key
 * every delivery is signed with (src/services/webhookDispatcher.ts, THE
 * SIGNING KEY): it is kept sealed with SECRETS_ENCRYPTION_KEY
 * (`secretSealed`), beside its hash. Deliveries used to be signed with the
 * hash while this route said to verify with the secret, so a receiver doing
 * exactly that rejected every one. A subscription made before then has no
 * sealed secret and keeps signing with the hash until its secret is rotated
 * here; GET says which (`signing`).
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

/** How a receiver checks a delivery, said the same way wherever a secret is shown. */
const VERIFY =
  "Each delivery carries X-Workwrk-Signature: t=<timestamp>,v1=<signature>. To check one, compute HMAC-SHA256 with this secret as the key " +
  "over the timestamp, a full stop and the raw request body (<timestamp>.<body>), as lowercase hex, and compare it with v1 in constant time. " +
  "Refuse a timestamp more than five minutes old.";
const SHOWN_ONCE = "This is the only time we'll show the webhook signing secret. Store it now. ";

/** Which key a subscription's deliveries are signed with. */
function signingOf(sealed: unknown): { signing: "secret" | "legacy_hash"; signingNote: string | null } {
  return sealed === null || sealed === undefined
    ? {
        signing: "legacy_hash",
        signingNote:
          "Its deliveries are signed with the SHA-256 of its secret, as lowercase hex, as the HMAC key, as they always were. " +
          "Rotate its secret to sign with the secret itself.",
      }
    : { signing: "secret", signingNote: null };
}

/** A new secret, with its hash, prefix and sealed copy, or null when the server can't seal one. */
function newSecret(): { plaintext: string; prefix: string; hash: string; sealed: ReturnType<typeof sealToken> } | null {
  const { plaintext, prefix, hash } = generateWebhookSecret();
  try {
    return { plaintext, prefix, hash, sealed: sealToken(plaintext) };
  } catch {
    return null;
  }
}
const CANT_SEAL = "Webhook signing isn't set up on this server yet, so nothing was changed. Ask WorkwrK support to set it up.";

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
      secretSealed: true,
      _count: { select: { deliveries: true } },
    },
  });
  return jsonSuccess({
    // The sealed secret never leaves the server: only which key signs.
    data: subs.map(({ secretSealed, ...s }) => ({ ...s, unsentEvents: unsentWebhookEvents(s.events), ...signingOf(secretSealed) })),
    validEvents: VALID_EVENTS,
  });
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

  // Sealed before anything is written: a subscription whose secret could
  // not be kept would sign with a key its receiver was never shown.
  const secret = newSecret();
  if (!secret) return jsonError(CANT_SEAL, 503);
  const row = await prisma.webhookSubscription.create({
    data: {
      url: body.url.trim(),
      events,
      secretHash: secret.hash,
      secretPrefix: secret.prefix,
      secretSealed: secret.sealed,
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
    secret: secret.plaintext,
    signing: "secret",
    message: SHOWN_ONCE + VERIFY,
  });
}

/**
 * PATCH /api/webhooks { id, rotateSecret: true }: a new secret, shown once.
 * Deliveries are signed with it from now on, a subscription made before the
 * secret was kept included (it stops signing with the hash). The old secret
 * stops working at once: update the receiver with the new one.
 */
export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const writeGate = await settingsWriteGate(session, "api");
  if (!writeGate.ok) return writeGate.response;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; rotateSecret?: unknown };
  if (typeof body.id !== "string" || !body.id) return jsonError("id required");
  if (body.rotateSecret !== true) return jsonError("Send rotateSecret: true to replace this subscription's secret.");

  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: body.id, organizationId: orgId },
    select: { id: true, url: true, secretPrefix: true },
  });
  if (!sub) return jsonError("Subscription not found", 404);

  const secret = newSecret();
  if (!secret) return jsonError(CANT_SEAL, 503);
  const row = await prisma.webhookSubscription.update({
    where: { id: sub.id },
    data: { secretHash: secret.hash, secretPrefix: secret.prefix, secretSealed: secret.sealed },
    select: { id: true, url: true, events: true, status: true, secretPrefix: true, createdAt: true },
  });

  logAuditEvent({
    type: "webhook_subscription_secret_rotated",
    actorId: userId,
    organizationId: orgId,
    description: `Rotated the signing secret of the webhook subscription to ${row.url}`,
    targetId: row.id,
    targetType: "webhook_subscription",
    metadata: { url: row.url, secretPrefix: row.secretPrefix, previousSecretPrefix: sub.secretPrefix },
  });

  return jsonSuccess({
    ...row,
    secret: secret.plaintext,
    signing: "secret",
    message: SHOWN_ONCE + "The old secret no longer signs anything. " + VERIFY,
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
