import { createHmac, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { openToken } from "@/lib/connectors/seal";
import { runAutomationsForEvent } from "@/lib/automation/engine";
import { automationDepthNow } from "@/lib/automation/chain-depth";

/**
 * Webhook dispatcher.
 *
 * Every public event that customers may want to react to is pushed through
 * here: exactly the names in src/lib/webhook-events.ts (kudos.created,
 * kpi.recorded, task.created, task.status_changed, task.assignee_changed,
 * task.field_changed), which webhook-events.test.ts holds to the calls. The
 * dispatcher:
 *
 *   1. Finds every ACTIVE WebhookSubscription in the org whose `events`
 *      list contains the event or the wildcard "*".
 *   2. Creates a WebhookDelivery row per subscription (audit + retry).
 *   3. POSTs the payload to each subscription's URL with an HMAC-SHA256
 *      signature header (X-Workwrk-Signature) so receivers can verify
 *      authenticity (THE SIGNING KEY, below).
 *   4. Updates the delivery status. Failed deliveries are queued for
 *      retry via the `/api/cron/webhook-retry` cron.
 *
 * All external I/O is best-effort — this helper never throws.
 */

/**
 * THE SIGNING KEY. `X-Workwrk-Signature: t=<timestamp>,v1=<hex>`, where hex
 * is HMAC-SHA256 over `<timestamp>.<raw body>`. The key is the secret the
 * receiver was shown when the subscription was made or its secret rotated
 * (POST and PATCH /api/webhooks), opened from `secretSealed`. Docs-found
 * fixes batch 3: every delivery used to be signed with `secretHash`, the
 * SHA-256 hex of that secret, while the route told the receiver to verify
 * with the secret, so a receiver that did exactly that rejected every
 * delivery and ten of them paused the subscription.
 *
 * A subscription made before then has no `secretSealed` (its secret was never
 * kept), so it keeps signing with `secretHash`, exactly as before: a receiver
 * that already verifies it keeps working. GET /api/webhooks says which key a
 * subscription signs with (`signing`), and rotating its secret moves it to
 * the secret itself.
 *
 * A sealed secret no key opens (SECRETS_ENCRYPTION_KEY missing or changed
 * without its previous one) sends nothing: a delivery signed with the wrong
 * key would only be rejected. The delivery waits for its next retry, and the
 * subscription's failure count is left alone, since the receiver did nothing
 * wrong.
 */
export type SigningKey = { ok: true; key: string; signing: "secret" | "legacy_hash" } | { ok: false };

export function signingKeyOf(sub: { secretHash: string; secretSealed?: unknown }): SigningKey {
  if (sub.secretSealed === null || sub.secretSealed === undefined) return { ok: true, key: sub.secretHash, signing: "legacy_hash" };
  try {
    return { ok: true, key: openToken(sub.secretSealed), signing: "secret" };
  } catch {
    return { ok: false };
  }
}

/** The X-Workwrk-Signature value for one delivery body. */
export function signatureHeader(key: string, timestamp: number, body: string): string {
  const signature = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const NOT_SENT = "Not sent: this subscription's signing secret could not be opened on the server, so nothing was sent. It is tried again later.";

export type DispatchEventInput = {
  organizationId: string;
  event: string;
  payload: unknown;
};

const RETRY_BACKOFF_MIN = 60; // 1 minute
const RETRY_BACKOFF_MAX = 60 * 60; // 1 hour
const MAX_FAILURE_COUNT_BEFORE_PAUSE = 10;
const DELIVERY_TIMEOUT_MS = 10_000;

export async function dispatchEvent(input: DispatchEventInput): Promise<void> {
  const { organizationId, event, payload } = input;

  // Automation engine fan-in — fire-and-forget, NEVER throws into the
  // product write-path that dispatched this event. Kicked off before the
  // subscription gate below so automations run even when the org has no
  // webhook subscribers.
  // Inside an automation's teammate step, the event counts toward that
  // automation's chain (src/lib/automation/chain-depth.ts; review round 3).
  const depth = automationDepthNow();
  const chained =
    depth !== null && payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).__automationDepth !== "number"
      ? { ...(payload as Record<string, unknown>), __automationDepth: depth }
      : payload;
  runAutomationsForEvent({ organizationId, event, payload: chained }).catch(() => {});

  const subs = await prisma.webhookSubscription.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      OR: [{ events: { has: event } }, { events: { has: "*" } }],
    },
    select: {
      id: true,
      url: true,
      // The key is the sealed secret, or, on a subscription made before it
      // was kept, the hash (THE SIGNING KEY, above).
      secretHash: true,
      secretSealed: true,
    },
  });

  if (subs.length === 0) return;

  // Fan out in parallel — each delivery already isolates its own errors,
  // and a slow receiver shouldn't block siblings on the same event.
  await Promise.all(
    subs.map((sub) => deliverOne({ sub, event, payload, organizationId })),
  );
}

async function deliverOne(params: {
  sub: { id: string; url: string; secretHash: string; secretSealed: unknown };
  event: string;
  payload: unknown;
  organizationId: string;
}): Promise<void> {
  const deliveryId = randomBytes(12).toString("hex");
  const body = JSON.stringify({
    id: deliveryId,
    event: params.event,
    createdAt: new Date().toISOString(),
    data: params.payload,
  });

  // Signature: HMAC-SHA256 over `<timestamp>.<body>` with the signing key
  // (THE SIGNING KEY, above).
  const timestamp = Math.floor(Date.now() / 1000);
  const signing = signingKeyOf(params.sub);

  const delivery = await prisma.webhookDelivery.create({
    data: {
      subscriptionId: params.sub.id,
      event: params.event,
      payload: params.payload as object,
      organizationId: params.organizationId,
      status: "PENDING",
      attemptCount: 0,
    },
    select: { id: true },
  });

  if (!signing.ok) {
    await markNotSent(delivery.id, 1);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const res = await fetch(params.sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "workwrk-webhooks/1.0",
        "X-Workwrk-Event": params.event,
        "X-Workwrk-Delivery": delivery.id,
        "X-Workwrk-Timestamp": String(timestamp),
        "X-Workwrk-Signature": signatureHeader(signing.key, timestamp, body),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const ok = res.status >= 200 && res.status < 300;
    const responseSnippet = await res
      .text()
      .then((t) => t.slice(0, 500))
      .catch(() => "");

    if (ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          httpStatus: res.status,
          responseBody: responseSnippet,
          deliveredAt: new Date(),
          attemptCount: 1,
        },
      });
      await prisma.webhookSubscription.update({
        where: { id: params.sub.id },
        data: { lastSuccessAt: new Date(), failureCount: 0 },
      });
    } else {
      await markFailed(delivery.id, params.sub.id, res.status, responseSnippet, 1);
    }
  } catch (err) {
    await markFailed(
      delivery.id,
      params.sub.id,
      null,
      err instanceof Error ? err.message.slice(0, 500) : "unknown",
      1,
    );
  }
}

/** A delivery never sent (its key could not be opened): it waits for a retry, and the subscription's failure count is left alone. */
async function markNotSent(deliveryId: string, attemptCount: number) {
  const backoff = Math.min(RETRY_BACKOFF_MIN * 2 ** (attemptCount - 1), RETRY_BACKOFF_MAX);
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: "RETRYING", responseBody: NOT_SENT, attemptCount, nextAttemptAt: new Date(Date.now() + backoff * 1000) },
  });
}

async function markFailed(
  deliveryId: string,
  subscriptionId: string,
  httpStatus: number | null,
  responseBody: string,
  attemptCount: number,
) {
  const backoff = Math.min(
    RETRY_BACKOFF_MIN * 2 ** (attemptCount - 1),
    RETRY_BACKOFF_MAX,
  );
  const nextAttemptAt = new Date(Date.now() + backoff * 1000);
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "RETRYING",
      httpStatus: httpStatus ?? undefined,
      responseBody,
      attemptCount,
      nextAttemptAt,
    },
  });
  const sub = await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
    select: { failureCount: true },
  });
  if (sub.failureCount >= MAX_FAILURE_COUNT_BEFORE_PAUSE) {
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { status: "PAUSED" },
    });
  }
}

/**
 * Cron-callable helper — processes the retry queue.
 * Called by /api/cron/webhook-retry.
 */
export async function processWebhookRetries(): Promise<{ retried: number; delivered: number }> {
  const now = new Date();
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: "RETRYING",
      nextAttemptAt: { lte: now },
      attemptCount: { lt: 8 }, // cap at 8 attempts (~4 hours total backoff)
    },
    take: 100,
    include: {
      subscription: { select: { id: true, url: true, secretHash: true, secretSealed: true, status: true } },
    },
  });

  // Run retries in parallel — each delivery targets a different subscription,
  // so one slow receiver can't hold up the whole queue (previously a single
  // 10s timeout would block up to 100 subsequent retries → ~17 minutes).
  const results = await Promise.all(
    due.map(async (d): Promise<{ retried: 0 | 1; delivered: 0 | 1 }> => {
      if (d.subscription.status !== "ACTIVE") return { retried: 0, delivered: 0 };

      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        id: d.id,
        event: d.event,
        createdAt: d.createdAt.toISOString(),
        data: d.payload,
      });
      const signing = signingKeyOf(d.subscription);
      if (!signing.ok) {
        await markNotSent(d.id, d.attemptCount + 1);
        return { retried: 1, delivered: 0 };
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
        const res = await fetch(d.subscription.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "workwrk-webhooks/1.0",
            "X-Workwrk-Event": d.event,
            "X-Workwrk-Delivery": d.id,
            "X-Workwrk-Timestamp": String(timestamp),
            "X-Workwrk-Signature": signatureHeader(signing.key, timestamp, body),
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const responseSnippet = await res
          .text()
          .then((t) => t.slice(0, 500))
          .catch(() => "");
        if (res.status >= 200 && res.status < 300) {
          await prisma.webhookDelivery.update({
            where: { id: d.id },
            data: {
              status: "DELIVERED",
              httpStatus: res.status,
              responseBody: responseSnippet,
              deliveredAt: new Date(),
              attemptCount: d.attemptCount + 1,
            },
          });
          await prisma.webhookSubscription.update({
            where: { id: d.subscription.id },
            data: { lastSuccessAt: new Date(), failureCount: 0 },
          });
          return { retried: 1, delivered: 1 };
        } else {
          await markFailed(d.id, d.subscription.id, res.status, responseSnippet, d.attemptCount + 1);
          return { retried: 1, delivered: 0 };
        }
      } catch (err) {
        await markFailed(
          d.id,
          d.subscription.id,
          null,
          err instanceof Error ? err.message.slice(0, 500) : "unknown",
          d.attemptCount + 1,
        );
        return { retried: 1, delivered: 0 };
      }
    }),
  );

  const retried = results.reduce((n, r) => n + r.retried, 0);
  const delivered = results.reduce((n, r) => n + r.delivered, 0);

  // Final-fail anything that exceeded retry budget.
  await prisma.webhookDelivery.updateMany({
    where: { status: "RETRYING", attemptCount: { gte: 8 } },
    data: { status: "FAILED" },
  });

  return { retried, delivered };
}
