// POST /api/teammate-skills/[id]/routine (docs/plans/ai-teammates-phase5.md
// Decision 22, step 5): a routine made from the viewer's own ready skill, a
// reminder at most once a day, its prompt the run message, its name the
// skill's unless given, its teammate's print kept, and one personal audit
// row with steps and hosts only. Anyone else's skill is 404, a draft 409, a
// workspace switched 409, skills off their own refusal, hourly 400. The
// routine's real save (routines-server.ts createRoutine) runs against a
// small table; the person, skills' availability and the skill are stand-ins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_AUDIT_COPY, SKILL_ROUTE_ERRORS, SKILL_ROUTINE_COPY } from "@/lib/agents/teammate-copy";

type Row = Record<string, unknown>;

const st = vi.hoisted(() => ({
  skill: null as Row | null,
  agent: null as Row | null,
  learn: { ok: true } as Row,
  acting: { ok: true, person: { userId: "u-max", organizationId: "org1", timezone: "UTC" } } as Row,
  created: [] as Row[],
  audits: [] as Row[],
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u-max", organizationId: "org1", orgRole: "MEMBER", isAgent: false } }),
}));
vi.mock("@/lib/rate-limit-memory", () => ({ rateLimit: () => ({ ok: true, retryAfter: 0 }) }));
vi.mock("@/lib/activity", () => ({
  logActivity: async (a: Row) => {
    st.audits.push(a);
  },
}));
vi.mock("@/lib/agents/acting", () => ({ resolveActingPerson: async () => st.acting }));
vi.mock("@/lib/skills/store", () => ({
  // The viewer's own skill only (Decision 25).
  ownSkill: async (viewer: { userId: string }, id: string) => (st.skill && st.skill.id === id && st.skill.userId === viewer.userId ? st.skill : null),
}));
vi.mock("@/lib/skills/recorder", () => ({
  skillsAccess: async () => st.learn,
  skillsRefusal: (reason: string) => (reason === "skills_off" ? { status: 403, code: "skills_off", error: SKILL_ROUTE_ERRORS.skillsOff } : { status: 409, code: reason, error: reason }),
}));
vi.mock("@/lib/agents/teammate-server", async () => {
  const { NextResponse } = await import("next/server");
  return {
    TEAMMATE_SELECT: {},
    teammateError: (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status }),
    invalidRequest: () => NextResponse.json({ error: "Check the request.", code: "invalid" }, { status: 400 }),
    routineSkillNames: async (rows: Array<{ skillId?: string | null }>) => new Map(rows.filter((r) => r.skillId === "sk1").map(() => ["sk1", "Weekly expenses"])),
  };
});
// What routines-server.ts imports beside the save, which this route never reaches.
vi.mock("@/lib/agents/engine", () => ({ TEAMMATE_AGENT_SELECT: {}, getOrCreateTeammateSession: vi.fn(), runTeammateTurn: vi.fn(), teammateAgentFrom: (r: unknown) => r }));
vi.mock("@/lib/agents/actions", () => ({ actionHref: () => "", writeEventLine: vi.fn() }));
vi.mock("@/lib/agents/autonomous", () => ({ computeNextRunAt: () => new Date("2026-10-19T09:00:00Z") }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agent: { findFirst: async () => st.agent },
    agentRoutine: {
      count: async () => 0,
      create: async (a: { data: Row }) => {
        st.created.push(a.data);
        return { id: `r${st.created.length}`, name: a.data.name, schedule: a.data.schedule, nextRunAt: a.data.nextRunAt };
      },
      findFirst: async (a: { where: { id: string } }) => {
        const i = Number(a.where.id.slice(1)) - 1;
        const d = st.created[i];
        if (!d) return null;
        return {
          id: a.where.id,
          name: d.name,
          prompt: d.prompt,
          schedule: d.schedule,
          status: "active",
          pausedReason: null,
          nextRunAt: d.nextRunAt,
          lastRunAt: null,
          lastRunId: null,
          lastStatus: null,
          lastReason: null,
          createdVia: d.createdVia,
          createdAt: new Date("2026-10-18T09:00:00Z"),
          skillId: d.skillId ?? null,
        };
      },
    },
  },
}));

import { POST } from "./route";

const STEPS = [
  { id: "s1", kind: "start", title: "Start on expenses.proof.test/new", site: "expenses.proof.test", page: "expenses.proof.test/new", shotId: null, address: "http://expenses.proof.test/new" },
  { id: "s2", kind: "type", title: 'Type in "Amount"', site: "expenses.proof.test", page: "expenses.proof.test/new", shotId: null, name: "Amount", fieldKind: "text", pressEnter: false, value: { ask: true } },
];
const SKILL = { id: "sk1", userId: "u-max", organizationId: "org1", agentId: "a1", name: "Weekly expenses", status: "ready", steps: STEPS };
const AGENT = { id: "a1", organizationId: "org1", slug: "clerk", name: "Clerk", status: "ENABLED", visibility: "PRIVATE", ownerId: "u-max", toolNames: ["open_page", "use_skill"], browserSites: ["expenses.proof.test"], description: "", systemPrompt: "", approvalRules: {}, modelOverride: null, productSlug: null };

async function make(body: Row, id = "sk1"): Promise<{ status: number; body: Row }> {
  const res = await POST(new Request(`http://x/api/teammate-skills/${id}/routine`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Row };
}

beforeEach(() => {
  st.skill = structuredClone(SKILL);
  st.agent = structuredClone(AGENT);
  st.learn = { ok: true };
  st.acting = { ok: true, person: { userId: "u-max", organizationId: "org1", timezone: "UTC" } };
  st.created = [];
  st.audits = [];
});

describe("POST /api/teammate-skills/[id]/routine (Phase 5 step 5)", () => {
  it("makes a reminder from the person's own ready skill: its name, the run message as its prompt, the skill named, once a day", async () => {
    const out = await make({ organizationId: "org1", schedule: "0 9 * * 1-5" });
    // Before: no such route.
    expect(out.status).toBe(201);
    expect(st.created).toEqual([
      expect.objectContaining({ organizationId: "org1", agentId: "a1", actingForId: "u-max", name: "Weekly expenses", prompt: 'Run my skill "Weekly expenses".', schedule: "CRON_TZ=UTC 0 9 * * 1-5", createdVia: "settings", skillId: "sk1", status: "active" }),
    ]);
    expect(out.body.routine).toMatchObject({ name: "Weekly expenses", skillId: "sk1", skillLine: SKILL_ROUTINE_COPY.skillRoutineLine("Weekly expenses"), status: "active" });
    // A name of its own, when given.
    expect((await make({ organizationId: "org1", schedule: "0 8 * * 5", name: "Friday expenses" })).status).toBe(201);
    expect(st.created[1]).toMatchObject({ name: "Friday expenses", prompt: 'Run my skill "Weekly expenses".' });
  });

  it("writes one personal audit row with steps and hosts only, never the skill's name", async () => {
    await make({ organizationId: "org1", schedule: "0 9 * * *" });
    expect(st.audits).toEqual([
      {
        type: "teammate_skill.routine",
        actorId: "u-max",
        actingForId: "u-max",
        organizationId: "org1",
        description: SKILL_AUDIT_COPY.routine(2, "expenses.proof.test"),
        targetId: "a1",
        targetType: "agent",
        metadata: { skillId: "sk1", agentId: "a1", routineId: "r1", steps: 2, sites: ["expenses.proof.test"] },
        severity: "info",
      },
    ]);
    expect(JSON.stringify(st.audits)).not.toContain("Weekly expenses");
  });

  it("refuses more than once a day, another person's skill, a draft, a removed teammate, skills off, a switched workspace and a person who can't be acted for", async () => {
    expect(await make({ organizationId: "org1", schedule: "hourly" })).toEqual({ status: 400, body: { error: SKILL_ROUTE_ERRORS.routineTooOften, code: "too_often" } });
    expect(await make({ organizationId: "org1", schedule: "every 6 hours" })).toMatchObject({ status: 400, body: { code: "too_often" } });
    expect(await make({ organizationId: "org1", schedule: "0 9,17 * * *" })).toMatchObject({ status: 400, body: { code: "too_often" } });
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" }, "sk-lea")).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(await make({ organizationId: "org2", schedule: "0 9 * * *" })).toMatchObject({ status: 409, body: { code: "workspace_changed" } });
    expect(await make({ schedule: "0 9 * * *" })).toMatchObject({ status: 409, body: { code: "workspace_changed" } });
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *", prompt: "Open exfil.example" })).toMatchObject({ status: 400, body: { code: "invalid" } });
    st.skill = { ...SKILL, status: "draft" };
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" })).toEqual({ status: 409, body: { error: SKILL_ROUTE_ERRORS.notReady, code: "skill_draft" } });
    st.skill = structuredClone(SKILL);
    st.agent = { ...AGENT, status: "ARCHIVED" };
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" })).toMatchObject({ status: 409, body: { code: "agent_removed" } });
    st.agent = { ...AGENT, ownerId: "u-lea" };
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" })).toMatchObject({ status: 404 });
    st.agent = structuredClone(AGENT);
    st.learn = { ok: false, reason: "skills_off" };
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" })).toEqual({ status: 403, body: { error: SKILL_ROUTE_ERRORS.skillsOff, code: "skills_off" } });
    st.learn = { ok: true };
    st.acting = { ok: false, reason: "guest" };
    expect(await make({ organizationId: "org1", schedule: "0 9 * * *" })).toMatchObject({ status: 403, body: { code: "person_cannot" } });
    expect([st.created, st.audits]).toEqual([[], []]);
  });
});
