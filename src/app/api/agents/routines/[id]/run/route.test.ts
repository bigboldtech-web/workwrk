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
  runs: 0,
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-ola", organizationId: "org1" } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRoutine: {
      findFirst: async (a: { where: { id: string; actingForId: string } }) =>
        a.where.actingForId !== "u-ola"
          ? null
          : a.where.id === "r1"
            ? { id: "r1", organizationId: "org1", agentId: "a1", actingForId: "u-ola", name: "Daily brief", skillId: null }
            : // A skill's routine (Phase 5 step 5), and one whose skill is another person's.
              a.where.id === "r-skill" || a.where.id === "r-other"
              ? { id: a.where.id, organizationId: "org1", agentId: "a1", actingForId: "u-ola", name: "Weekly expenses", skillId: a.where.id === "r-skill" ? "sk1" : "sk-lea" }
              : null,
    },
    agent: { findFirst: async (a: { where: { id: string } }) => (a.where.id === "a1" ? { slug: "clerk" } : null) },
    teammateSkill: {
      findFirst: async (a: { where: { id: string; userId: string } }) => (a.where.id === "sk1" && a.where.userId === "u-ola" ? { id: "sk1", name: "Weekly expenses" } : null),
    },
  },
}));
vi.mock("@/lib/agents/routines-server", () => ({
  ROUTINE_RUN_SELECT: {},
  runRoutine: async () => {
    st.runs += 1;
    return st.result;
  },
  pauseRoutine: async (r: { id: string }, reason: string) => {
    st.paused.push({ id: r.id, reason });
    return true;
  },
}));

import { POST } from "./route";
import { SKILL_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { ROUTINE_REASON_TEXT } from "@/lib/agents/routines";

async function run(id = "r1"): Promise<{ status: number; body: { code?: string; error?: string } }> {
  const res = await POST(new Request(`http://x/api/agents/routines/${id}/run`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { code?: string; error?: string } };
}

const refused = (reason: RoutineReason | "rate_limited", pause: boolean) => ({ ok: false, reason, message: reason === "rate_limited" ? "Too many at once." : ROUTINE_REASON_TEXT[reason], pause, retryAfter: 30 });

beforeEach(() => {
  st.result = null;
  st.paused = [];
  st.runs = 0;
});

describe("POST /api/agents/routines/[id]/run", () => {
  it("answers every reason as itself: only the person's own say they can't be acted for (review round 12)", async () => {
    const person = new Set(["person_gone", "guest", "agent_account"]);
    for (const reason of Object.keys(ROUTINE_REASON_TEXT) as RoutineReason[]) {
      st.result = refused(reason, true);
      const r = await run();
      expect([reason, r.body.code === "person_cannot"]).toEqual([reason, person.has(reason)]);
      if (!person.has(reason) && r.body.code !== "ai_limit" && r.body.code !== "app_off" && r.body.code !== "not_found") expect(r.body.error).toBe(ROUTINE_REASON_TEXT[reason]);
    }
  });

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

  it("never runs a skill's routine: Run now and Practice run answer 409 skill_routine with the skill to start in the chat (Phase 5 step 5)", async () => {
    st.result = { ok: true, runId: "run1", status: "SUCCEEDED", messageId: "m1" };
    for (const body of ["{}", JSON.stringify({ practice: true })]) {
      const res = await POST(new Request("http://x/api/agents/routines/r-skill/run", { method: "POST", body }), { params: Promise.resolve({ id: "r-skill" }) });
      const start = { slug: "clerk", skillId: "sk1", name: "Weekly expenses" };
      // Before: it ran the routine's prompt as a ROUTINE turn, which has no browser and spends an AI question.
      expect([res.status, await res.json()]).toEqual([409, { error: SKILL_ROUTE_ERRORS.skillRoutine, code: "skill_routine", start, issues: { start } }]);
    }
    expect(st.runs).toBe(0);
    // A skill that is not the viewer's own names nothing.
    expect((await run("r-other")).status).toBe(404);
    expect(st.runs).toBe(0);
  });

  it("answers a run that started with its run, and anyone else's routine as missing", async () => {
    st.result = { ok: true, runId: "run1", status: "SUCCEEDED", messageId: "m1" };
    expect(await run()).toEqual({ status: 200, body: { runId: "run1", status: "SUCCEEDED", messageId: "m1" } });
    expect((await run("r-max")).status).toBe(404);
  });
});
