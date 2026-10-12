// Docs-found fixes batch 3: POST /api/webhooks shows the caller a secret and
// says to verify X-Workwrk-Signature with it, but every delivery was signed
// with secretHash, the SHA-256 hex of that secret, so a receiver doing what
// it was told rejected every delivery. Now a delivery is signed with the
// secret itself, opened from secretSealed. A subscription made before the
// secret was kept (secretSealed null) keeps signing with the hash, as it
// always did; a sealed secret no key opens sends nothing.

import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  subs: [] as Array<{ id: string; url: string; secretHash: string; secretSealed: unknown }>,
  due: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ url: string; headers: Record<string, string>; body: string }>,
  deliveries: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  subUpdates: [] as unknown[],
  /** Every updateMany on deliveries, in order (the held writes, the final-fail). */
  many: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  /** What the retry run asked the queue for. */
  dueQuery: null as Record<string, unknown> | null,
  /** Every delivery row written, as written. */
  created: [] as Array<Record<string, unknown>>,
  /** The next updateMany (a hold) fails, as a dropped connection would. */
  failHoldOnce: false,
  /** Each retry run's claim on a row it read (batch 6), with the row's nextAttemptAt as the database holds it. */
  claims: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown>; won: boolean }>,
  claimedUntil: new Map<string, Date>(),
  /** Every write and send, in order, by kind and delivery id. */
  order: [] as string[],
  /** Subscriptions paused since the retry run read its rows (batch 7). */
  pausedNow: new Set<string>(),
  /** How many tries of the DELIVERED write, and of the subscription's success write, fail before one lands (batch 7). */
  failDelivered: 0,
  failSuccess: 0,
  /** Each failed bookkeeping write throws this, when set (batch 8); else a plain connection reset. */
  failWith: null as null | (() => Error),
  /** Every mark of a failed send (RETRYING) fails, when set (batch 8). */
  failRetrying: false,
}));

vi.mock("@/lib/automation/engine", () => ({ runAutomationsForEvent: async () => undefined }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookSubscription: {
      findMany: async () => st.subs,
      update: async (a: { data: Record<string, unknown> }) => {
        if (a.data.failureCount === 0 && st.failSuccess > 0) { st.failSuccess -= 1; throw st.failWith?.() ?? new Error("connection reset"); }
        st.subUpdates.push(a);
        return { failureCount: 1 };
      },
    },
    webhookDelivery: {
      create: async (a: { data: Record<string, unknown> }) => {
        st.created.push(a.data);
        return { id: `d${st.created.length}`, createdAt: new Date(Date.UTC(2026, 9, 12, 9, 0, st.created.length)) };
      },
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        if (a.data.status === "DELIVERED" && st.failDelivered > 0) { st.failDelivered -= 1; st.order.push(`delivered-failed ${a.where.id}`); throw st.failWith?.() ?? new Error("connection reset"); }
        if (a.data.status === "RETRYING" && st.failRetrying) throw st.failWith?.() ?? new Error("connection reset");
        st.deliveries.push(a);
        return {};
      },
      findMany: async (a: Record<string, unknown>) => { st.dueQuery = a; return st.due; },
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        // A retry run's claim (one row, by id, pushed forward): a real
        // compare-and-set on nextAttemptAt, the row due unless a claim moved it.
        if (typeof a.where.id === "string" && Object.keys(a.data).join() === "nextAttemptAt") {
          const id = a.where.id;
          const dueBy = (a.where.nextAttemptAt as { lte: Date }).lte;
          const held = st.claimedUntil.get(id);
          // The subscription's status as the database holds it at the write (batch 7).
          const subId = (st.due.find((d) => d.id === id)?.subscription as { id: string } | undefined)?.id ?? "";
          const active = !(a.where.subscription as { status?: string } | undefined) || ((a.where.subscription as { status: string }).status === "ACTIVE" && !st.pausedNow.has(subId));
          const won = (!held || held <= dueBy) && active;
          if (won) st.claimedUntil.set(id, a.data.nextAttemptAt as Date);
          st.claims.push({ ...a, won });
          st.order.push(`claim ${id}`);
          return { count: won ? 1 : 0 };
        }
        if (st.failHoldOnce) { st.failHoldOnce = false; throw new Error("connection reset"); }
        st.many.push(a);
        return { count: 0 };
      },
    },
  },
}));

const savedKey = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = "a".repeat(64);

import { sealToken } from "@/lib/connectors/seal";
import { dispatchEvent, processWebhookRetries, signingKeyOf } from "./webhookDispatcher";

const SECRET = "whsec_shown_once_to_the_receiver";
const HASH = createHash("sha256").update(SECRET).digest("hex");

/** What a receiver does with the secret it was shown. */
function verifies(key: string, headers: Record<string, string>, body: string): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(headers["X-Workwrk-Signature"] ?? "");
  if (!m) return false;
  return createHmac("sha256", key).update(`${m[1]}.${body}`).digest("hex") === m[2];
}

beforeEach(() => {
  st.subs = [];
  st.due = [];
  st.sent = [];
  st.deliveries = [];
  st.subUpdates = [];
  st.many = [];
  st.dueQuery = null;
  st.created = [];
  st.failHoldOnce = false;
  st.claims = [];
  st.claimedUntil = new Map();
  st.order = [];
  st.pausedNow = new Set();
  st.failDelivered = 0;
  st.failSuccess = 0;
  st.failWith = null;
  st.failRetrying = false;
  vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
    st.sent.push({ url, headers: init.headers, body: init.body });
    st.order.push(`send ${init.headers["X-Workwrk-Delivery"]}`);
    return new Response("ok", { status: 200 });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedKey;
});

describe("the key a delivery is signed with", () => {
  it("signs with the secret the receiver was shown", async () => {
    st.subs = [{ id: "s1", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET) }];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k1" } });
    expect(st.sent).toHaveLength(1);
    expect(verifies(SECRET, st.sent[0].headers, st.sent[0].body)).toBe(true);
    expect(verifies(HASH, st.sent[0].headers, st.sent[0].body)).toBe(false);
  });

  it("keeps signing an older subscription with its hash, as before, until its secret is rotated", async () => {
    st.subs = [{ id: "old", url: "https://hook.test/old", secretHash: HASH, secretSealed: null }];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k2" } });
    expect(verifies(HASH, st.sent[0].headers, st.sent[0].body)).toBe(true);
  });

  it("names which key a subscription signs with", () => {
    expect(signingKeyOf({ secretHash: HASH, secretSealed: null })).toEqual({ ok: true, key: HASH, signing: "legacy_hash" });
    expect(signingKeyOf({ secretHash: HASH, secretSealed: sealToken(SECRET) })).toEqual({ ok: true, key: SECRET, signing: "secret" });
    expect(signingKeyOf({ secretHash: HASH, secretSealed: { v: 1, iv: "00", ct: "00", tag: "00" } })).toEqual({ ok: false });
  });

  it("sends nothing when the sealed secret can't be opened, and leaves the subscription's failure count alone", async () => {
    st.subs = [{ id: "s2", url: "https://hook.test/in", secretHash: HASH, secretSealed: { v: 1, iv: "00", ct: "00", tag: "00" } }];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k3" } });
    expect(st.sent).toEqual([]);
    // Held: waiting for a retry, and no send counted (docs-found fixes batch 4).
    expect(st.many).toHaveLength(1);
    expect(st.many[0].data).toMatchObject({ status: "RETRYING" });
    expect(st.many[0].data).not.toHaveProperty("attemptCount");
    expect(String(st.many[0].data.responseBody)).toMatch(/^Not sent: .*tried again every 15 minutes/);
    expect(st.subUpdates).toEqual([]);
  });

  it("signs a retry with the secret too", async () => {
    st.due = [{
      id: "d9", event: "kpi.recorded", payload: { id: "r1" }, createdAt: new Date(), attemptCount: 1,
      subscription: { id: "s3", url: "https://hook.test/retry", secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
    }];
    await processWebhookRetries();
    expect(st.sent).toHaveLength(1);
    expect(verifies(SECRET, st.sent[0].headers, st.sent[0].body)).toBe(true);
  });
});

// Docs-found fixes batch 4: a held delivery (its sealed secret no key opens)
// counted each try that sent nothing as an attempt, so after 8 of them
// (about four hours) it was marked FAILED for good and the event was lost.
describe("a delivery held by a secret the server can't open", () => {
  const UNREADABLE = { v: 1, iv: "00", ct: "00", tag: "00" };
  const held = (id: string, attemptCount: number, secretSealed: unknown = UNREADABLE) => ({
    id, event: "kudos.created", payload: { id }, createdAt: new Date(), attemptCount,
    subscription: { id: "s-held", url: "https://hook.test/held", secretHash: HASH, secretSealed, status: "ACTIVE" },
  });

  it("is never counted as a send, so the retry cap never gives it up, and every due one of it is held in one write", async () => {
    st.due = [held("d1", 7), held("d2", 0)];
    const out = await processWebhookRetries();
    expect(st.sent).toEqual([]);
    // No write counts a send: no delivery reaches 8 and is failed for it.
    expect(st.deliveries).toEqual([]);
    const hold = st.many.find((m) => m.data.responseBody !== undefined)!;
    expect(hold.data).toMatchObject({ status: "RETRYING" });
    expect(hold.data).not.toHaveProperty("attemptCount");
    expect(hold.where).toMatchObject({ subscriptionId: "s-held", attemptCount: { lt: 8 } });
    // The two read here, and every other one of that subscription already due.
    expect(JSON.stringify(hold.where.OR)).toContain('"d1"');
    expect(JSON.stringify(hold.where.OR)).toContain('"nextAttemptAt"');
    expect(st.subUpdates).toEqual([]);
    expect(out).toEqual({ retried: 0, delivered: 0 });
  });

  it("goes out, signed with the secret, once the secret can be opened again", async () => {
    st.due = [held("d3", 7, sealToken(SECRET))];
    await processWebhookRetries();
    expect(st.sent).toHaveLength(1);
    expect(verifies(SECRET, st.sent[0].headers, st.sent[0].body)).toBe(true);
    expect(st.deliveries[0].data).toMatchObject({ status: "DELIVERED", attemptCount: 8 });
  });

  it("reads only an active subscription's retries, the oldest due first", async () => {
    await processWebhookRetries();
    // A retry, or a first try whose answer was never recorded (docs-found fixes batch 5).
    expect(st.dueQuery?.where).toMatchObject({ status: { in: ["PENDING", "RETRYING"] }, subscription: { status: "ACTIVE" }, attemptCount: { lt: 8 } });
    expect(st.dueQuery?.orderBy).toEqual({ nextAttemptAt: "asc" });
  });
});

// Docs-found fixes batch 5 (the batch 4 review's lows 7 and 10): a first try
// whose answer was never written (holdUnsent's write failed) stayed PENDING,
// which the retry never read, so the event was lost; and a first send's body
// carried a random id while a retry's carried the delivery's, so a receiver
// could not tell they were the same delivery.
describe("a delivery's first try", () => {
  const UNREADABLE = { v: 1, iv: "00", ct: "00", tag: "00" };

  it("is written with a lease, so the retry reads it if no answer is ever recorded", async () => {
    st.subs = [{ id: "s4", url: "https://hook.test/in", secretHash: HASH, secretSealed: UNREADABLE }];
    st.failHoldOnce = true;
    const before = Date.now();
    await expect(dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k5" } })).resolves.toBeUndefined();
    // The hold failed: nothing marks it, so it stays PENDING with its lease.
    expect(st.many).toEqual([]);
    expect(st.created[0]).toMatchObject({ status: "PENDING", attemptCount: 0 });
    const lease = (st.created[0].nextAttemptAt as Date).getTime();
    expect(lease).toBeGreaterThanOrEqual(before + 15 * 60_000);
    // And the retry run reads a PENDING row whose lease has passed.
    await processWebhookRetries();
    const where = st.dueQuery?.where as { status: { in: string[] }; nextAttemptAt: { lte: Date } };
    expect(where.status.in).toContain("PENDING");
    expect(where.nextAttemptAt.lte.getTime()).toBeLessThan(lease);
  });

  it("sends a PENDING delivery the retry reads, and records its answer", async () => {
    st.due = [{
      id: "d-orphan", event: "kudos.created", payload: { id: "k6" }, createdAt: new Date(), attemptCount: 0, status: "PENDING",
      subscription: { id: "s5", url: "https://hook.test/orphan", secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
    }];
    await processWebhookRetries();
    expect(st.sent).toHaveLength(1);
    expect(st.deliveries[0]).toMatchObject({ where: { id: "d-orphan" }, data: { status: "DELIVERED", attemptCount: 1 } });
  });

  it("carries the delivery's id and time in its body, the same on every retry of it", async () => {
    st.subs = [{ id: "s6", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET) }];
    await dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k7" } });
    const first = JSON.parse(st.sent[0].body) as { id: string; createdAt: string };
    expect(first.id).toBe("d1");
    expect(first.id).toBe(st.sent[0].headers["X-Workwrk-Delivery"]);
    // The retry of that same row sends the same body.
    st.due = [{
      id: "d1", event: "kudos.created", payload: { id: "k7" }, createdAt: new Date(first.createdAt), attemptCount: 1,
      subscription: { id: "s6", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
    }];
    await processWebhookRetries();
    const again = JSON.parse(st.sent[1].body) as { id: string; createdAt: string; event: string };
    expect(again).toMatchObject({ id: first.id, createdAt: first.createdAt, event: "kudos.created" });
    expect(st.sent[1].headers["X-Workwrk-Delivery"]).toBe(first.id);
  });
});

// Docs-found fixes batch 6 (the batch 5 review's webhook low): the timer
// stopped once the answer's headers arrived, so a receiver that trickled its
// body held the first try open past its lease and the retry sent it again
// while it ran; and no row was claimed before a retry sent it, so two retry
// runs that overlapped sent the same rows twice.
describe("a send is bounded and claimed", () => {
  const due = (id: string) => ({
    id, event: "kudos.created", payload: { id }, createdAt: new Date(), attemptCount: 1, status: "RETRYING",
    subscription: { id: "s7", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
  });

  it("keeps the send's timer running until the answer's body is read, keeping what arrived", async () => {
    vi.useFakeTimers();
    try {
      // A receiver that answers 200 at once and then never finishes its body.
      vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => {
        st.sent.push({ url, headers: init.headers, body: init.body });
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode("accepted, still"));
            init.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
          },
        });
        return new Response(stream, { status: 200 });
      });
      st.subs = [{ id: "s8", url: "https://hook.test/slow", secretHash: HASH, secretSealed: sealToken(SECRET) }];
      let settled = false;
      const sending = dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k8" } }).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(9_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_500);
      // Cut off at the send's 10 seconds, body included: far inside the 15-minute lease.
      expect(st.deliveries[0]).toMatchObject({ where: { id: "d1" }, data: { status: "DELIVERED", httpStatus: 200, responseBody: "accepted, still" } });
      await sending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads no more of an answer's body than the 500 characters it keeps", async () => {
    let pulled = 0;
    // A 100,000-character answer, a thousand characters a chunk.
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        if (pulled > 100) c.close();
        else c.enqueue(new TextEncoder().encode("x".repeat(1000)));
      },
    }, { highWaterMark: 0 }), { status: 500 }));
    st.due = [due("d-big")];
    await processWebhookRetries();
    expect(String(st.deliveries[0].data.responseBody)).toHaveLength(500);
    expect(pulled).toBeLessThanOrEqual(2);
  });

  it("claims each retry before sending it, and sends nothing it lost to another run", async () => {
    st.due = [due("d-a"), due("d-b")];
    // Another run already holds d-b.
    st.claimedUntil.set("d-b", new Date(Date.now() + 15 * 60_000));
    const before = Date.now();
    const out = await processWebhookRetries();
    expect(st.sent.map((m) => m.headers["X-Workwrk-Delivery"])).toEqual(["d-a"]);
    expect(out).toEqual({ retried: 1, delivered: 1 });
    expect(st.order.indexOf("claim d-a")).toBeLessThan(st.order.indexOf("send d-a"));
    const claim = st.claims.find((c) => c.where.id === "d-a")!;
    expect(claim.where).toMatchObject({ status: { in: ["PENDING", "RETRYING"] }, attemptCount: 1 });
    expect((claim.data.nextAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
  });

  it("sends a due row once when two retry runs overlap", async () => {
    st.due = [due("d-once")];
    await Promise.all([processWebhookRetries(), processWebhookRetries()]);
    expect(st.sent).toHaveLength(1);
    expect(st.claims.map((c) => c.won).sort()).toEqual([false, true]);
  });
});

// Docs-found fixes batch 7 (the batch 6 review's low, and the batch 4
// review's, kept since batch 5): the claim did not ask that the subscription
// was still active, and a failed DELIVERED or subscription write after a 2xx
// went through markFailed, so the receiver was counted as failing and sent
// the delivery again.
describe("a claim for an active subscription, and a 2xx never counted as a failure", () => {
  const due = (id: string) => ({
    id, event: "kudos.created", payload: { id }, createdAt: new Date(), attemptCount: 1, status: "RETRYING",
    subscription: { id: "s9", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
  });
  const failures = () => [
    ...st.deliveries.filter((w) => w.data.status === "RETRYING" || w.data.status === "FAILED"),
    ...(st.subUpdates as Array<{ data: Record<string, unknown> }>).filter((w) => w.data.failureCount !== 0),
  ];

  it("claims only while the subscription is still active, so one paused since the run's read gets no send", async () => {
    st.due = [due("d-paused")];
    st.pausedNow.add("s9");
    const out = await processWebhookRetries();
    expect(st.sent).toEqual([]);
    expect(out).toEqual({ retried: 0, delivered: 0 });
    expect(st.claims[0].where).toMatchObject({ id: "d-paused", subscription: { status: "ACTIVE" } });
    // An active one is still claimed and sent.
    st.pausedNow.clear();
    st.claimedUntil.clear();
    await processWebhookRetries();
    expect(st.sent).toHaveLength(1);
  });

  it("tries a first try's DELIVERED write again after a 2xx, and never marks the receiver failed", async () => {
    st.subs = [{ id: "s10", url: "https://hook.test/in", secretHash: HASH, secretSealed: sealToken(SECRET) }];
    st.failDelivered = 1;
    st.failSuccess = 1;
    await expect(dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k9" } })).resolves.toBeUndefined();
    expect(st.sent).toHaveLength(1);
    expect(st.order).toEqual(["send d1", "delivered-failed d1"]);
    expect(st.deliveries).toEqual([expect.objectContaining({ where: { id: "d1" }, data: expect.objectContaining({ status: "DELIVERED", httpStatus: 200, attemptCount: 1 }) })]);
    expect(st.subUpdates).toEqual([expect.objectContaining({ where: { id: "s10" }, data: expect.objectContaining({ failureCount: 0 }) })]);
    expect(failures()).toEqual([]);
  });

  it("leaves a retry whose DELIVERED write never lands to its claim, counted against no one, and still counts it delivered", async () => {
    st.due = [due("d-blip")];
    st.failDelivered = 3;
    const out = await processWebhookRetries();
    expect(st.sent).toHaveLength(1);
    expect(st.order.filter((o) => o.startsWith("delivered-failed"))).toHaveLength(3);
    // No write after the claim: the row is due again when the claim passes, sent with the same id.
    expect(st.deliveries).toEqual([]);
    expect(failures()).toEqual([]);
    // The receiver answered 2xx: its success is still recorded.
    expect(st.subUpdates).toEqual([expect.objectContaining({ where: { id: "s9" }, data: expect.objectContaining({ failureCount: 0 }) })]);
    expect(out).toEqual({ retried: 1, delivered: 1 });
  });
});

// Docs-found fixes batch 8 (the batch 7 review): a bookkeeping write that
// kept failing after a 2xx was tried three times and then dropped without a
// word, and so was a failed mark after a failed send, so a DELIVERED write
// that could never land (a column, a constraint) sent the same delivery
// again after every lease with nothing reaching ops.
describe("bookkeeping that never lands is logged, without secrets", () => {
  const due = (id: string) => ({
    id, event: "kudos.created", payload: { id, note: "payload words" }, createdAt: new Date(), attemptCount: 1, status: "RETRYING",
    subscription: { id: "s11", url: `https://hook.test/in?token=${SECRET}`, secretHash: HASH, secretSealed: sealToken(SECRET), status: "ACTIVE" },
  });
  // What a failed write's message can carry: the receiver's answer, the address and its token.
  const leaky = () => Object.assign(new Error(`Invalid update: responseBody "receiver said ok" for https://hook.test/in?token=${SECRET}`), { name: "PrismaClientKnownRequestError", code: "P2022" });

  it("says which delivery's 2xx and which subscription's success were not recorded, by the error's kind and code alone", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    st.failWith = leaky;
    st.due = [due("d-col")];
    st.failDelivered = 3;
    st.failSuccess = 3;
    await processWebhookRetries();
    const lines = logged.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines).toEqual([
      "[webhooks] delivery d-col's 2xx was not recorded after 3 tries (PrismaClientKnownRequestError P2022); it goes again, with the same id, when its claim passes",
      "[webhooks] subscription s11's success was not recorded after 3 tries (PrismaClientKnownRequestError P2022); its last success and failure count stay as they were",
    ]);
    for (const l of lines) {
      expect(l).not.toContain(SECRET);
      expect(l).not.toMatch(/hook\.test|receiver said|payload words|--|\u2014/);
    }
    logged.mockRestore();
  });

  it("logs a failed send whose mark never landed, on the first try and on a retry, and nothing when a write lands on a later try", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    st.failWith = leaky;
    st.failRetrying = true;
    st.subs = [{ id: "s12", url: `https://hook.test/in?token=${SECRET}`, secretHash: HASH, secretSealed: sealToken(SECRET) }];
    await expect(dispatchEvent({ organizationId: "org", event: "kudos.created", payload: { id: "k12" } })).resolves.toBeUndefined();
    st.due = [due("d-retry")];
    await processWebhookRetries();
    const lines = logged.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines).toEqual([
      "[webhooks] delivery d1: recording its failed send did not finish (PrismaClientKnownRequestError P2022)",
      "[webhooks] delivery d-retry: recording its failed send did not finish (PrismaClientKnownRequestError P2022)",
    ]);
    for (const l of lines) expect(l).not.toContain(SECRET);
    // A write that lands on its second try says nothing.
    logged.mockClear();
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    st.failRetrying = false;
    st.claimedUntil.clear();
    st.failDelivered = 1;
    await processWebhookRetries();
    expect(logged.mock.calls).toEqual([]);
    logged.mockRestore();
  });
});
