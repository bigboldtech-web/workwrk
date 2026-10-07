// Step 3b of docs/plans/ai-teammates.md: a tool never does more than the
// route it mirrors allows, for Ask AI and for AI teammates alike.
//   create_kra    POST /api/kras: kras.create, a job title, its holders seeded
//   create_kpi    POST /api/kpis: kras.create, a parent KRA
//   create_sop    POST /api/sops: sops.create, the plan's SOP limit, the creator
//   create_meeting POST /api/meetings, plus the matrix's "Create meetings":
//                 the creator, and only live people as attendees
// Each test fails without its precheck: the tool used to write the row.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const s = vi.hoisted(() => ({
  allowed: new Set<string>(),
  plan: { allowed: true } as { allowed: true } | { allowed: false; message: string; limit: number; current: number },
  kras: [] as Array<Record<string, unknown>>,
  kpis: [] as Array<Record<string, unknown>>,
  sops: [] as Array<Record<string, unknown>>,
  meetings: [] as Array<Record<string, unknown>>,
  seeded: [] as Array<Record<string, unknown>>,
  attendeeWhere: null as null | Record<string, unknown>,
  activity: [] as Array<Record<string, unknown>>,
  role: { id: "role-ae", title: "Account Executive" } as { id: string; title: string } | null,
  parentKra: { id: "kra-1" } as { id: string } | null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      // The caller's level (callerLevel), read fresh.
      // The caller, by id, anchored here (tools.ts callerLevel), and the inviter's name.
      findUnique: async () => ({ organizationId: "org-1", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null, email: "u1@x.com", firstName: "Una", lastName: "One" }),
      findFirst: async () => legacyLevelRow("MANAGER"),
      // Attendees by email: the test reads the where the tool sends.
      findMany: async (a: { where: Record<string, unknown> }) => {
        s.attendeeWhere = a.where;
        return [{ id: "max", email: "max@x.com" }];
      },
    },
    role: { findFirst: async () => s.role },
    kRA: {
      findFirst: async () => s.parentKra,
      create: async (a: { data: Record<string, unknown> }) => { s.kras.push(a.data); return { id: "kra-new", name: a.data.name, category: null, roleId: a.data.roleId }; },
    },
    kPI: { create: async (a: { data: Record<string, unknown> }) => { s.kpis.push(a.data); return { id: "kpi-new", ...a.data }; } },
    sOP: { create: async (a: { data: Record<string, unknown> }) => { s.sops.push(a.data); return { id: "sop-new", title: a.data.title }; } },
    meeting: { create: async (a: { data: Record<string, unknown> }) => { s.meetings.push(a.data); return { id: "meet-new", title: a.data.title }; } },
    oKR: { create: async (a: { data: Record<string, unknown> }) => ({ id: "okr-new", title: a.data.title, level: a.data.level, status: "ON_TRACK", quarter: null, keyResults: [] }) },
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  hasPermission: async (_s: unknown, module: string, action: string) => s.allowed.has(`${module}.${action}`),
  isOrgAdmin: () => false,
}));
vi.mock("@/lib/plan-limits", () => ({ checkPlanLimit: async () => s.plan }));
vi.mock("@/lib/alignment-assign", () => ({
  seedKraToRoleHolders: async (a: Record<string, unknown>) => { s.seeded.push(a); return { peopleSeeded: 2 }; },
}));
vi.mock("@/lib/alignment-scope", () => ({ goalRightsActor: async () => ({}) }));
vi.mock("@/lib/alignment", () => ({ persistGoalRollupChain: async () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { s.activity.push(a); } }));
vi.mock("@/lib/goals/goal-notify", () => ({ notifyGoalAssigned: async () => {} }));

const { TOOLS, PRECHECK_REFUSALS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "u-1" };

beforeEach(() => {
  s.allowed = new Set(["kras.create", "sops.create", "meetings.create"]);
  s.plan = { allowed: true };
  s.kras = [];
  s.kpis = [];
  s.sops = [];
  s.meetings = [];
  s.seeded = [];
  s.attendeeWhere = null;
  s.activity = [];
  s.role = { id: "role-ae", title: "Account Executive" };
  s.parentKra = { id: "kra-1" };
});

describe("create_kra", () => {
  it("refuses a person without the KRA create permission, and writes nothing", async () => {
    s.allowed.delete("kras.create");
    expect(await TOOLS.create_kra.handler(ctx, { name: "Pipeline health", roleTitle: "Account Executive" })).toEqual({ error: PRECHECK_REFUSALS.kras });
    expect(s.kras).toHaveLength(0);
  });

  it("never makes a KRA outside a job title", async () => {
    expect(await TOOLS.create_kra.handler(ctx, { name: "Pipeline health" })).toEqual({ error: PRECHECK_REFUSALS.kraNeedsRole });
    s.role = null;
    expect(await TOOLS.create_kra.handler(ctx, { name: "Pipeline health", roleTitle: "Astronaut" })).toEqual({ error: "Role 'Astronaut' not found in this org" });
    expect(s.kras).toHaveLength(0);
  });

  it("makes it in the job title and hands it to the title's holders, as the route does", async () => {
    expect(await TOOLS.create_kra.handler(ctx, { name: "Pipeline health", roleTitle: " account executive " })).toMatchObject({ ok: true });
    expect(s.kras[0]).toMatchObject({ organizationId: "org-1", name: "Pipeline health", roleId: "role-ae" });
    expect(s.seeded).toEqual([{ kraId: "kra-new", roleId: "role-ae", organizationId: "org-1" }]);
  });
});

describe("create_kpi", () => {
  it("refuses a person without the KRA create permission, and a KPI with no KRA", async () => {
    s.allowed.delete("kras.create");
    expect(await TOOLS.create_kpi.handler(ctx, { name: "Win rate", kraName: "Pipeline health" })).toEqual({ error: PRECHECK_REFUSALS.kpis });
    s.allowed.add("kras.create");
    expect(await TOOLS.create_kpi.handler(ctx, { name: "Win rate" })).toEqual({ error: PRECHECK_REFUSALS.kpiNeedsKra });
    expect(s.kpis).toHaveLength(0);
  });

  it("makes it under its KRA", async () => {
    expect(await TOOLS.create_kpi.handler(ctx, { name: "Win rate", kraName: "Pipeline health" })).toMatchObject({ ok: true });
    expect(s.kpis[0]).toMatchObject({ organizationId: "org-1", name: "Win rate", kraId: "kra-1" });
  });
});

describe("create_sop", () => {
  it("refuses a person without the SOP create permission", async () => {
    s.allowed.delete("sops.create");
    expect(await TOOLS.create_sop.handler(ctx, { title: "Refunds" })).toEqual({ error: PRECHECK_REFUSALS.sops });
    expect(s.sops).toHaveLength(0);
  });

  it("stops at the plan's SOP limit with the plan's own sentence", async () => {
    s.plan = { allowed: false, message: "You've reached your STARTER plan limit of 10 SOPs. Please upgrade your plan to continue.", limit: 10, current: 10 };
    expect(await TOOLS.create_sop.handler(ctx, { title: "Refunds" })).toEqual({ error: "You've reached your STARTER plan limit of 10 SOPs. Please upgrade your plan to continue." });
    expect(s.sops).toHaveLength(0);
  });

  it("puts the creator on record", async () => {
    expect(await TOOLS.create_sop.handler(ctx, { title: "Refunds" })).toMatchObject({ ok: true });
    expect(s.sops[0]).toMatchObject({ organizationId: "org-1", title: "Refunds", createdById: "u-1" });
  });
});

describe("create_meeting", () => {
  const input = { title: "Weekly sync", scheduledAt: "2026-10-12T14:00:00Z", attendeeEmails: ["max@x.com", "gone@x.com"] };

  it("refuses a person the matrix does not let create meetings", async () => {
    s.allowed.delete("meetings.create");
    expect(await TOOLS.create_meeting.handler(ctx, input)).toEqual({ error: PRECHECK_REFUSALS.meetings });
    expect(s.meetings).toHaveLength(0);
  });

  it("puts the creator on record and adds only live people of the workspace", async () => {
    const r = await TOOLS.create_meeting.handler(ctx, input);
    expect(r).toMatchObject({ ok: true, attendeesAttached: 2, unknownEmails: ["gone@x.com"] });
    expect(s.attendeeWhere).toMatchObject({ organizationId: "org-1", email: { in: ["max@x.com", "gone@x.com"] }, deletedAt: null, status: { not: "INACTIVE" } });
    expect(s.meetings[0]).toMatchObject({ organizationId: "org-1", title: "Weekly sync", type: "ADHOC", duration: 30, createdById: "u-1", attendees: { create: [{ userId: "u-1" }, { userId: "max" }] } });
  });

  it("answers a bad type or time with a sentence instead of a database error", async () => {
    expect(await TOOLS.create_meeting.handler(ctx, { ...input, type: "PARTY" })).toMatchObject({ error: expect.stringContaining("must be one of") });
    expect(await TOOLS.create_meeting.handler(ctx, { ...input, scheduledAt: "soon" })).toEqual({ error: PRECHECK_REFUSALS.meetingTime });
    expect(s.meetings).toHaveLength(0);
  });
});

describe("create_okr", () => {
  it("names what made the goal: Ask AI, or the teammate acting for the person", async () => {
    await TOOLS.create_okr.handler(ctx, { title: "Grow" });
    await TOOLS.create_okr.handler({ ...ctx, teammate: { agentId: "a1", agentName: "Chief of Staff", sessionId: null, routineId: null, trigger: "CHAT", timezone: "UTC" } }, { title: "Grow" });
    expect(s.activity.map((a) => a.description)).toEqual(['Created OKR "Grow" (INDIVIDUAL) with Ask AI', 'Created OKR "Grow" (INDIVIDUAL) with Chief of Staff']);
  });
});
