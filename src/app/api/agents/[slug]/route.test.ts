// The workspace agent routes by slug (PATCH and DELETE /api/agents/[slug],
// PATCH and POST .../schedule, POST .../install) act only on the workspace's
// own agents (docs/plans/ai-teammates.md 3.15): another person's PRIVATE AI
// teammate answers an Admin and the Owner exactly as a slug that does not
// exist, and nothing about it changes, its catalog-slug row included. And
// removing a workspace agent here does what removing it as a teammate does:
// what it asked that still waits is cancelled and its routines pause. The
// database is the teammate routes' in-memory double; the queue, the routine
// runner and the autonomous runner are mocked at their boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/agents/teammate-route-fixtures")).routeDb }));
vi.mock("@/lib/app-gate", async () => (await import("@/lib/agents/teammate-route-fixtures")).appGateFake);
vi.mock("@/lib/ai/ai-off-gate", () => ({ aiOffResponse: async () => null }));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => true }));
vi.mock("@/lib/ai-client", () => ({ isAiConfigured: async () => true }));
// GET /api/agents reads only which products are in scope from the tools.
vi.mock("@/lib/agents/tools", async () => ({ PRODUCT_TOOL_NAMES: (await import("@/lib/agents/tool-names")).PRODUCT_TOOL_NAMES }));

const mocks = vi.hoisted(() => ({
  audits: [] as Array<{ action: string; agent: { id: string; slug: string } }>,
  cancelPendingActionsOf: vi.fn<(agent: { id: string; slug: string; name: string }, now?: Date) => Promise<number>>(async () => 0),
  pauseRoutine: vi.fn<(routine: { id: string }, reason: string, agent?: { name: string; slug: string } | null) => Promise<boolean>>(async () => true),
  runAgentAutonomously: vi.fn(async () => ({ status: "SUCCEEDED", runId: "run1" })),
}));
vi.mock("@/lib/agents/audit", () => ({
  auditAgent: async (a: { action: string; agent: { id: string; slug: string } }) => void mocks.audits.push(a),
}));
vi.mock("@/lib/agents/actions", () => ({ cancelPendingActionsOf: mocks.cancelPendingActionsOf }));
vi.mock("@/lib/agents/routines-server", () => ({ pauseRoutine: mocks.pauseRoutine }));
vi.mock("@/lib/agents/autonomous", () => ({
  computeNextRunAt: () => new Date("2026-10-07T09:00:00Z"),
  runAgentAutonomously: mocks.runAgentAutonomously,
}));

import { DELETE as removeAgent, PATCH as patchAgent } from "./route";
import { POST as installAgent } from "./install/route";
import { PATCH as patchSchedule, POST as runNow } from "./schedule/route";
import { GET as listAgents, POST as createAgent } from "../route";
import { PEOPLE, db, jsonRequest, paramsOf, resetRouteDb, routeDb, seedAgent } from "@/lib/agents/teammate-route-fixtures";

const PRIVATE_SLUG = "t-planner-aaaaaa";
const REMOVED_PRIVATE_SLUG = "t-old-bbbbbb";

const slugged = (slug: string) => paramsOf({ slug });

// The handlers' types allow undefined (an unhandled method); every call here answers.
async function call(res: Promise<Response | undefined>) {
  const r = (await res) as Response;
  return { status: r.status, body: await r.json() };
}

beforeEach(() => {
  resetRouteDb();
  mocks.audits.length = 0;
  vi.clearAllMocks();
});

describe("another person's private teammate is not one of the workspace's agents", () => {
  const ROUTES: Array<[string, (slug: string) => Promise<Response | undefined>]> = [
    ["PATCH pause", (s) => patchAgent(jsonRequest("PATCH", { status: "DISABLED" }), slugged(s))],
    ["PATCH rename", (s) => patchAgent(jsonRequest("PATCH", { name: "Mine now", description: "Does what I say." }), slugged(s))],
    ["DELETE", (s) => removeAgent(jsonRequest("DELETE"), slugged(s))],
    ["PATCH schedule", (s) => patchSchedule(jsonRequest("PATCH", { autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", autonomousPrompt: "Post my notes." }), slugged(s))],
    ["POST run now", (s) => runNow(jsonRequest("POST"), slugged(s))],
  ];

  for (const [who, viewer] of [
    ["an Admin", PEOPLE.admin],
    ["the Owner", PEOPLE.owner],
  ] as const) {
    it(`answers ${who} exactly as a slug that does not exist, on every route, and changes nothing`, async () => {
      const mine = seedAgent({ slug: PRIVATE_SLUG, name: "Planner", visibility: "PRIVATE", ownerId: "u-max", systemPrompt: "Plan my week." });
      const removed = seedAgent({ slug: REMOVED_PRIVATE_SLUG, name: "Old", visibility: "PRIVATE", ownerId: "u-max", status: "ARCHIVED" });
      db.viewer = viewer;
      for (const [name, route] of ROUTES) {
        const theirs = await call(route(PRIVATE_SLUG));
        const missing = await call(route("no-such-agent"));
        expect([name, theirs.status]).toEqual([name, 404]);
        expect([name, theirs.body]).toEqual([name, missing.body]);
      }
      // Adding back a removed one: the same "unknown agent" as a slug nobody has.
      const back = await call(installAgent(jsonRequest("POST"), slugged(REMOVED_PRIVATE_SLUG)));
      expect(back).toEqual(await call(installAgent(jsonRequest("POST"), slugged("no-such-agent"))));
      expect(back.status).toBe(404);

      expect(routeDb.writes).toEqual([]);
      expect(db.agents.find((a) => a.id === mine.id)).toMatchObject({ status: "ENABLED", name: "Planner", systemPrompt: "Plan my week.", autonomousEnabled: false, scheduleCron: null });
      expect(db.agents.find((a) => a.id === removed.id)?.status).toBe("ARCHIVED");
      expect(mocks.audits).toEqual([]);
      expect(mocks.runAgentAutonomously).not.toHaveBeenCalled();
      expect(mocks.cancelPendingActionsOf).not.toHaveBeenCalled();
      expect(mocks.pauseRoutine).not.toHaveBeenCalled();
    });
  }

  it("never writes a catalog prompt over a private teammate that holds a catalog slug", async () => {
    seedAgent({ slug: "priya-hr", name: "My HR helper", visibility: "PRIVATE", ownerId: "u-max", systemPrompt: "Only my leave questions.", status: "ARCHIVED" });
    db.viewer = PEOPLE.admin;
    expect(await call(installAgent(jsonRequest("POST"), slugged("priya-hr")))).toEqual({ status: 404, body: { error: "unknown agent" } });
    expect(db.agents[0]).toMatchObject({ name: "My HR helper", systemPrompt: "Only my leave questions.", status: "ARCHIVED", visibility: "PRIVATE" });
    expect(routeDb.writes).toEqual([]);
  });

  it("keeps the routes the Owner and Admins' own: its owner, a Member, gets the Apps page's 403", async () => {
    seedAgent({ slug: PRIVATE_SLUG, visibility: "PRIVATE", ownerId: "u-max" });
    db.viewer = PEOPLE.max;
    expect((await call(patchAgent(jsonRequest("PATCH", { status: "DISABLED" }), slugged(PRIVATE_SLUG)))).status).toBe(403);
    expect((await call(removeAgent(jsonRequest("DELETE"), slugged(PRIVATE_SLUG)))).status).toBe(403);
    expect(routeDb.writes).toEqual([]);
  });
});

describe("the workspace's agent list (GET and POST /api/agents)", () => {
  it("never lists a private teammate, added or removed, for anyone, its owner included, nor any agent made as a teammate", async () => {
    seedAgent({ slug: "status-reporter", name: "Status Reporter", toolNames: null });
    seedAgent({ slug: "old-reporter", name: "Old reporter", status: "ARCHIVED", toolNames: null });
    // Made as workspace teammates: they live in Chats, never in the old loop's list (legacy-agents.ts).
    seedAgent({ slug: "pm-team", name: "PM team" });
    seedAgent({ slug: "pm-old", name: "PM old", status: "ARCHIVED" });
    seedAgent({ slug: PRIVATE_SLUG, name: "Planner", visibility: "PRIVATE", ownerId: "u-max" });
    seedAgent({ slug: REMOVED_PRIVATE_SLUG, name: "Old", visibility: "PRIVATE", ownerId: "u-max", status: "ARCHIVED" });
    for (const viewer of [PEOPLE.max, PEOPLE.admin, PEOPLE.owner]) {
      db.viewer = viewer;
      const { status, body } = await call(listAgents());
      expect(status).toBe(200);
      expect(body.installed.map((a: { slug: string }) => a.slug)).toEqual(["status-reporter"]);
      expect(body.removed.map((a: { slug: string }) => a.slug)).toEqual(["old-reporter"]);
    }
  });

  it("never offers or adds a catalog agent over one whose tools were chosen in AI teammates (review round 2)", async () => {
    // priya-hr, chosen tools: a teammate now, out of the list above.
    seedAgent({ slug: "priya-hr", name: "Our HR helper", systemPrompt: "Our own leave rules." });
    db.viewer = PEOPLE.admin;
    const { body } = await call(listAgents());
    expect(body.available.map((a: { slug: string }) => a.slug)).not.toContain("priya-hr");
    expect((await call(installAgent(jsonRequest("POST"), slugged("priya-hr")))).status).toBe(404);
    expect(db.agents[0]).toMatchObject({ name: "Our HR helper", systemPrompt: "Our own leave rules." });
  });

  it("adds a catalog agent back over its own instructions only when the catalog wrote them (review round 3)", async () => {
    const { AGENTS_BY_SLUG } = await import("@/lib/agents/catalog");
    const catalogPrompt = AGENTS_BY_SLUG["priya-hr"].systemPrompt;
    // Instructions a manager edited in AI teammates, then removed: kept on Add back.
    seedAgent({ slug: "priya-hr", name: "HR helper", toolNames: null, status: "ARCHIVED", systemPrompt: "Our leave rules: 20 days, ask Lea." });
    db.viewer = PEOPLE.admin;
    expect((await call(installAgent(jsonRequest("POST"), slugged("priya-hr")))).status).toBe(200);
    expect(db.agents[0]).toMatchObject({ status: "ENABLED", name: "HR helper", systemPrompt: "Our leave rules: 20 days, ask Lea." });
    // The prompt it was added with before tools shipped, untouched: refreshed.
    const old = catalogPrompt.replace(/\n\nYou operate inside WorkwrK[\s\S]*$/, "") +
      "\n\nYou operate inside WorkwrK \u2014 a modular Work OS. You can:\n- Reason about People & HR concepts and best practices\n- Suggest concrete actions the user can take inside their WorkwrK workspace\n- Output structured content (tables, lists, code) ready to paste into the product\n\nYou do NOT yet have direct read/write access to the user's WorkwrK data. That capability ships in Phase D3 with tool calling. For now, ask clarifying questions, suggest the next step, and produce drafts the user can copy.\n\nKeep responses concise. Use markdown for structure when helpful.";
    db.agents[0].status = "ARCHIVED";
    db.agents[0].systemPrompt = old;
    expect((await call(installAgent(jsonRequest("POST"), slugged("priya-hr")))).status).toBe(200);
    expect(db.agents[0].systemPrompt).toBe(catalogPrompt);
  });

  it("never offers a catalog agent made a teammate and then removed: it comes back in AI teammates (review round 3)", async () => {
    seedAgent({ slug: "priya-hr", name: "Our HR helper", status: "ARCHIVED" });
    db.viewer = PEOPLE.admin;
    const { body } = await call(listAgents());
    expect(body.available.map((a: { slug: string }) => a.slug)).not.toContain("priya-hr");
    expect(body.removed.map((a: { slug: string }) => a.slug)).not.toContain("priya-hr");
  });

  it("never gives a new agent a slug a static route beside /api/agents/[slug] owns", async () => {
    db.viewer = PEOPLE.admin;
    const made = await call(createAgent(jsonRequest("POST", { name: "Runs", description: "Runs things.", systemPrompt: "Be brief." })));
    expect(made.status).toBe(201);
    expect(made.body.agent.slug).toBe("runs-2");
  });
});

describe("a workspace agent", () => {
  it("still pauses, schedules, runs and comes back as before", async () => {
    seedAgent({ slug: "deal-desk", name: "Deal desk", toolNames: null });
    db.viewer = PEOPLE.admin;
    expect((await call(patchAgent(jsonRequest("PATCH", { status: "DISABLED" }), slugged("deal-desk")))).status).toBe(200);
    expect(db.agents[0].status).toBe("DISABLED");
    expect((await call(patchAgent(jsonRequest("PATCH", { status: "ENABLED" }), slugged("deal-desk")))).status).toBe(200);
    const scheduled = await call(patchSchedule(jsonRequest("PATCH", { autonomousEnabled: true, scheduleCron: "0 9 * * 1-5" }), slugged("deal-desk")));
    expect(scheduled.status).toBe(200);
    expect(db.agents[0]).toMatchObject({ autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", nextRunAt: new Date("2026-10-07T09:00:00Z") });
    expect((await call(runNow(jsonRequest("POST"), slugged("deal-desk")))).status).toBe(200);
    expect(mocks.runAgentAutonomously).toHaveBeenCalledTimes(1);

    db.agents[0].status = "ARCHIVED";
    expect((await call(installAgent(jsonRequest("POST"), slugged("deal-desk")))).status).toBe(200);
    expect(db.agents[0].status).toBe("ENABLED");
    expect(mocks.audits.map((a) => a.action)).toEqual(["paused", "turned_on", "schedule_changed", "run_now", "added"]);
  });

  it("never adds a removed workspace teammate back through Workspace agents: its own restore does, within the plan's limit", async () => {
    seedAgent({ slug: "weekly-status", name: "Weekly status", status: "ARCHIVED" });
    seedAgent({ slug: "old-custom", toolNames: null, status: "ARCHIVED" });
    db.viewer = PEOPLE.admin;
    expect((await call(installAgent(jsonRequest("POST"), slugged("weekly-status")))).status).toBe(404);
    expect(db.agents.find((a) => a.slug === "weekly-status")?.status).toBe("ARCHIVED");
    expect((await call(installAgent(jsonRequest("POST"), slugged("old-custom")))).status).toBe(200);
  });

  it("never runs, schedules, changes or removes an agent made as a teammate: the old loop would skip its cards, its tools and its limit", async () => {
    // Review round 1: Run now on a workspace teammate sent an invitation with no card.
    seedAgent({ slug: "people-ops", name: "People Ops" });
    db.viewer = PEOPLE.admin;
    expect((await call(runNow(jsonRequest("POST"), slugged("people-ops")))).status).toBe(404);
    expect((await call(patchSchedule(jsonRequest("PATCH", { autonomousEnabled: true, scheduleCron: "0 9 * * 1-5" }), slugged("people-ops")))).status).toBe(404);
    expect((await call(patchAgent(jsonRequest("PATCH", { status: "DISABLED" }), slugged("people-ops")))).status).toBe(404);
    expect((await call(removeAgent(jsonRequest("DELETE"), slugged("people-ops")))).status).toBe(404);
    expect(mocks.runAgentAutonomously).not.toHaveBeenCalled();
    expect(db.agents[0]).toMatchObject({ status: "ENABLED", autonomousEnabled: false });
  });

  it("is removed as removing a teammate removes it: what waits is cancelled and every running routine pauses", async () => {
    const agent = seedAgent({ slug: "status-reporter", name: "Status Reporter", toolNames: null, autonomousEnabled: true, scheduleCron: "0 9 * * 1-5", nextRunAt: new Date("2026-10-07T09:00:00Z") });
    db.routines.push(
      { id: "r-max", organizationId: "org1", agentId: agent.id, actingForId: "u-max", name: "Brief", status: "active" },
      { id: "r-lea", organizationId: "org1", agentId: agent.id, actingForId: "u-lea", name: "Digest", status: "active" },
      { id: "r-off", organizationId: "org1", agentId: agent.id, actingForId: "u-lea", name: "Old", status: "paused" },
      { id: "r-other", organizationId: "org1", agentId: "a-other", actingForId: "u-lea", name: "Other", status: "active" },
    );
    db.viewer = PEOPLE.admin;
    expect(await call(removeAgent(jsonRequest("DELETE"), slugged("status-reporter")))).toEqual({ status: 200, body: { ok: true } });
    expect(db.agents[0]).toMatchObject({ status: "ARCHIVED", autonomousEnabled: false, nextRunAt: null });
    expect(mocks.cancelPendingActionsOf).toHaveBeenCalledTimes(1);
    expect(mocks.cancelPendingActionsOf.mock.calls[0][0]).toMatchObject({ id: agent.id, slug: "status-reporter", name: "Status Reporter" });
    expect(mocks.pauseRoutine.mock.calls.map(([r, reason]) => [r.id, reason])).toEqual([
      ["r-max", "agent_removed"],
      ["r-lea", "agent_removed"],
    ]);
    expect(mocks.audits.map((a) => a.action)).toEqual(["removed"]);

    // Removed already: the route answers as for a missing agent, and nothing more happens.
    expect((await call(removeAgent(jsonRequest("DELETE"), slugged("status-reporter")))).status).toBe(404);
    expect(mocks.cancelPendingActionsOf).toHaveBeenCalledTimes(1);
    expect(mocks.pauseRoutine).toHaveBeenCalledTimes(2);
  });
});
