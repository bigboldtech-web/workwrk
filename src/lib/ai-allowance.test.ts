// The plan's AI questions (src/lib/ai-allowance.ts): the cap, the claim
// handed back only when the model call fails, the per-person limit, the
// automatic calls that never spend a question but take one of the day's
// automatic uses, and Enterprise's no limit.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { orgCreatedAt: null as Date | null, freeDayReleases: [] as string[], today: "2026-10-06", stamps: {} as Record<string, string>, autoReleases: 0, freeDayOk: true, freeDayClaims: [] as string[], personal: 0, plan: "STARTER" as string | null, used: 0, created: [] as Array<Record<string, unknown>>, deleted: [] as string[], orgFound: true, autoAnswer: "ok" as "ok" | "limit" | "not_ready", autoClaims: [] as Array<{ org: string; kind: string; cap: number }> };

vi.mock("@/lib/ai-usage", () => ({
  claimAiUse: async (org: string, kind: string, cap: number) => {
    state.autoClaims.push({ org, kind, cap });
    return state.autoAnswer;
  },
  releaseAiUse: async () => {
    state.autoReleases += 1;
  },
}));

vi.mock("@/lib/prisma", () => {
  const aIQuery = {
    // A count with a userId is the person's free questions across free
    // workspaces; without, the workspace's own.
    count: async (a?: { where?: { userId?: string } }) => (a?.where?.userId ? state.personal : state.used),
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
  // The org row lock, or (a template with "AiFreeDay") the free day claim.
  const queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes('INSERT INTO "AiFreeDay"')) {
      state.freeDayClaims.push(String(values[0]));
      return state.freeDayOk ? [{ day: state.today }] : [];
    }
    if (sql.includes('"count" = "count" - 1')) {
      // kind, then the day it gives back to.
      state.freeDayReleases.push(`${String(values[0])} ${String(values[1])}`);
      return [{ count: 0 }];
    }
    if (sql.includes('"alertedAt"')) return [];
    if (sql.includes('DELETE FROM "AIQuery"')) {
      // The row's own freeDay: the day the claim stamped on it, if any.
      const id = String(values[0]);
      state.deleted.push(id);
      return [{ freeDay: state.stamps[id] ?? null }];
    }
    return state.orgFound ? [{ plan: state.plan, createdAt: state.orgCreatedAt }] : [];
  };
  // The claim stamping the day whose use a question took.
  const executeRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("?").includes('SET "freeDay"')) state.stamps[String(values[1])] = String(values[0]);
    return 1;
  };
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    aIQuery,
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      $queryRaw: queryRaw,
      aIQuery,
      organization: { findUnique: async () => (state.orgFound ? { plan: state.plan, createdAt: state.orgCreatedAt } : null) },
    },
  };
});

import { AI_ACTIONS_PER_MINUTE, AI_AUTO_PER_DAY, AI_AUTO_PER_MINUTE, aiAutoAllowed, callOrGiveBack, claimAiAction, claimAiQuestion, releaseAiQuestion } from "./ai-allowance";

beforeEach(() => {
  state.plan = "STARTER";
  state.used = 0;
  state.created = [];
  state.deleted = [];
  state.orgFound = true;
  state.autoAnswer = "ok";
  state.autoClaims = [];
  state.personal = 0;
  state.freeDayOk = true;
  state.freeDayClaims = [];
  state.freeDayReleases = [];
  state.stamps = {};
  state.today = "2026-10-06";
  state.autoReleases = 0;
  state.orgCreatedAt = null;
});

describe("claimAiQuestion", () => {
  it("claims a question while the workspace is under its plan's total", async () => {
    state.used = 49;
    const r = await claimAiQuestion("org", "u1", "Summarize a doc");
    expect(r.ok).toBe(true);
    expect(state.created).toEqual([{ query: "Summarize a doc", userId: "u1", organizationId: "org", freeTier: true }]);
    expect(state.freeDayClaims).toEqual(["question"]);
    // The day whose use it took is on the row.
    expect(state.stamps).toEqual({ q1: "2026-10-06" });
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

  it("refuses a person who has used the free questions one person gets across free workspaces, though this one has room", async () => {
    state.used = 3;
    state.personal = 50;
    const r = await claimAiQuestion("org-new", "u-farm", "Ask AI message");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/one person gets across free workspaces/);
    expect(state.created).toEqual([]);
  });

  it("refuses free AI past the platform's ceiling for the day, and writes nothing", async () => {
    state.freeDayOk = false;
    const r = await claimAiQuestion("org", "u-late", "Ask AI message");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/reached its limit for today across WorkwrK/);
    expect(state.created).toEqual([]);
  });

  it("never takes the free ceiling in a free workspace made before it", async () => {
    state.orgCreatedAt = new Date("2026-09-01T00:00:00Z");
    state.freeDayOk = false;
    expect((await claimAiQuestion("org-old", "u-old", "x")).ok).toBe(true);
    expect(state.freeDayClaims).toEqual([]);
    expect(state.stamps).toEqual({});
  });

  it("gives the ceiling's use back with a free question handed back, to the day it was taken from", async () => {
    const r = await claimAiQuestion("org", "u1", "x");
    expect(r.ok).toBe(true);
    // The call fails after midnight UTC: the use goes back to the day it came from.
    state.today = "2026-10-07";
    if (r.ok) await releaseAiQuestion(r.id);
    expect(state.freeDayReleases).toEqual(["question 2026-10-06"]);
  });

  it("gives nothing back for a question that took no use: one from a free workspace made before the ceiling, or a paid one", async () => {
    // Before: every failed question in an older free workspace lowered the
    // count new workspaces are held to, so the ceiling could be emptied.
    state.orgCreatedAt = new Date("2026-09-01T00:00:00Z");
    const old = await claimAiQuestion("org-old", "u-old", "x");
    if (old.ok) await releaseAiQuestion(old.id);
    state.orgCreatedAt = null;
    state.plan = "GROWTH";
    const paid = await claimAiQuestion("org-paid", "u-paid", "x");
    if (paid.ok) await releaseAiQuestion(paid.id);
    expect(old.ok && paid.ok).toBe(true);
    expect(state.deleted).toHaveLength(2);
    expect(state.freeDayReleases).toEqual([]);
  });

  it("never takes the free ceiling in a paid workspace", async () => {
    state.plan = "GROWTH";
    state.freeDayOk = false;
    expect((await claimAiQuestion("org", "u-paid2", "x")).ok).toBe(true);
    expect(state.freeDayClaims).toEqual([]);
  });

  it("does not count the person's free questions in a paid workspace", async () => {
    state.plan = "GROWTH";
    state.personal = 50;
    expect((await claimAiQuestion("org", "u-paid", "x")).ok).toBe(true);
  });

  it("never refuses Enterprise, whose 99,999 means no limit, and still records the question", async () => {
    state.plan = "ENTERPRISE";
    state.used = 250_000;
    const r = await claimAiQuestion("org", "u1", "Agent run");
    expect(r.ok).toBe(true);
    expect(state.created).toHaveLength(1);
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
  it("runs while the workspace has questions left, never spends one, and takes one of the day's automatic uses", async () => {
    state.used = 49;
    expect(await aiAutoAllowed("org", "auto-1")).toBe(true);
    expect(state.created).toEqual([]);
    expect(state.autoClaims).toEqual([{ org: "org", kind: "auto", cap: AI_AUTO_PER_DAY.STARTER }]);
  });

  it("stops at the day's total of automatic calls, and when the day's table is missing", async () => {
    state.autoAnswer = "limit";
    expect(await aiAutoAllowed("org", "auto-5")).toBe(false);
    state.autoAnswer = "not_ready";
    expect(await aiAutoAllowed("org", "auto-5")).toBe(false);
  });

  it("takes the workspace's daily use first, and gives it back when the free ceiling refuses", async () => {
    state.freeDayOk = false;
    expect(await aiAutoAllowed("org", "auto-8")).toBe(false);
    expect(state.autoClaims).toHaveLength(1);
    expect(state.autoReleases).toBe(1);
  });

  it("takes nothing of the day on a workspace's own key (BYOK): it pays for its own calls", async () => {
    state.plan = "ENTERPRISE";
    expect(await aiAutoAllowed("org", "auto-7", "byok")).toBe(true);
    expect(state.autoClaims).toEqual([]);
  });

  it("uses the plan's daily total, and runs for Enterprise however many questions it has used", async () => {
    state.plan = "ENTERPRISE";
    state.used = 250_000;
    expect(await aiAutoAllowed("org", "auto-6")).toBe(true);
    expect(state.autoClaims).toEqual([{ org: "org", kind: "auto", cap: AI_AUTO_PER_DAY.ENTERPRISE }]);
  });

  it("stops at the total, before taking any of the day", async () => {
    state.used = 50;
    expect(await aiAutoAllowed("org", "auto-2")).toBe(false);
    expect(state.autoClaims).toEqual([]);
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
