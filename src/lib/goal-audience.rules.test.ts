import { describe, expect, it, vi } from "vitest";

// The rules under test are pure; the module's database helpers are never
// called here, so Prisma and the team walk are stubbed out.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));

import { mayAttachUnderGoal, mayEditGoalAs, seesUnownedGoals, type GoalEditActor } from "./goal-audience";

const member = (over: Partial<GoalEditActor> = {}): GoalEditActor => ({
  callerId: "me",
  orgWide: false,
  manager: false,
  teamIds: new Set(["me", "report"]),
  ...over,
});

describe("mayAttachUnderGoal (Part of)", () => {
  it("refuses a member attaching their goal under a Company goal they cannot edit", () => {
    // The walk's case: a brand new employee dragged an unowned Company goal
    // from 80 to 41 by attaching a 1% goal to it.
    expect(mayAttachUnderGoal(member({ teamIds: new Set(["me"]) }), { ownerId: null })).toBe(false);
    expect(mayAttachUnderGoal(member({ teamIds: new Set(["me"]) }), { ownerId: "ceo" })).toBe(false);
  });

  it("refuses a member with one report too: a report is not an edit grant", () => {
    expect(mayAttachUnderGoal(member(), { ownerId: null })).toBe(false);
    expect(mayAttachUnderGoal(member(), { ownerId: "report" })).toBe(false);
  });

  it("allows the parent's owner", () => {
    expect(mayAttachUnderGoal(member(), { ownerId: "me" })).toBe(true);
  });

  it("allows the manager tier over their tree and over unowned goals, never outside the tree", () => {
    const mgr = member({ manager: true });
    expect(mayAttachUnderGoal(mgr, { ownerId: "report" })).toBe(true);
    expect(mayAttachUnderGoal(mgr, { ownerId: null })).toBe(true);
    expect(mayAttachUnderGoal(mgr, { ownerId: "stranger" })).toBe(false);
  });

  it("allows an org-wide level anywhere", () => {
    expect(mayAttachUnderGoal(member({ orgWide: true, teamIds: null }), { ownerId: "stranger" })).toBe(true);
    expect(mayAttachUnderGoal(member({ orgWide: true, teamIds: null }), { ownerId: null })).toBe(true);
  });
});

describe("mayEditGoalAs", () => {
  it("is the PATCH edit gate: owner, manager over the tree, org-wide", () => {
    expect(mayEditGoalAs(member(), "me")).toBe(true);
    expect(mayEditGoalAs(member(), "report")).toBe(false);
    expect(mayEditGoalAs(member({ manager: true }), "report")).toBe(true);
    expect(mayEditGoalAs(member({ manager: true, teamIds: null }), "report")).toBe(false);
  });
});

describe("seesUnownedGoals", () => {
  it("is the manager tier only, never everyone with a report", () => {
    expect(seesUnownedGoals({ manager: true })).toBe(true);
    expect(seesUnownedGoals({ manager: false })).toBe(false);
  });
});
