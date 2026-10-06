// GET and POST /api/agents/teammates (docs/plans/ai-teammates.md 4): who may
// make which teammate, the plan's limits (the person's own private ones; the
// workspace's ones made as teammates, never the agents it already had), what
// a new teammate stores, and a list that never shows another person's
// private teammate. The database is the routes' in-memory double.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/teammate-route-fixtures")).routeDb }));
vi.mock("@/lib/app-gate", async () => (await import("@/lib/agents/teammate-route-fixtures")).appGateFake);
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));
vi.mock("@/lib/agents/actions", () => ({ waitingCount: async () => 0 }));
vi.mock("@/lib/agents/budget", () => ({ agentMonthUsage: async () => ({ used: 0, monthStart: new Date("2026-10-01T00:00:00Z") }) }));
const audits: Array<{ action: string; agent: { slug: string } }> = [];
vi.mock("@/lib/agents/audit", () => ({ auditAgent: async (a: { action: string; agent: { slug: string } }) => void audits.push(a) }));

import { GET, POST } from "./route";
import { PEOPLE, db, jsonRequest, resetRouteDb, routeDb, seedAgent } from "@/lib/agents/teammate-route-fixtures";

function create(body: Record<string, unknown>) {
  return POST(jsonRequest("POST", { name: "Weekly reporter", hue: "teal", job: "Writes my weekly status.", instructions: "Be brief.", toolNames: ["search_tasks"], visibility: "PRIVATE", ...body }));
}

async function list(query = "") {
  const res = await GET(new Request(`http://x/api/agents/teammates${query}`));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  resetRouteDb();
  audits.length = 0;
});

describe("POST /api/agents/teammates: who may make which", () => {
  it("lets a member make a private teammate of their own, stored as one", async () => {
    db.viewer = PEOPLE.max;
    const res = await create({
      toolNames: ["search_tasks", "create_contract", "not_a_tool", "post_in_talk", "search_tasks"],
      agentRules: { create_task: "ask", post_in_talk: "always" },
      personRules: { send_kudos: "always", "post_in_talk:conv:c1": "always", invite_person_with_role: "always", create_task: "ask" },
    });
    expect(res.status).toBe(201);
    const { teammate } = await res.json();
    expect(teammate).toMatchObject({ name: "Weekly reporter", visibility: "PRIVATE", hue: "teal", canManage: true, legacy: false, waiting: 0, unread: false });
    expect(teammate.slug).toMatch(/^t-weekly-reporter-[a-z0-9]{6}$/);
    const row = db.agents.find((a) => a.slug === teammate.slug);
    // Real tools only, none excluded from teammates, each once, sorted.
    expect(row).toMatchObject({ ownerId: "u-max", createdById: "u-max", toolNames: ["post_in_talk", "search_tasks"], approvalRules: { create_task: "ask" } });
    // The person's own choices: never "Don't ask" for invitations, and a
    // conversation's "Don't ask" only ever from an approval card.
    expect(db.settings).toEqual([expect.objectContaining({ agentId: row?.id, userId: "u-max", approvalRules: { send_kudos: "always", create_task: "ask" } })]);
    expect(audits.map((a) => a.action)).toEqual(["added"]);
  });

  it("refuses a member a workspace teammate, and lets an Admin and the Owner make one", async () => {
    db.viewer = PEOPLE.max;
    const refused = await create({ visibility: "WORKSPACE" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only an Owner or Admin can make a teammate for the whole workspace.", code: "needs_admin" });
    expect(routeDb.writes).toEqual([]);

    db.viewer = PEOPLE.admin;
    const byAdmin = await create({ visibility: "WORKSPACE", name: "Status Reporter" });
    expect(byAdmin.status).toBe(201);
    expect(db.agents.find((a) => a.slug === "status-reporter")).toMatchObject({ visibility: "WORKSPACE", ownerId: null });

    db.viewer = PEOPLE.owner;
    const byOwner = await create({ visibility: "WORKSPACE", name: "Status Reporter" });
    expect(byOwner.status).toBe(201);
    // The same name again is bumped, as a custom agent's slug is.
    expect((await byOwner.json()).teammate.slug).toBe("status-reporter-2");
  });

  it("refuses an agent account, and answers a Guest with the gate's 404", async () => {
    db.viewer = PEOPLE.bot;
    const bot = await create({});
    expect(bot.status).toBe(403);
    expect((await bot.json()).code).toBe("agent_account");
    db.viewer = PEOPLE.guest;
    expect((await create({})).status).toBe(404);
    expect(routeDb.writes).toEqual([]);
  });

  it("takes only one of the eight colours, and a name and a job", async () => {
    for (const body of [{ hue: "violet" }, { hue: undefined }, { name: "  " }, { job: "" }, { visibility: "TEAM" }]) {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Check the details and try again.", code: "invalid" });
    }
    expect(routeDb.writes).toEqual([]);
  });
});

describe("POST /api/agents/teammates: the plan's limits", () => {
  it("counts a person's own live private teammates only", async () => {
    // Starter: 3 of one's own. Max has 2 live and 1 removed; Lea has 3.
    seedAgent({ slug: "t-a-111111", visibility: "PRIVATE", ownerId: "u-max" });
    seedAgent({ slug: "t-b-222222", visibility: "PRIVATE", ownerId: "u-max" });
    seedAgent({ slug: "t-c-333333", visibility: "PRIVATE", ownerId: "u-max", status: "ARCHIVED" });
    for (const s of ["t-d-444444", "t-e-555555", "t-f-666666"]) seedAgent({ slug: s, visibility: "PRIVATE", ownerId: "u-lea" });

    db.viewer = PEOPLE.max;
    expect((await create({})).status).toBe(201);
    const full = await create({});
    expect(full.status).toBe(403);
    expect(await full.json()).toEqual({
      error: "You have 3 teammates, the most the Starter plan allows. An Owner or Admin can change the plan in Settings, Plan & billing.",
      code: "limit",
    });

    db.viewer = PEOPLE.lea;
    expect((await create({})).status).toBe(403);
  });

  it("never counts the agents a workspace already had toward its workspace teammates", async () => {
    // Fifty catalog and custom agents from before teammates (toolNames null).
    for (let i = 0; i < 50; i += 1) seedAgent({ slug: `agent-${i}`, toolNames: null });
    seedAgent({ slug: "removed-teammate", status: "ARCHIVED" });
    db.viewer = PEOPLE.admin;
    for (let i = 0; i < 3; i += 1) expect((await create({ visibility: "WORKSPACE", name: `Helper ${i}` })).status).toBe(201);
    const full = await create({ visibility: "WORKSPACE", name: "Helper 4" });
    expect(full.status).toBe(403);
    expect((await full.json()).error).toBe(
      "This workspace has 3 workspace teammates, the most the Starter plan allows. An Owner or Admin can change the plan in Settings, Plan & billing.",
    );
    // A workspace's limit is not a person's: the Admin can still make their own.
    expect((await create({ name: "Mine" })).status).toBe(201);
  });

  it("has no limit on Enterprise", async () => {
    db.plan = "ENTERPRISE";
    for (let i = 0; i < 60; i += 1) seedAgent({ slug: `t-x-${i}`, visibility: "PRIVATE", ownerId: "u-max" });
    db.viewer = PEOPLE.max;
    expect((await create({})).status).toBe(201);
    const { body } = await list();
    expect(body.limits.personal).toEqual({ used: 61, max: null });
  });
});

describe("GET /api/agents/teammates", () => {
  beforeEach(() => {
    seedAgent({ slug: "priya-hr", name: "Priya", toolNames: null, hue: null });
    seedAgent({ slug: "status-reporter", name: "Status Reporter" });
    seedAgent({ slug: "t-maxs-aaaaaa", name: "Max's planner", visibility: "PRIVATE", ownerId: "u-max" });
    seedAgent({ slug: "t-leas-bbbbbb", name: "Lea's secret", visibility: "PRIVATE", ownerId: "u-lea" });
    seedAgent({ slug: "old-helper", name: "Old helper", status: "ARCHIVED" });
    seedAgent({ slug: "elsewhere", name: "Elsewhere", organizationId: "org2" });
  });

  it("lists the workspace's teammates and the person's own, never another person's private one", async () => {
    db.viewer = PEOPLE.max;
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.teammates.map((t: { slug: string }) => t.slug).sort()).toEqual(["priya-hr", "status-reporter", "t-maxs-aaaaaa"]);
    expect(body.teammates.find((t: { slug: string }) => t.slug === "priya-hr")).toMatchObject({ legacy: true, canManage: false, hue: "sky" });
    expect(body).toMatchObject({ canCreateWorkspace: false, talkOn: true, tablesOn: true, waitingTotal: 0, templates: [] });
    expect(body.limits).toEqual({ personal: { used: 1, max: 3 }, workspace: { used: 1, max: 3 } });

    // An Admin manages workspace teammates, and still never sees a private one.
    db.viewer = PEOPLE.admin;
    const admin = await list();
    expect(admin.body.teammates.map((t: { slug: string }) => t.slug).sort()).toEqual(["priya-hr", "status-reporter"]);
    expect(admin.body.canCreateWorkspace).toBe(true);
    expect(admin.body.teammates.every((t: { canManage: boolean }) => t.canManage)).toBe(true);
  });

  it("adds the removed ones only when asked, and searches names and jobs", async () => {
    db.viewer = PEOPLE.max;
    expect((await list("?removed=1")).body.teammates.map((t: { slug: string }) => t.slug)).toContain("old-helper");
    expect((await list("?q=PLANNER")).body.teammates.map((t: { slug: string }) => t.slug)).toEqual(["t-maxs-aaaaaa"]);
    expect((await list("?q=secret")).body.teammates).toEqual([]);
  });

  it("shows what waits, an answer after the read cursor, and the last line, most recent chat first", async () => {
    db.viewer = PEOPLE.max;
    db.sessions.push(
      { id: "s-plan", organizationId: "org1", agentId: "a-t-maxs-aaaaaa", userId: "u-max", kind: "TEAMMATE", archivedAt: null },
      { id: "s-status", organizationId: "org1", agentId: "a-status-reporter", userId: "u-max", kind: "TEAMMATE", archivedAt: null },
      // Lea's chat with the same workspace teammate is hers.
      { id: "s-lea", organizationId: "org1", agentId: "a-status-reporter", userId: "u-lea", kind: "TEAMMATE", archivedAt: null },
    );
    const at = (m: number) => new Date(Date.UTC(2026, 9, 6, 9, m));
    db.messages.push(
      { id: "m1", sessionId: "s-plan", role: "USER", content: "What is due?", kind: null, meta: null, toolCalls: null, createdAt: at(0) },
      { id: "m2", sessionId: "s-plan", role: "ASSISTANT", content: "Three things.", kind: null, meta: null, toolCalls: null, createdAt: at(1) },
      { id: "m3", sessionId: "s-status", role: "ASSISTANT", content: "Status is green.", kind: null, meta: null, toolCalls: null, createdAt: at(5) },
      { id: "m4", sessionId: "s-status", role: "SYSTEM", content: "You said no: Post in #general", kind: "EVENT", meta: { event: "action_denied" }, toolCalls: null, createdAt: at(6) },
      { id: "m5", sessionId: "s-lea", role: "ASSISTANT", content: "Lea's answer", kind: null, meta: null, toolCalls: null, createdAt: at(9) },
    );
    // Max read the planner chat after its answer, and the status chat before its.
    db.settings.push({ agentId: "a-t-maxs-aaaaaa", userId: "u-max", lastReadAt: at(2) }, { agentId: "a-status-reporter", userId: "u-max", lastReadAt: at(3) });
    const later = new Date(Date.now() + 60_000);
    db.actions.push(
      { id: "x1", organizationId: "org1", agentId: "a-status-reporter", actingForId: "u-max", status: "PENDING", expiresAt: later },
      { id: "x2", organizationId: "org1", agentId: "a-status-reporter", actingForId: "u-lea", status: "PENDING", expiresAt: later },
      { id: "x3", organizationId: "org1", agentId: "a-status-reporter", actingForId: "u-max", status: "PENDING", expiresAt: new Date(Date.now() - 1000) },
    );

    const { body } = await list();
    expect(body.teammates.map((t: { slug: string }) => t.slug)).toEqual(["status-reporter", "t-maxs-aaaaaa", "priya-hr"]);
    expect(body.teammates[0]).toMatchObject({ waiting: 1, unread: true, lastLine: "You said no: Post in #general", lastAt: at(6).toISOString() });
    expect(body.teammates[1]).toMatchObject({ waiting: 0, unread: false, lastLine: "Three things." });
    expect(body.teammates[2]).toMatchObject({ waiting: 0, unread: false, lastLine: null, lastAt: null });
  });
});
