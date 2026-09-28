import { beforeEach, describe, expect, it, vi } from "vitest";

// goalRightsActor end to end: session in, actor out, then the rule. The pure
// table (goals/goal-rights.test.ts) cannot see how the actor is built, which
// is where a People team manager once lost their report's goals (the chain
// was never loaded for the People team).
const orgSettings: { access?: unknown } = {};
const chains: Record<string, string[]> = {};
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: async () => ({ settings: orgSettings }) } },
}));
vi.mock("@/lib/team", () => ({
  getTeamUserIds: async (_org: string, userId: string) => chains[userId] ?? [userId],
}));

import { goalRightsActor } from "./alignment-scope";
import { mayDeleteGoal, mayEditGoal } from "./goals/goal-rights";

const session = (id: string, accessLevel: string) => ({ user: { id, organizationId: "org", accessLevel } });
const goal = (level: string, ownerId: string | null) => ({ level, ownerId, creatorId: null });

beforeEach(() => {
  delete orgSettings.access;
  for (const k of Object.keys(chains)) delete chains[k];
});

describe("goalRightsActor", () => {
  it("lets a People team manager delete their own report's goal, not a peer's", async () => {
    chains.hr = ["hr", "report"];
    const actor = await goalRightsActor(session("hr", "HR"));
    expect(actor.peopleTeam).toBe(true);
    expect(mayDeleteGoal(actor, goal("INDIVIDUAL", "report"))).toBe(true);
    expect(mayDeleteGoal(actor, goal("DEPARTMENT", "report"))).toBe(true);
    expect(mayDeleteGoal(actor, goal("INDIVIDUAL", "peer"))).toBe(false);
    expect(mayDeleteGoal(actor, goal("COMPANY", null))).toBe(false);
    expect(mayEditGoal(actor, goal("COMPANY", null))).toBe(true);
  });

  it("uses the chain the list route already walked", async () => {
    const actor = await goalRightsActor(session("hr", "HR"), ["hr", "report"]);
    expect(mayDeleteGoal(actor, goal("INDIVIDUAL", "report"))).toBe(true);
  });

  it("counts someone on the configured People team list", async () => {
    orgSettings.access = { peopleTeamUserIds: ["listed"] };
    const listed = await goalRightsActor(session("listed", "EMPLOYEE"));
    expect(listed.peopleTeam).toBe(true);
    expect(mayEditGoal(listed, goal("COMPANY", null))).toBe(true);
    expect(mayDeleteGoal(listed, goal("COMPANY", null))).toBe(false);
    const other = await goalRightsActor(session("other", "EMPLOYEE"));
    expect(other.peopleTeam).toBe(false);
    expect(mayEditGoal(other, goal("COMPANY", null))).toBe(false);
  });

  it("keeps an HR user on the People team when the list names others (the engine's rule)", async () => {
    orgSettings.access = { peopleTeamUserIds: ["listed"] };
    const hr = await goalRightsActor(session("hr", "HR"));
    expect(hr.peopleTeam).toBe(true);
  });

  it("gives a plain manager their chain and nothing org wide", async () => {
    chains.mgr = ["mgr", "report"];
    const actor = await goalRightsActor(session("mgr", "MANAGER"));
    expect(actor.peopleTeam).toBe(false);
    expect(mayEditGoal(actor, goal("INDIVIDUAL", "report"))).toBe(true);
    expect(mayEditGoal(actor, goal("INDIVIDUAL", "peer"))).toBe(false);
    expect(mayEditGoal(actor, goal("COMPANY", null))).toBe(false);
    expect(mayDeleteGoal(actor, goal("COMPANY", null))).toBe(false);
  });

  it("never walks a chain for an employee", async () => {
    const actor = await goalRightsActor(session("emp", "EMPLOYEE"));
    expect(actor.chain).toBeNull();
  });
});
