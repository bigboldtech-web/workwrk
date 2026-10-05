// The plan's AI questions (src/lib/ai-allowance.ts): the cap, the claim
// handed back only when the model call fails, the per-person limit, and the
// automatic calls that never spend a question.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { plan: "STARTER" as string | null, used: 0, created: [] as Array<Record<string, unknown>>, deleted: [] as string[], orgFound: true };

vi.mock("@/lib/prisma", () => {
  const aIQuery = {
    count: async () => state.used,
    create: async (a: { data: Record<string, unknown> }) => {
      state.created.push(a.data);
      state.used += 1;
      return { id: `q${state.created.length}` };
    },
    deleteMany: async (a: { where: { id: string } }) => {
      state.deleted.push(a.where.id);
      return { count: 1 };
    },
    updateMany: async () => ({ count: 1 }),
  };
  const tx = {
    $queryRaw: async () => (state.orgFound ? [{ plan: state.plan }] : []),
    aIQuery,
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      aIQuery,
      organization: { findUnique: async () => (state.orgFound ? { plan: state.plan } : null) },
    },
  };
});

import { AI_ACTIONS_PER_MINUTE, AI_AUTO_PER_MINUTE, aiAutoAllowed, callOrGiveBack, claimAiAction, claimAiQuestion } from "./ai-allowance";

beforeEach(() => {
  state.plan = "STARTER";
  state.used = 0;
  state.created = [];
  state.deleted = [];
  state.orgFound = true;
});

describe("claimAiQuestion", () => {
  it("claims a question while the workspace is under its plan's total", async () => {
    state.used = 49;
    const r = await claimAiQuestion("org", "u1", "Summarize a doc");
    expect(r.ok).toBe(true);
    expect(state.created).toEqual([{ query: "Summarize a doc", userId: "u1", organizationId: "org" }]);
  });

  it("refuses at the total, writes nothing, and says what to do", async () => {
    state.used = 50;
    const r = await claimAiQuestion("org", "u1", "Ask AI message");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe(50);
      expect(r.message).toBe("This workspace has used all 50 AI questions on the Starter plan. An Owner or Admin can change the plan in Settings, Plan & billing.");
    }
    expect(state.created).toEqual([]);
  });

  it("uses the plan's own total, and Starter's for an unknown plan", async () => {
    state.plan = "GROWTH";
    state.used = 499;
    expect((await claimAiQuestion("org", "u1", "x")).ok).toBe(true);
    expect((await claimAiQuestion("org", "u1", "x")).ok).toBe(false);
    state.plan = "MYSTERY";
    state.used = 50;
    expect((await claimAiQuestion("org", "u1", "x")).ok).toBe(false);
  });

  it("refuses a workspace that does not exist", async () => {
    state.orgFound = false;
    expect((await claimAiQuestion("gone", "u1", "x")).ok).toBe(false);
  });
});

describe("callOrGiveBack", () => {
  it("keeps the question when the call answers, even with an unusable answer", async () => {
    const out = await callOrGiveBack("q1", async () => "not json at all");
    expect(out).toBe("not json at all");
    expect(state.deleted).toEqual([]);
  });

  it("hands the question back when the call fails, and rethrows", async () => {
    await expect(callOrGiveBack("q7", async () => { throw new Error("overloaded"); })).rejects.toThrow("overloaded");
    expect(state.deleted).toEqual(["q7"]);
  });
});

describe("claimAiAction", () => {
  it("answers 403 ai_limit with the plan sentence at the total", async () => {
    state.used = 50;
    const r = await claimAiAction("org", "person-cap", "Generate a form");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ error: expect.stringMatching(/used all 50 AI questions/), code: "ai_limit" });
    }
  });

  it("holds one person to the per-minute limit before anything is claimed", async () => {
    state.plan = "ENTERPRISE";
    for (let i = 0; i < AI_ACTIONS_PER_MINUTE; i++) expect((await claimAiAction("org", "person-busy", "x")).ok).toBe(true);
    const before = state.created.length;
    const r = await claimAiAction("org", "person-busy", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(429);
      expect(r.response.headers.get("Retry-After")).toMatch(/^\d+$/);
      expect((await r.response.json()).code).toBe("rate_limited");
    }
    expect(state.created.length).toBe(before);
    // Someone else in the same workspace is not held back.
    expect((await claimAiAction("org", "person-calm", "x")).ok).toBe(true);
  });
});

describe("aiAutoAllowed", () => {
  it("runs while the workspace has questions left, and never spends one", async () => {
    state.used = 49;
    expect(await aiAutoAllowed("org", "auto-1")).toBe(true);
    expect(state.created).toEqual([]);
  });

  it("stops at the total", async () => {
    state.used = 50;
    expect(await aiAutoAllowed("org", "auto-2")).toBe(false);
  });

  it("stops past the person's per-minute limit", async () => {
    for (let i = 0; i < AI_AUTO_PER_MINUTE; i++) expect(await aiAutoAllowed("org", "auto-3")).toBe(true);
    expect(await aiAutoAllowed("org", "auto-3")).toBe(false);
  });

  it("stops for a workspace that does not exist", async () => {
    state.orgFound = false;
    expect(await aiAutoAllowed("gone", "auto-4")).toBe(false);
  });
});
