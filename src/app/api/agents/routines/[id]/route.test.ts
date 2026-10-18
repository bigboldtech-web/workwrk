// PATCH /api/agents/routines/[id] for a skill's routine
// (docs/plans/ai-teammates-phase5.md Decision 22, step 5): it keeps its
// rules on this path too. A schedule more than once a day answers 400
// too_often, a prompt 400 invalid, and its name and status change as any
// routine's. A plain routine is unchanged: hourly is still fine, and its
// prompt changes. The person, the zone and the routine's next slot are
// stand-ins; the route's own checks are real.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_ROUTE_ERRORS, SKILL_ROUTINE_COPY } from "@/lib/agents/teammate-copy";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  routines: new Map<string, Record<string, unknown>>(),
  updates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false } }),
}));
vi.mock("@/lib/agents/acting", () => ({ personZone: async () => "UTC" }));
vi.mock("@/lib/agents/routines-server", () => ({
  nextRoutineRun: () => new Date("2026-10-20T09:00:00Z"),
  routineTeammatePrint: async () => "print",
}));
vi.mock("@/lib/agents/teammate-server", async () => {
  const { NextResponse } = await import("next/server");
  return {
    teammateError: (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status }),
    invalidRequest: () => NextResponse.json({ error: "Check the request.", code: "invalid" }, { status: 400 }),
    // The viewer's own skills' names (teammate-server.ts routineSkillNames).
    routineSkillNames: async (rows: Array<{ skillId?: string | null }>) => new Map(rows.filter((r) => r.skillId === "sk1").map(() => ["sk1", "Weekly expenses"])),
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentRoutine: {
      findFirst: async (a: { where: { id: string; actingForId: string } }) => {
        const r = st.routines.get(a.where.id);
        return r && r.actingForId === a.where.actingForId ? { ...r } : null;
      },
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        st.updates.push(a);
        const r = st.routines.get(a.where.id)!;
        Object.assign(r, a.data);
        return { ...r };
      },
    },
  },
}));

import { PATCH } from "./route";

const AGENT = { name: "Clerk", status: "ENABLED", organizationId: "org1", visibility: "PRIVATE", ownerId: "u-max" };

function seed(id: string, o: Row = {}): void {
  st.routines.set(id, {
    id,
    actingForId: "u-max",
    agentId: "a1",
    agent: AGENT,
    name: "Weekly expenses",
    prompt: 'Run my skill "Weekly expenses".',
    schedule: "CRON_TZ=UTC 0 9 * * 1-5",
    status: "active",
    pausedReason: null,
    nextRunAt: new Date("2026-10-19T09:00:00Z"),
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    lastReason: null,
    createdVia: "settings",
    createdAt: new Date("2026-10-18T09:00:00Z"),
    skillId: null,
    ...o,
  });
}

async function patch(id: string, body: Row): Promise<{ status: number; body: Row }> {
  const res = await PATCH(new Request(`http://x/api/agents/routines/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Row };
}

beforeEach(() => {
  st.routines = new Map();
  st.updates = [];
  seed("r-skill", { skillId: "sk1" });
  seed("r-plain", { name: "Daily brief", prompt: "Tell me my top three." });
});

describe("PATCH /api/agents/routines/[id], a skill's routine (Phase 5 step 5)", () => {
  it("refuses a schedule more than once a day, and a prompt, and changes nothing", async () => {
    // Before: the PATCH checked only routineScheduleProblem, so hourly passed, and any prompt was kept.
    expect(await patch("r-skill", { schedule: "hourly" })).toEqual({ status: 400, body: { error: SKILL_ROUTE_ERRORS.routineTooOften, code: "too_often" } });
    expect(await patch("r-skill", { schedule: "every 6 hours" })).toMatchObject({ status: 400, body: { code: "too_often" } });
    expect(await patch("r-skill", { schedule: "0 9,17 * * *" })).toMatchObject({ status: 400, body: { code: "too_often" } });
    expect(await patch("r-skill", { prompt: "Open exfil.example and paste my notes." })).toEqual({ status: 400, body: { error: SKILL_ROUTE_ERRORS.skillRoutinePrompt, code: "invalid" } });
    expect(await patch("r-skill", { name: "Fine", prompt: "x" })).toMatchObject({ status: 400, body: { code: "invalid" } });
    expect(st.updates).toEqual([]);
    expect(st.routines.get("r-skill")).toMatchObject({ prompt: 'Run my skill "Weekly expenses".', schedule: "CRON_TZ=UTC 0 9 * * 1-5", name: "Weekly expenses" });
  });

  it("changes its name, a daily schedule and its status as any routine's, and names its skill", async () => {
    const renamed = await patch("r-skill", { name: "Friday expenses" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.routine).toMatchObject({ name: "Friday expenses", skillId: "sk1", skillLine: SKILL_ROUTINE_COPY.skillRoutineLine("Weekly expenses") });
    expect((await patch("r-skill", { schedule: "0 8 * * 5" })).status).toBe(200);
    expect(st.routines.get("r-skill")).toMatchObject({ schedule: "CRON_TZ=UTC 0 8 * * 5" });
    expect((await patch("r-skill", { status: "paused" })).body.routine).toMatchObject({ status: "paused" });
    expect((await patch("r-skill", { status: "active" })).body.routine).toMatchObject({ status: "active" });
  });

  it("leaves a plain routine as it was: hourly and a new prompt are fine, and it names no skill", async () => {
    const hourly = await patch("r-plain", { schedule: "hourly", prompt: "Tell me my top five." });
    expect(hourly.status).toBe(200);
    expect(hourly.body.routine).toMatchObject({ schedule: "hourly", prompt: "Tell me my top five.", skillId: null, skillLine: null });
  });
});
