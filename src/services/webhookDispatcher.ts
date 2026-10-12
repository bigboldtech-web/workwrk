import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { NOT_SENT_RETRY_MINUTES, signingKeyOf } from "@/lib/webhook-signing";
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
 * key would only be rejected. The delivery is HELD: marked "Not sent", tried
 * again every NOT_SENT_RETRY_MINUTES, and never given up, since nothing was
 * sent. A try that sends nothing is no attempt, so it never counts toward
 * the retry cap (MAX_ATTEMPTS) or the subscription's failure count: the
 * receiver did nothing wrong. Docs-found fixes batch 4: each such try used
 * to count as an attempt, so after 8 of them (about 4 hours, a key rotation
 * done out of order) every held delivery was marked FAILED for good. GET
 * /api/webhooks says `signing: "unreadable"` for such a subscription; once
 * the key is back, or its secret is rotated, the held deliveries go out.
 */
// signingKeyOf lives in src/lib/webhook-signing.ts, so GET /api/webhooks
// reads the very same answer without this module's imports.
export { NOT_SENT_RETRY_MINUTES, signingKeyOf, type SigningKey } from "@/lib/webhook-signing";

/** The X-Workwrk-Signature value for one delivery body. */
export function signatureHeader(key: string, timestamp: number, body: string): string {
  const signature = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * THE FIRST TRY. A delivery row is written PENDING before its first send,
 * with `nextAttemptAt` a lease of FIRST_TRY_LEASE_MS ahead, and the retry run
 * reads PENDING rows whose lease has passed as well as RETRYING ones. So a
 * delivery whose first answer was never recorded (the write that would hold
 * it, mark it failed or mark it delivered failed, or the process stopped
 * mid-send) is tried again, never left PENDING for good: docs-found fixes
 * batch 5 (the batch 4 review's low 7, a failed holdUnsent write). The lease
 * is far longer than a send can take, so a first try still running is never
 * sent twice by the retry: a send is bounded as a whole by
 * DELIVERY_TIMEOUT_MS, the answer's body included (postOnce). Docs-found
 * fixes batch 6: the timer stopped once the headers arrived, so a receiver
 * that trickled its body held the first try open past the lease, and the
 * retry sent it again while it ran. A delivery sent but whose DELIVERED
 * write failed may go out once more: its body carries the same `id`
 * (deliveryBody), so the receiver can drop it. Rows written PENDING before
 * this change have no lease and stay as they are: they may be months old,
 * and sending them now would hand receivers stale events.
 *
 * THE CLAIM. A row is claimed before every send, so no two runs send it at
 * once: the first try's claim is the lease its row is written with (no run
 * reads it before then), and a retry run claims each row it read by pushing
 * its `nextAttemptAt` FIRST_TRY_LEASE_MS ahead, in one write that holds only
 * while the row is still due and untouched (claimForSend). A run that loses
 * the claim sends nothing. Docs-found fixes batch 6: no row was claimed
 * before a retry sent it, so two retry runs that overlapped (a slow one and
 * the next five minutes' run) sent the same RETRYING rows twice. A claimed
 * row whose run stops mid-send is due again when the claim passes.
 */
const FIRST_TRY_LEASE_MS = NOT_SENT_RETRY_MINUTES * 60_000;
/** What the retry run reads once `nextAttemptAt` has passed: a retry, or a first try with no recorded answer. */
const RETRY_STATUSES: Array<"PENDING" | "RETRYING"> = ["PENDING", "RETRYING"];

/**
 * A delivery's body. Every try of one delivery carries the same `id` (the
 * delivery row's, the X-Workwrk-Delivery header) and `createdAt` (the
 * row's), so a receiver can de-duplicate by `id`; a retry's `data` is the
 * stored payload, whose keys the database may order differently. Docs-found
 * fixes batch 5: the first send's `id` was a random value and a retry's the
 * row id, so the same delivery reached a receiver under two ids.
 */
function deliveryBody(id: string, event: string, createdAt: Date, payload: unknown): string {
  return JSON.stringify({ id, event, createdAt: createdAt.toISOString(), data: payload });
}

export const NOT_SENT = `Not sent: this subscription's signing secret could not be opened on the server, so nothing was sent. It is tried again every ${NOT_SENT_RETRY_MINUTES} minutes until it can be.`;

export type DispatchEventInput = {
  organizationId: string;
  event: string;
  payload: unknown;
};

const RETRY_BACKOFF_MIN = 60; // 1 minute
const RETRY_BACKOFF_MAX = 60 * 60; // 1 hour
const MAX_FAILURE_COUNT_BEFORE_PAUSE = 10;
/** Sends a delivery gets before it is marked FAILED (~4 hours of backoff). A held try is no send. */
export const MAX_ATTEMPTS = 8;
const DELIVERY_TIMEOUT_MS = 10_000;
/** The answer's first characters kept on the delivery row; no more of the body is read. */
const SNIPPET_CHARS = 500;

/**
 * At most SNIPPET_CHARS of an answer's body, read under the send's own
 * timer (postOnce): a body that is large, or never ends, is cut off there,
 * keeping what had arrived.
 */
async function readSnippet(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, SNIPPET_CHARS);
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < SNIPPET_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // Cut off (the timer, or the connection): what arrived is the snippet.
  } finally {
    reader.cancel().catch(() => {});
  }
  return text.slice(0, SNIPPET_CHARS);
}

/**
 * One POST of a delivery, bounded as a whole (THE FIRST TRY, above): the
 * abort timer runs until the answer's body is read, never only to its
 * headers. Throws when no answer came (a network error, or the timer before
 * the headers); an answer whose body could not be read keeps an empty
 * snippet.
 */
async function postOnce(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; snippet: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    const snippet = await readSnippet(res).catch(() => "");
    return { status: res.status, snippet };
  } finally {
    clearTimeout(timeout);
  }
}

/** A delivery's request headers. */
function deliveryHeaders(event: string, deliveryId: string, timestamp: number, key: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "workwrk-webhooks/1.0",
    "X-Workwrk-Event": event,
    "X-Workwrk-Delivery": deliveryId,
    "X-Workwrk-Timestamp": String(timestamp),
    "X-Workwrk-Signature": signatureHeader(key, timestamp, body),
  };
}

/**
 * THE ANSWER IS KEPT APART FROM ITS BOOKKEEPING. A send that got a 2xx was
 * delivered, whatever happens to the writes that record it. Docs-found fixes
 * batch 7 (the batch 4 review's low, kept since batch 5): the DELIVERED
 * write and the subscription's success write sat in the send's try, so a
 * database blip after a 2xx went through markFailed: the row went back to
 * RETRYING with a backoff, the subscription's failure count rose (ten such
 * blips paused a receiver that did nothing wrong), and it was sent again.
 * Now only the send itself (postOnce) can count a failure, and after a 2xx
 * each write is tried BOOKKEEPING_TRIES times. A DELIVERED write that never
 * lands leaves the row as its claim left it (the first try's lease, or a
 * retry run's claim), so it is sent once more when that passes, with the
 * same id, and the receiver can drop it; nothing is counted against the
 * subscription. A failed mark after a failed send is left the same way.
 */
const BOOKKEEPING_TRIES = 3;
const BOOKKEEPING_PAUSE_MS = 200;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A bookkeeping failure as the log says it: the error's kind and its Prisma
 * code, never its message, which can quote what the write carried (a
 * receiver's answer, a send's error). Docs-found fixes batch 8 (the batch 7
 * review): every such failure was dropped without a word, so a DELIVERED
 * write that kept failing (a column, a constraint) sent the same delivery
 * again after every lease with nothing reaching ops.
 */
function failureKind(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{1,8}$/.test(code) ? `${name} ${code}` : name;
}

/**
 * A mark after a failed send that did not finish, logged (see failureKind):
 * a delivery never marked stays on its claim and goes again when that
 * passes; one marked whose subscription's failure count was not raised
 * goes at its backoff, while its tries last.
 */
function markFailedLost(deliveryId: string, err: unknown): void {
  console.error(`[webhooks] delivery ${deliveryId}: recording its failed send did not finish (${failureKind(err)})`);
}

/** One bookkeeping write, tried again on a failure; false when no try landed, said in the log with `what` and what follows. Never throws. */
async function written(what: string, then: string, write: () => Promise<unknown>): Promise<boolean> {
  for (let attempt = 1; attempt <= BOOKKEEPING_TRIES; attempt += 1) {
    try {
      await write();
      return true;
    } catch (err) {
      if (attempt < BOOKKEEPING_TRIES) await pause(BOOKKEEPING_PAUSE_MS * attempt);
      else console.error(`[webhooks] ${what} was not recorded after ${BOOKKEEPING_TRIES} tries (${failureKind(err)}); ${then}`);
    }
  }
  return false;
}

/** A 2xx, recorded (THE ANSWER IS KEPT APART FROM ITS BOOKKEEPING): the delivery DELIVERED, then the subscription's success. */
async function recordDelivered(deliveryId: string, subscriptionId: string, res: { status: number; snippet: string }, attemptCount: number): Promise<void> {
  await written(`delivery ${deliveryId}'s 2xx`, "it goes again, with the same id, when its claim passes", () =>
    prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "DELIVERED", httpStatus: res.status, responseBody: res.snippet, deliveredAt: new Date(), attemptCount },
    }),
  );
  // The receiver answered, so its success is true even when the delivery's own write never landed.
  await written(`subscription ${subscriptionId}'s success`, "its last success and failure count stay as they were", () =>
    prisma.webhookSubscription.update({ where: { id: subscriptionId }, data: { lastSuccessAt: new Date(), failureCount: 0 } }),
  );
}

/**
 * A retry run's claim on one row it read (THE CLAIM, above): true when this
 * run holds it now and may send it. The write holds only while the row is
 * still due by this run's clock, unsent since it was read and not yet done,
 * and its subscription still ACTIVE; a failed write is no claim.
 * Docs-found fixes batch 7: a subscription paused (by its owner, or by ten
 * failures) between the run's read and the claim still got this run's
 * send. The status is read in the same write, so a pause that lands before
 * it sends nothing; one that lands after the claim can still let that one
 * send go out.
 */
async function claimForSend(d: { id: string; attemptCount: number }, dueBy: Date): Promise<boolean> {
  try {
    const { count } = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: { in: RETRY_STATUSES }, attemptCount: d.attemptCount, nextAttemptAt: { lte: dueBy }, subscription: { status: "ACTIVE" } },
      data: { nextAttemptAt: new Date(Date.now() + FIRST_TRY_LEASE_MS) },
    });
    return count === 1;
  } catch {
    return false;
  }
}

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
  // Signature: HMAC-SHA256 over `<timestamp>.<body>` with the signing key
  // (THE SIGNING KEY, above).
  const timestamp = Math.floor(Date.now() / 1000);
  const signing = signingKeyOf(params.sub);

  // PENDING with a lease (THE FIRST TRY, above): if nothing records this
  // try's answer, the retry run reads it once the lease passes.
  const delivery = await prisma.webhookDelivery.create({
    data: {
      subscriptionId: params.sub.id,
      event: params.event,
      payload: params.payload as object,
      organizationId: params.organizationId,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(Date.now() + FIRST_TRY_LEASE_MS),
    },
    select: { id: true, createdAt: true },
  });
  const body = deliveryBody(delivery.id, params.event, delivery.createdAt, params.payload);

  if (!signing.ok) {
    await holdUnsent(params.sub.id, [delivery.id]).catch(() => {});
    return;
  }

  // Claimed by the lease the row was just written with (THE CLAIM, above).
  // Only the send can fail the delivery (THE ANSWER IS KEPT APART FROM ITS
  // BOOKKEEPING, above).
  let res: { status: number; snippet: string };
  try {
    res = await postOnce(params.sub.url, deliveryHeaders(params.event, delivery.id, timestamp, signing.key, body), body);
  } catch (err) {
    await markFailed(delivery.id, params.sub.id, null, err instanceof Error ? err.message.slice(0, 500) : "unknown", 1).catch((e) => markFailedLost(delivery.id, e));
    return;
  }
  if (res.status >= 200 && res.status < 300) await recordDelivered(delivery.id, params.sub.id, res, 1);
  else await markFailed(delivery.id, params.sub.id, res.status, res.snippet, 1).catch((e) => markFailedLost(delivery.id, e));
}

/**
 * Deliveries never sent (their subscription's key could not be opened):
 * held, tried again in NOT_SENT_RETRY_MINUTES. Their attemptCount is left
 * as it is, since nothing was sent, so the retry cap never gives them up,
 * and the subscription's failure count is left alone. `ids` are the
 * deliveries this run read; `dueBy` also takes every other delivery of that
 * subscription already due, in the same write, so a large backlog behind an
 * unreadable key is moved on at once and never fills the retry batch that
 * other subscriptions' retries wait in.
 */
async function holdUnsent(subscriptionId: string, ids: string[], dueBy?: Date) {
  const nextAttemptAt = new Date(Date.now() + NOT_SENT_RETRY_MINUTES * 60_000);
  await prisma.webhookDelivery.updateMany({
    where: {
      subscriptionId,
      // A delivery out of sends is left for processWebhookRetries'
      // final-fail, its last answer kept.
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [{ id: { in: ids } }, ...(dueBy ? [{ status: { in: RETRY_STATUSES }, nextAttemptAt: { lte: dueBy } }] : [])],
    },
    data: { status: "RETRYING", responseBody: NOT_SENT, nextAttemptAt },
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
  // The oldest due first, and only an ACTIVE subscription's: a paused one's
  // deliveries were read here and skipped without a write, so they stayed
  // due for good and, once a hundred of them piled up, filled every batch.
  // A first try whose answer was never recorded is due once its lease passes
  // (THE FIRST TRY, above).
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: RETRY_STATUSES },
      nextAttemptAt: { lte: now },
      attemptCount: { lt: MAX_ATTEMPTS }, // cap at 8 sends (~4 hours total backoff)
      subscription: { status: "ACTIVE" },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 100,
    include: {
      subscription: { select: { id: true, url: true, secretHash: true, secretSealed: true, status: true } },
    },
  });

  // A subscription whose key can't be opened sends nothing this run: its
  // deliveries here, and every other one of it already due, are held in one
  // write per subscription (holdUnsent).
  const unreadable = new Map<string, string[]>();
  for (const d of due) {
    if (d.subscription.status === "ACTIVE" && !signingKeyOf(d.subscription).ok) {
      unreadable.set(d.subscription.id, [...(unreadable.get(d.subscription.id) ?? []), d.id]);
    }
  }
  await Promise.all([...unreadable].map(([subscriptionId, ids]) => holdUnsent(subscriptionId, ids, now)));

  // Run retries in parallel — each delivery targets a different subscription,
  // so one slow receiver can't hold up the whole queue (previously a single
  // 10s timeout would block up to 100 subsequent retries → ~17 minutes).
  const results = await Promise.all(
    due.map(async (d): Promise<{ retried: 0 | 1; delivered: 0 | 1 }> => {
      if (d.subscription.status !== "ACTIVE" || unreadable.has(d.subscription.id)) return { retried: 0, delivered: 0 };

      const body = deliveryBody(d.id, d.event, d.createdAt, d.payload);
      const signing = signingKeyOf(d.subscription);
      if (!signing.ok) return { retried: 0, delivered: 0 };
      // Claimed before the send, or another run has it (THE CLAIM, above).
      if (!(await claimForSend(d, now))) return { retried: 0, delivered: 0 };
      const timestamp = Math.floor(Date.now() / 1000);

      // Only the send can fail the delivery (THE ANSWER IS KEPT APART FROM ITS BOOKKEEPING, above).
      let res: { status: number; snippet: string };
      try {
        res = await postOnce(d.subscription.url, deliveryHeaders(d.event, d.id, timestamp, signing.key, body), body);
      } catch (err) {
        await markFailed(d.id, d.subscription.id, null, err instanceof Error ? err.message.slice(0, 500) : "unknown", d.attemptCount + 1).catch((e) => markFailedLost(d.id, e));
        return { retried: 1, delivered: 0 };
      }
      if (res.status >= 200 && res.status < 300) {
        await recordDelivered(d.id, d.subscription.id, res, d.attemptCount + 1);
        return { retried: 1, delivered: 1 };
      }
      await markFailed(d.id, d.subscription.id, res.status, res.snippet, d.attemptCount + 1).catch((e) => markFailedLost(d.id, e));
      return { retried: 1, delivered: 0 };
    }),
  );

  const retried = results.reduce((n, r) => n + r.retried, 0);
  const delivered = results.reduce((n, r) => n + r.delivered, 0);

  // Final-fail anything that exceeded retry budget: sends only, never a
  // held delivery, whose tries sent nothing and left its count as it was.
  await prisma.webhookDelivery.updateMany({
    where: { status: "RETRYING", attemptCount: { gte: MAX_ATTEMPTS } },
    data: { status: "FAILED" },
  });

  return { retried, delivered };
}
