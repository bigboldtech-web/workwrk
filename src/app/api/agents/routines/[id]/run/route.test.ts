// POST /api/agents/routines/[id]/run: each refusal runRoutine can give reads
// as its own answer, never as "you can't be acted for" unless that is why,
// and a teammate changed since its person chose it pauses the routine, so
// the tab offers Resume (review round 11). runRoutine is a stand-in here;
// routines-server.test.ts proves its checks.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineReason } from "@/lib/agents/routines";

const st = vi.hoisted(() => ({
  result: null as unknown,
  paused: [] as Array<{ id: string; reason: string }>,
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-ola", organizationId: "org1" } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRoutine: {
      findFirst: async (a: { where: { id: string; actingForId: string } }) =>
        a.where.id === "r1" && a.where.actingForId === "u-ola" ? { id: "r1", organizationId: "org1", agentId: "a1", actingForId: "u-ola", name: "Daily brief" } : null,
    },
  },
}));
vi.mock("@/lib/agents/routines-server", () => ({
  ROUTINE_RUN_SELECT: {},
  runRoutine: async () => st.result,
  pauseRoutine: async (r: { id: string }, reason: string) => {
    st.paused.push({ id: r.id, reason });
    return true;
  },
}));

import { POST } from "./route";
import { ROUTINE_REASON_TEXT } from "@/lib/agents/routines";

async function run(id = "r1"): Promise<{ status: number; body: { code?: string; error?: string } }> {
  const res = await POST(new Request(`http://x/api/agents/routines/${id}/run`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } };
}

const refused = (reason: RoutineReason | "rate_limited", pause: boolean) => ({ ok: false, reason, message: reason === "rate_limited" ? "Too many at once." : ROUTINE_REASON_TEXT[reason], pause, retryAfter: 30 });

beforeEach(() => {
  st.result = null;
  st.paused = [];
});

describe("POST /api/agents/routines/[id]/run", () => {
  it("answers each refusal runRoutine gives as its own code", async () => {
    const cases: Array<[RoutineReason | "rate_limited", boolean, number, string]> = [
      ["rate_limited", false, 429, "rate_limited"],
      ["agent_removed", true, 409, "agent_removed"],
      ["agent_paused", false, 409, "agent_paused"],
      ["not_configured", false, 503, "not_configured"],
      ["agent_cap", false, 403, "agent_cap"],
      ["out_of_questions", true, 403, "ai_limit"],
      ["person_free_used", true, 403, "ai_limit"],
      ["free_ai_day", false, 403, "ai_limit"],
      ["no_access", true, 404, "not_found"],
      ["ai_off", false, 403, "app_off"],
      ["teammate_changed", true, 409, "teammate_changed"],
      // Only these say the person can't be acted for: it is why.
      ["person_gone", true, 403, "person_cannot"],
      ["guest", true, 403, "person_cannot"],
      ["agent_account", true, 403, "person_cannot"],
    ];
    for (const [reason, pause, status, code] of cases) {
      st.result = refused(reason, pause);
      const r = await run();
      expect([reason, r.status, r.body.code]).toEqual([reason, status, code]);
    }
  });

  it("pauses the routine when its teammate changed, with the reason's own sentence, and on nothing else", async () => {
    st.result = refused("teammate_changed", true);
    const r = await run();
    expect(r.body.error).toBe(ROUTINE_REASON_TEXT.teammate_changed);
    expect(st.paused).toEqual([{ id: "r1", reason: "teammate_changed" }]);
    st.paused = [];
    for (const reason of ["agent_removed", "out_of_questions", "person_gone"] as const) {
      st.result = refused(reason, true);
      await run();
    }
    expect(st.paused).toEqual([]);
  });

  it("answers a run that started with its run, and anyone else's routine as missing", async () => {
    st.result = { ok: true, runId: "run1", status: "SUCCEEDED", messageId: "m1" };
    expect(await run()).toEqual({ status: 200, body: { runId: "run1", status: "SUCCEEDED", messageId: "m1" } });
    expect((await run("r-max")).status).toBe(404);
  });
});
