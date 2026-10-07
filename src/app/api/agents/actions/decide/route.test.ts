// POST /api/agents/actions/decide (docs/plans/ai-teammates.md 3.7 and 4):
// only the person a request acts for decides it, and anyone else's id, an
// Admin's attempt included, answers not_found and runs nothing; one request
// carries 1 to 50 decisions; and one person sends at most 60 a minute. The
// queue is the real actions.ts over the shared queue double (test-fixtures.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/test-fixtures")).prismaFake }));
vi.mock("@/lib/agents/acting", async () => (await import("@/lib/agents/test-fixtures")).actingFake);
vi.mock("@/lib/agents/previews", async () => ({ prepareCall: (await import("@/lib/agents/test-fixtures")).fakePrepareCall }));
vi.mock("@/lib/agents/tools", async () => ({ TOOLS: (await import("@/lib/agents/test-fixtures")).fakeTools() }));
vi.mock("@/lib/activity", async () => ({ logActivity: (await import("@/lib/agents/test-fixtures")).fakeLogActivity }));
vi.mock("@/lib/entitlements", async () => ({ isModuleActive: (await import("@/lib/agents/test-fixtures")).fakeIsModuleActive }));

const gate = vi.hoisted(() => ({ viewer: null as unknown }));
vi.mock("@/lib/app-gate", () => ({ requireApp: async () => ({ viewer: gate.viewer }), isOwnerOrAdmin: () => false }));

import { POST } from "./route";
import { VIEWER, fx, resetFixtures, seedAction } from "@/lib/agents/test-fixtures";

function decide(body: unknown) {
  return POST(new Request("http://x/api/agents/actions/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

function talkPost(actingForId: string) {
  return seedAction({
    toolName: "post_in_talk",
    actingForId,
    input: { conversationId: "c1", text: "Hello team" },
    preview: { title: "Post in #general" },
    targetKey: "conv:c1",
  });
}

beforeEach(() => {
  resetFixtures();
  gate.viewer = VIEWER;
  fx.answers.post_in_talk = { ok: true, message: { id: "msg1", conversationId: "c1" }, conversation: { name: "#general", type: "CHANNEL" } };
  fx.cards.post_in_talk = { title: "Post in #general" };
});

describe("POST /api/agents/actions/decide: whose request it is", () => {
  it("answers another person's request exactly like a missing one, an Admin's attempt included, and runs nothing", async () => {
    const max = talkPost("u-max");
    for (const viewer of [VIEWER, { ...VIEWER, userId: "u-admin", orgRole: "ADMIN" }, { ...VIEWER, userId: "u-owner", orgRole: "OWNER" }]) {
      gate.viewer = viewer;
      const res = await decide({ decisions: [{ id: max.id, decision: "approve" }, { id: "no-such-request", decision: "deny" }] });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        results: [
          { id: max.id, status: "not_found" },
          { id: "no-such-request", status: "not_found" },
        ],
        resume: false,
        agentSlug: null,
        chat: null,
      });
    }
    expect(fx.actions[0].status).toBe("PENDING");
    expect(fx.handlerCalls).toEqual([]);
    expect(fx.messages).toEqual([]);
  });

  it("runs the person's own request, once", async () => {
    const mine = talkPost(VIEWER.userId);
    const res = await decide({ decisions: [{ id: mine.id, decision: "approve" }] });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ id: mine.id, status: "EXECUTED" });
    expect(body.resume).toBe(true);
    const again = await decide({ decisions: [{ id: mine.id, decision: "approve" }] });
    expect((await again.json()).results).toEqual([{ id: mine.id, status: "EXECUTED", code: "already_decided" }]);
    expect(fx.handlerCalls.filter((c) => c.tool === "post_in_talk")).toHaveLength(1);
  });

  it("takes 1 to 50 decisions in one request", async () => {
    for (const decisions of [[], Array.from({ length: 51 }, (_, i) => ({ id: `a${i}`, decision: "deny" }))]) {
      const res = await decide({ decisions });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Check the details and try again.", code: "invalid" });
    }
    expect((await decide({ decisions: [{ id: "x", decision: "maybe" }] })).status).toBe(400);
  });
});

describe("POST /api/agents/actions/decide: 60 a minute per person", () => {
  it("refuses the 61st request in a minute with its sentence and Retry-After, and holds back no one else", async () => {
    gate.viewer = { ...VIEWER, userId: "u-quick" };
    for (let i = 0; i < 60; i += 1) {
      expect((await decide({ decisions: [{ id: `none-${i}`, decision: "deny" }] })).status).toBe(200);
    }
    const refused = await decide({ decisions: [{ id: "one-more", decision: "deny" }] });
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({ error: `Too many decisions at once. Try again in ${retryAfter} seconds.`, code: "rate_limited" });

    gate.viewer = { ...VIEWER, userId: "u-calm" };
    expect((await decide({ decisions: [{ id: "x", decision: "deny" }] })).status).toBe(200);
  });
});
