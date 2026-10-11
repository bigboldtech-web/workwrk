// /api/webhooks subscriptions. Docs-found fixes batch 2: the accepted names
// were seven events nothing sends plus task.completed, while three that are
// sent could not be named, and a name outside the list was dropped in
// silence. Now the list is exactly WEBHOOK_EVENTS, a subscription by name
// gets its event, an unknown name is refused out loud, and a stored name
// nothing sends is kept and reported, never dropped.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ created: [] as Array<{ events: string[] }>, stored: [] as Array<{ id: string; events: string[] }> }));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => "u1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true }) }));
vi.mock("@/lib/api-auth", () => ({ generateWebhookSecret: () => ({ plaintext: "whsec_x", prefix: "whsec", hash: "h" }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: () => undefined }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookSubscription: {
      create: async (a: { data: { events: string[]; url: string } }) => {
        st.created.push({ events: a.data.events });
        return { id: "w1", url: a.data.url, events: a.data.events, status: "ACTIVE", secretPrefix: "whsec", createdAt: new Date() };
      },
      findMany: async () => st.stored.map((s) => ({ ...s, url: "https://hook.test", status: "ACTIVE", secretPrefix: "whsec", failureCount: 0, lastSuccessAt: null, lastFailureAt: null, createdAt: new Date(), _count: { deliveries: 0 } })),
    },
  },
}));

import { GET, POST } from "./route";

const post = (events: unknown) => POST(new Request("https://app.test/api/webhooks", { method: "POST", body: JSON.stringify({ url: "https://hook.test/in", events }) }) as never);

beforeEach(() => { st.created = []; st.stored = []; });

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
