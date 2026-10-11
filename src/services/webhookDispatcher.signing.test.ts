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
      findMany: async () => st.due,
      updateMany: async () => ({ count: 0 }),
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
    expect(st.deliveries[0].data).toMatchObject({ status: "RETRYING", attemptCount: 1 });
    expect(String(st.deliveries[0].data.responseBody)).toMatch(/^Not sent: /);
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
