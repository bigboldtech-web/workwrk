import { describe, expect, it, vi } from "vitest";

// The rules under test are pure; the module's database helpers are never
// called here, so Prisma and the team walk are stubbed out.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));

import { mayAttachUnderGoal, seesUnownedGoals } from "./goal-audience";
import type { GoalRightsActor } from "./goals/goal-rights";

const member = (over: Partial<GoalRightsActor> = {}): GoalRightsActor => ({
  callerId: "me",
  admin: false,
  peopleTeam: false,
  manager: false,
  agent: false,
  chain: new Set(["me", "report"]),
  ...over,
});
const parent = (level: string, ownerId: string | null, creatorId: string | null = null) => ({ level, ownerId, creatorId });

describe("mayAttachUnderGoal (Part of)", () => {
  it("refuses a member attaching their goal under a Company goal they cannot edit", () => {
    // The walk's case: a brand new employee dragged an unowned Company goal
    // from 80 to 41 by attaching a 1% goal to it.
    expect(mayAttachUnderGoal(member({ chain: new Set(["me"]) }), parent("COMPANY", null))).toBe(false);
    expect(mayAttachUnderGoal(member({ chain: new Set(["me"]) }), parent("COMPANY", "ceo"))).toBe(false);
  });

  it("refuses a member with one report too: a report is not an edit grant", () => {
    expect(mayAttachUnderGoal(member(), parent("DEPARTMENT", null))).toBe(false);
    expect(mayAttachUnderGoal(member(), parent("DEPARTMENT", "report"))).toBe(false);
  });

  it("allows the parent's owner", () => {
    expect(mayAttachUnderGoal(member(), parent("COMPANY", "me"))).toBe(true);
  });

  it("allows the manager tier over their chain's Department goals, never a Company goal or outside the chain", () => {
    const mgr = member({ manager: true });
    expect(mayAttachUnderGoal(mgr, parent("DEPARTMENT", "report"))).toBe(true);
    expect(mayAttachUnderGoal(mgr, parent("DEPARTMENT", null))).toBe(false);
    expect(mayAttachUnderGoal(mgr, parent("DEPARTMENT", null, "me"))).toBe(true);
    expect(mayAttachUnderGoal(mgr, parent("DEPARTMENT", "stranger"))).toBe(false);
    expect(mayAttachUnderGoal(mgr, parent("COMPANY", null))).toBe(false);
    expect(mayAttachUnderGoal(mgr, parent("COMPANY", "report"))).toBe(false);
  });

  it("allows Owner/Admin and the People team anywhere", () => {
    expect(mayAttachUnderGoal(member({ admin: true, chain: null }), parent("COMPANY", "stranger"))).toBe(true);
    expect(mayAttachUnderGoal(member({ peopleTeam: true, chain: null }), parent("COMPANY", null))).toBe(true);
  });
});

describe("seesUnownedGoals", () => {
  it("is the manager tier only, never everyone with a report", () => {
    expect(seesUnownedGoals({ manager: true })).toBe(true);
    expect(seesUnownedGoals({ manager: false })).toBe(false);
  });
});
