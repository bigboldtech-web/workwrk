// claimAiQuestion is claimAiQuestionIn inside one transaction
// (src/lib/ai-allowance.ts): for every case of the plan's cap, the free
// questions per person and the platform's free ceiling, the two give the
// same answer and make the same writes, and claimAiQuestion makes every one
// of them on its transaction, the free day's stamp included, never on the
// client outside it. So a caller that holds its own transaction (an AI
// teammate's monthly limit, src/lib/agents/budget.ts) claims exactly as Ask
// AI does. ai-allowance.test.ts holds the cases themselves.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    plan: "STARTER" as string,
    orgFound: true,
    orgCreatedAt: null as Date | null,
    used: 0,
    personal: 0,
    freeDayOk: true,
    created: [] as Array<Record<string, unknown>>,
    freeDayClaims: [] as string[],
    stamps: {} as Record<string, string>,
    transactions: 0,
    /** Calls made on the client outside a transaction. */
    outside: [] as string[],
  };
  const queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes('INSERT INTO "AiFreeDay"')) {
      state.freeDayClaims.push(String(values[0]));
      return state.freeDayOk ? [{ day: "2026-10-06" }] : [];
    }
    if (sql.includes('"alertedAt"')) return [];
    return state.orgFound ? [{ plan: state.plan, createdAt: state.orgCreatedAt }] : [];
  };
  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes('SET "freeDay"')) state.stamps[String(values[1])] = String(values[0]);
      return 1;
    },
    aIQuery: {
      count: async (a?: { where?: { userId?: string } }) => (a?.where?.userId ? state.personal : state.used),
      create: async (a: { data: Record<string, unknown> }) => {
        state.created.push(a.data);
        return { id: `q${state.created.length}` };
      },
    },
  };
  const outside = (what: string) => async () => {
    state.outside.push(what);
    throw new Error(`${what} outside the transaction`);
  };
  return { state, tx, outside };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: typeof h.tx) => unknown) => {
      h.state.transactions += 1;
      return fn(h.tx);
    },
    $queryRaw: h.outside("$queryRaw"),
    $executeRaw: h.outside("$executeRaw"),
    aIQuery: { count: h.outside("aIQuery.count"), create: h.outside("aIQuery.create") },
  },
}));

import { claimAiQuestion, claimAiQuestionIn } from "./ai-allowance";

type Case = { name: string; set: Partial<Pick<typeof h.state, "plan" | "orgFound" | "orgCreatedAt" | "used" | "personal" | "freeDayOk">> };

const CASES: Case[] = [
  { name: "a free workspace under its total", set: { used: 49 } },
  { name: "a free workspace at its total", set: { used: 50 } },
  { name: "a person at the free questions one person gets", set: { personal: 50 } },
  { name: "free AI past the platform's ceiling for the day", set: { freeDayOk: false } },
  { name: "a free workspace made before the ceiling", set: { orgCreatedAt: new Date("2026-09-01T00:00:00Z"), freeDayOk: false } },
  { name: "a paid workspace", set: { plan: "GROWTH", used: 499, personal: 50, freeDayOk: false } },
  { name: "a paid workspace at its total", set: { plan: "GROWTH", used: 500 } },
  { name: "Enterprise, which has no limit", set: { plan: "ENTERPRISE", used: 250_000 } },
  { name: "a workspace that does not exist", set: { orgFound: false } },
];

function reset(set: Case["set"]): void {
  Object.assign(h.state, {
    plan: "STARTER",
    orgFound: true,
    orgCreatedAt: null,
    used: 0,
    personal: 0,
    freeDayOk: true,
    created: [],
    freeDayClaims: [],
    stamps: {},
    transactions: 0,
    outside: [],
    ...set,
  });
}

function effects() {
  return { created: h.state.created, freeDayClaims: h.state.freeDayClaims, stamps: h.state.stamps };
}

beforeEach(() => reset({}));

describe("claimAiQuestionIn", () => {
  for (const c of CASES) {
    it(`answers and writes exactly as claimAiQuestion: ${c.name}`, async () => {
      reset(c.set);
      const viaClaim = await claimAiQuestion("org", "u1", "Ask AI message");
      const claimEffects = effects();
      expect(h.state.transactions).toBe(1);
      expect(h.state.outside).toEqual([]);

      reset(c.set);
      const viaIn = await claimAiQuestionIn(h.tx as never, "org", "u1", "Ask AI message");
      expect(viaIn).toEqual(viaClaim);
      expect(effects()).toEqual(claimEffects);
      // It opens no transaction of its own: it runs in the caller's.
      expect(h.state.transactions).toBe(0);
      expect(h.state.outside).toEqual([]);
    });
  }

  it("stamps the day whose free use a question took on the same transaction", async () => {
    reset({});
    const r = await claimAiQuestionIn(h.tx as never, "org", "u1", "AI teammate message");
    expect(r).toEqual({ ok: true, id: "q1" });
    expect(h.state.stamps).toEqual({ q1: "2026-10-06" });
  });
});
