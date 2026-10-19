// /api/webhooks subscriptions. Docs-found fixes batch 2: the accepted names
// were seven events nothing sends plus task.completed, while three that are
// sent could not be named, and a name outside the list was dropped in
// silence. Now the list is exactly WEBHOOK_EVENTS, a subscription by name
// gets its event, an unknown name is refused out loud, and a stored name
// nothing sends is kept and reported, never dropped.
//
// The final security review (2026-10-19): create took any address that began
// with https://, a private one included (https://10.0.0.5/, https://localhost/,
// a name resolving to 169.254.169.254). Now it takes a public https address
// only, by the check every send makes, and answers anything else 400.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  created: [] as Array<{ events: string[]; secretHash?: string; secretSealed?: unknown }>,
  stored: [] as Array<{ id: string; events: string[]; secretSealed?: unknown }>,
  updated: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  audits: [] as string[],
  secrets: 0,
  /** What each name resolves to here: no lookup leaves the process. */
  dns: new Map<string, string[]>([["hook.test", ["93.184.216.34"]]]),
  dnsCalls: [] as string[],
}));

vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) => {
    st.dnsCalls.push(host);
    const found = st.dns.get(host);
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { lookup, default: { lookup } };
});

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => "u1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/api-auth", () => ({
  generateWebhookSecret: () => {
    st.secrets += 1;
    return { plaintext: `whsec_x${st.secrets}`, prefix: "whsec", hash: `h${st.secrets}` };
  },
}));
vi.mock("@/lib/activity", () => ({ logAuditEvent: (e: { type: string }) => void st.audits.push(e.type) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookSubscription: {
      create: async (a: { data: { events: string[]; url: string; secretHash: string; secretSealed?: unknown } }) => {
        st.created.push({ events: a.data.events, secretHash: a.data.secretHash, secretSealed: a.data.secretSealed });
        return { id: "w1", url: a.data.url, events: a.data.events, status: "ACTIVE", secretPrefix: "whsec", createdAt: new Date() };
      },
      findMany: async () => st.stored.map((s) => ({ secretSealed: null, ...s, url: "https://hook.test", status: "ACTIVE", secretPrefix: "whsec", failureCount: 0, lastSuccessAt: null, lastFailureAt: null, createdAt: new Date(), _count: { deliveries: 0 } })),
      findFirst: async (a: { where: { id: string } }) => (st.stored.some((s) => s.id === a.where.id) ? { id: a.where.id, url: "https://hook.test", secretPrefix: "whsec_old" } : null),
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        st.updated.push(a);
        return { id: a.where.id, url: "https://hook.test", events: ["*"], status: "ACTIVE", secretPrefix: a.data.secretPrefix, createdAt: new Date() };
      },
    },
  },
}));

const savedKey = process.env.SECRETS_ENCRYPTION_KEY;
process.env.SECRETS_ENCRYPTION_KEY = "b".repeat(64);
afterAll(() => {
  if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedKey;
});

import { openToken, sealToken } from "@/lib/connectors/seal";
import { GET, PATCH, POST } from "./route";

const post = (events: unknown) => POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "https://hook.test/in", events }) }) as never);

beforeEach(() => {
  st.created = []; st.stored = []; st.updated = []; st.audits = []; process.env.SECRETS_ENCRYPTION_KEY = "b".repeat(64);
  st.dns = new Map([["hook.test", ["93.184.216.34"]], ["hooks.example.com", ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]], ["inside.example.com", ["10.0.0.5"]], ["mixed.example.com", ["93.184.216.34", "169.254.169.254"]]]);
  st.dnsCalls = [];
});

describe("subscribing", () => {
  it("accepts the events that are sent, by name", async () => {
    const res = await post(["task.status_changed", "task.assignee_changed", "task.field_changed", "task.created"]);
    expect(res.status).toBe(200);
    expect(st.created[0].events).toEqual(["task.status_changed", "task.assignee_changed", "task.field_changed", "task.created"]);
  });

  it("refuses a name nothing sends, out loud, and saves nothing", async () => {
    const res = await post(["task.created", "sop.published"]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Nothing sends this event: sop\.published\. Pick from \*, kudos\.created/);
    expect(st.created).toEqual([]);
  });

  it("takes an https address only, as it says, and keeps it trimmed", async () => {
    for (const url of ["http://hook.test/in", "https://", "ftp://hook.test", "hook.test/in"]) {
      const res = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url }) }) as never);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("A valid https URL is required");
    }
    expect(st.created).toEqual([]);
    const ok = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "  https://hook.test/in  " }) }) as never);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain('"url":"https://hook.test/in"');
  });

  it("refuses an address that is not on the public internet, and saves nothing", async () => {
    const NOT_PUBLIC = "That address is not on the public internet. Webhooks go to a public https address.";
    for (const url of [
      "https://10.0.0.5/h", "https://127.0.0.1:3002/h", "https://169.254.169.254/latest/meta-data", "https://192.168.1.10/h", "https://172.16.0.1/h", "https://100.64.0.1/h",
      "https://[::1]/h", "https://[fd00::1]/h", "https://[fe80::1]/h", "https://[::ffff:127.0.0.1]/h",
      "https://localhost:8443/h", "https://app.localhost/h", "https://intranet/h",
      "https://inside.example.com/h", "https://mixed.example.com/h",
    ]) {
      const res = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url }) }) as never);
      expect(res.status, url).toBe(400);
      expect((await res.json()).error, url).toBe(NOT_PUBLIC);
    }
    expect(st.created).toEqual([]);
  });

  it("refuses a name that resolves to nothing, and an address with a user name or password", async () => {
    const nowhere = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "https://nowhere.example.com/h" }) }) as never);
    expect(nowhere.status).toBe(400);
    expect((await nowhere.json()).error).toBe("That address's name could not be found. Check it: webhooks go to a public https address.");
    const creds = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "https://user:pass@hooks.example.com/h" }) }) as never);
    expect(creds.status).toBe(400);
    expect((await creds.json()).error).toBe("Take the user name and password out of the address. Webhooks go to a public https address without one.");
    expect(st.created).toEqual([]);
  });

  it("takes a public address on any port, every name it resolves to checked", async () => {
    const res = await POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "https://hooks.example.com:8443/in" }) }) as never);
    expect(res.status).toBe(200);
    expect(st.dnsCalls).toEqual(["hooks.example.com"]);
    expect(st.created).toHaveLength(1);
  });

  it("still subscribes to everything when no event is named", async () => {
    await post(undefined);
    expect(st.created[0].events).toEqual(["*"]);
  });
});

describe("listing", () => {
  it("offers exactly the sent events, and keeps and reports a stored name nothing sends", async () => {
    st.stored = [{ id: "old", events: ["task.completed", "kudos.created"] }, { id: "all", events: ["*"] }];
    const body = await (await GET(new Request("https://app.test/api/webhooks") as never)).json();
    expect(body.validEvents).toEqual(["*", "kudos.created", "kpi.recorded", "task.created", "task.status_changed", "task.assignee_changed", "task.field_changed"]);
    expect(body.data.map((s: { id: string; events: string[]; unsentEvents: string[] }) => [s.id, s.events, s.unsentEvents])).toEqual([
      ["old", ["task.completed", "kudos.created"], ["task.completed"]],
      ["all", ["*"], []],
    ]);
  });
});

// Docs-found fixes batch 3: the secret shown here is the key deliveries are
// signed with (src/services/webhookDispatcher.ts), kept sealed. It used to be
// shown with "you'll use it to verify" while deliveries were signed with its
// hash.
describe("the signing secret", () => {
  it("keeps the secret it shows, sealed, and says exactly how to verify with it", async () => {
    const res = await post(["kudos.created"]);
    const body = await res.json();
    expect(body.secret).toMatch(/^whsec_x\d+$/);
    expect(openToken(st.created[0].secretSealed)).toBe(body.secret);
    expect(body.signing).toBe("secret");
    expect(body.message).toMatch(/HMAC-SHA256 with this secret as the key over the timestamp, a full stop and the raw request body \(<timestamp>\.<body>\)/);
    expect(body.message).toMatch(/t=<timestamp>,v1=<signature>/);
  });

  it("makes nothing when the server can't seal a secret", async () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    const res = await post(["kudos.created"]);
    expect(res.status).toBe(503);
    expect(st.created).toEqual([]);
  });

  it("says which key each subscription signs with, and never hands out the sealed secret", async () => {
    st.stored = [{ id: "old", events: ["*"], secretSealed: null }, { id: "new", events: ["*"], secretSealed: sealToken("whsec_kept") }];
    const body = await (await GET(new Request("https://app.test/api/webhooks") as never)).json();
    expect(body.data.map((s: { id: string; signing: string }) => [s.id, s.signing])).toEqual([["old", "legacy_hash"], ["new", "secret"]]);
    expect(body.data[0].signingNote).toMatch(/SHA-256 of its secret.*Rotate its secret/);
    expect(body.data.every((s: Record<string, unknown>) => !("secretSealed" in s) && !("secretHash" in s))).toBe(true);
  });

  // Docs-found fixes batch 4: a sealed secret this server can't open was
  // reported as signing with the secret, while every delivery was held.
  it("says when a subscription's secret can't be opened, that its deliveries are held, and what to do", async () => {
    st.stored = [{ id: "stuck", events: ["*"], secretSealed: { v: 1, iv: "a", ct: "b", tag: "c" } }];
    const body = await (await GET(new Request("https://app.test/api/webhooks") as never)).json();
    expect(body.data[0].signing).toBe("unreadable");
    expect(body.data[0].signingNote).toMatch(/can't open its signing secret right now, so nothing is sent to it\. Its deliveries are held, not lost, and tried again every 15 minutes/);
    expect(body.data[0].signingNote).toMatch(/rotate its secret/);
    expect(body.data[0].signingNote).not.toMatch(/--|\u2014|\u2013/);
  });

  it("rotates a secret: a new one, shown once, sealed, and the subscription signs with it from then on", async () => {
    st.stored = [{ id: "old", events: ["*"], secretSealed: null }];
    const patch = (b: unknown) => PATCH(new Request("https://app.test/api/webhooks", { method: "PATCH", body: JSON.stringify(b) }) as never);
    const res = await patch({ id: "old", rotateSecret: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toMatch(/^whsec_x/);
    expect(st.updated[0].data.secretHash).toMatch(/^h/);
    expect(openToken(st.updated[0].data.secretSealed)).toBe(body.secret);
    expect(body.message).toMatch(/old secret no longer signs anything/);
    expect(st.audits).toContain("webhook_subscription_secret_rotated");
    expect((await patch({ id: "missing", rotateSecret: true })).status).toBe(404);
    expect((await patch({ id: "old" })).status).toBe(400);
  });
});
