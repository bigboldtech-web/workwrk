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
}));

vi.mock("@/lib/automation/engine", () => ({ runAutomationsForEvent: async () => undefined }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookSubscription: {
      findMany: async () => st.subs,
      update: async (a: unknown) => { st.subUpdates.push(a); return { failureCount: 1 }; },
    },
    webhookDelivery: {
      create: async () => ({ id: `d${st.deliveries.length + 1}` }),
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => { st.deliveries.push(a); return {}; },
      findMany: async (a: Record<string, unknown>) => { st.dueQuery = a; return st.due; },
      updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => { st.many.push(a); return { count: 0 }; },
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
  vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
    st.sent.push({ url, headers: init.headers, body: init.body });
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
    expect(st.dueQuery?.where).toMatchObject({ status: "RETRYING", subscription: { status: "ACTIVE" }, attemptCount: { lt: 8 } });
    expect(st.dueQuery?.orderBy).toEqual({ nextAttemptAt: "asc" });
  });
});
