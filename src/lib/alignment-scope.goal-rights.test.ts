import { beforeEach, describe, expect, it, vi } from "vitest";

// goalRightsActor end to end: session in, actor out, then the rule. The pure
// table (goals/goal-rights.test.ts) cannot see how the actor is built, which
// is where a People team manager once lost their report's goals (the chain
// was never loaded for the People team).
const orgSettings: { access?: unknown } = {};
const chains: Record<string, string[]> = {};
const directReports: Record<string, number> = {};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => ({ settings: orgSettings }) },
    user: { count: async ({ where }: { where: { managerId: string } }) => directReports[where.managerId] ?? 0 },
  },
}));
vi.mock("@/lib/team", () => ({
  getTeamUserIds: async (_org: string, userId: string) => chains[userId] ?? [userId],
}));

import { goalRightsActor } from "./alignment-scope";
import { legacyTestSession } from "./access/test-fixtures";
import { mayDeleteGoal, mayEditGoal, mayLinkUnderGoal, mayUnlinkFromGoal } from "./goals/goal-rights";

const session = (id: string, level: string) => legacyTestSession(id, level);
const goal = (level: string, ownerId: string | null) => ({ level, ownerId, creatorId: null });

beforeEach(() => {
  delete orgSettings.access;
  for (const k of Object.keys(chains)) delete chains[k];
  for (const k of Object.keys(directReports)) delete directReports[k];
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

describe("linking a goal under another (Part of)", () => {
  it("lets a manager line a Department goal up under any Company goal, never an Individual one", async () => {
    chains.mgr = ["mgr", "report"];
    const mgr = await goalRightsActor(session("mgr", "MANAGER"));
    expect(mgr.leadsPeople).toBe(true);
    expect(mayLinkUnderGoal(mgr, goal("COMPANY", "ceo"), { level: "DEPARTMENT", editable: true })).toBe(true);
    expect(mayLinkUnderGoal(mgr, goal("COMPANY", null), { level: "DEPARTMENT", editable: true })).toBe(true);
    expect(mayLinkUnderGoal(mgr, goal("COMPANY", "ceo"), { level: "INDIVIDUAL", editable: true })).toBe(false);
    // A Department goal they cannot edit is not theirs to move.
    expect(mayLinkUnderGoal(mgr, goal("COMPANY", "ceo"), { level: "DEPARTMENT", editable: false })).toBe(false);
    // Under a peer's Department goal the edit rule still decides.
    expect(mayLinkUnderGoal(mgr, goal("DEPARTMENT", "peer"), { level: "INDIVIDUAL", editable: true })).toBe(false);
    expect(mayLinkUnderGoal(mgr, goal("DEPARTMENT", "report"), { level: "INDIVIDUAL", editable: true })).toBe(true);
  });

  it("counts an employee with a direct report as someone who manages people", async () => {
    directReports.lead = 1;
    const lead = await goalRightsActor(session("lead", "EMPLOYEE"));
    expect(lead.leadsPeople).toBe(true);
    expect(mayLinkUnderGoal(lead, goal("COMPANY", "ceo"), { level: "DEPARTMENT", editable: true })).toBe(true);
  });

  it("never lets a member with no reports move a Company goal's progress", async () => {
    const emp = await goalRightsActor(session("emp", "EMPLOYEE"));
    expect(emp.leadsPeople).toBe(false);
    expect(mayLinkUnderGoal(emp, goal("COMPANY", "ceo"), { level: "DEPARTMENT", editable: true })).toBe(false);
    expect(mayLinkUnderGoal(emp, goal("COMPANY", "ceo"), { level: "INDIVIDUAL", editable: true })).toBe(false);
    // Their own goal is still theirs to link under.
    expect(mayLinkUnderGoal(emp, goal("INDIVIDUAL", "emp"), { level: "INDIVIDUAL", editable: true })).toBe(true);
  });

  it("lets the parent's editors unlink a child they cannot edit", async () => {
    const admin = await goalRightsActor(session("adm", "COMPANY_ADMIN"));
    expect(mayUnlinkFromGoal(admin, goal("COMPANY", null), false)).toBe(true);
    const ceo = await goalRightsActor(session("ceo", "EMPLOYEE"));
    expect(mayUnlinkFromGoal(ceo, goal("COMPANY", "ceo"), false)).toBe(true);
    const emp = await goalRightsActor(session("emp", "EMPLOYEE"));
    expect(mayUnlinkFromGoal(emp, goal("COMPANY", "ceo"), false)).toBe(false);
    expect(mayUnlinkFromGoal(emp, goal("COMPANY", "ceo"), true)).toBe(true);
  });
});
