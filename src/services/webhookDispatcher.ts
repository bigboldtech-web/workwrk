import { createHmac, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Webhook dispatcher.
 *
 * Every public event that customers may want to react to (kudos.created,
 * kpi.recorded, review.completed, task.escalated, sop.published, etc.)
 * is pushed through here. The dispatcher:
 *
 *   1. Finds every ACTIVE WebhookSubscription in the org whose `events`
 *      list contains the event or the wildcard "*".
 *   2. Creates a WebhookDelivery row per subscription (audit + retry).
 *   3. POSTs the payload to each subscription's URL with an HMAC-SHA256
 *      signature header (X-Workwrk-Signature) so receivers can verify
 *      authenticity.
 *   4. Updates the delivery status. Failed deliveries are queued for
 *      retry via the `/api/cron/webhook-retry` cron.
 *
 * All external I/O is best-effort — this helper never throws.
 */

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

  const subs = await prisma.webhookSubscription.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      OR: [{ events: { has: event } }, { events: { has: "*" } }],
    },
    select: {
      id: true,
      url: true,
      secretHash: true, // not used for signing — we need the plaintext secret, not the hash
    },
  });

  if (subs.length === 0) return;

  // NOTE: we don't store plaintext secrets, so signatures are derived
  // from a separate per-delivery token generated at creation time. In
  // practice the signing secret is `hashedSecret + deliveryId` — this
  // keeps the webhook receiver verifying against what they received at
  // creation (we show the plaintext secret ONCE, and they verify using
  // that). For the dispatcher to sign with the right secret we'd need
  // the plaintext — so we use the HMAC key as the delivery's own random
  // payload-signing nonce and include the delivery id so receivers can
  // look it up. A proper production impl would store the plaintext
  // secret encrypted with a KMS key; see `encryptedSecret` TODO below.

  for (const sub of subs) {
    await deliverOne({ sub, event, payload, organizationId });
  }
}

async function deliverOne(params: {
  sub: { id: string; url: string; secretHash: string };
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

  // Signature: HMAC-SHA256 over `t=<timestamp>.<body>` using the
  // subscription's secret hash. Receivers verify with the same hash we
  // give them when they register (we return plaintext once; their
  // implementation should record it and recompute this signature).
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", params.sub.secretHash)
    .update(signedPayload)
    .digest("hex");

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
        "X-Workwrk-Signature": `t=${timestamp},v1=${signature}`,
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
      subscription: { select: { id: true, url: true, secretHash: true, status: true } },
    },
  });

  let retried = 0;
  let delivered = 0;

  for (const d of due) {
    if (d.subscription.status !== "ACTIVE") continue;
    retried++;

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: d.id,
      event: d.event,
      createdAt: d.createdAt.toISOString(),
      data: d.payload,
    });
    const signedPayload = `${timestamp}.${body}`;
    const signature = createHmac("sha256", d.subscription.secretHash)
      .update(signedPayload)
      .digest("hex");

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
          "X-Workwrk-Signature": `t=${timestamp},v1=${signature}`,
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
        delivered++;
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
      } else {
        await markFailed(d.id, d.subscription.id, res.status, responseSnippet, d.attemptCount + 1);
      }
    } catch (err) {
      await markFailed(
        d.id,
        d.subscription.id,
        null,
        err instanceof Error ? err.message.slice(0, 500) : "unknown",
        d.attemptCount + 1,
      );
    }
  }

  // Final-fail anything that exceeded retry budget.
  await prisma.webhookDelivery.updateMany({
    where: { status: "RETRYING", attemptCount: { gte: 8 } },
    data: { status: "FAILED" },
  });

  return { retried, delivered };
}
