import { describe, expect, it } from "vitest";
import { TEAM_GOALS_NOTICE, canonicalGoalsView } from "./goals-view";

const mgr = { canTeam: true };
const member = { canTeam: false };

describe("canonicalGoalsView", () => {
  it("the canon forms need no rewrite", () => {
    expect(canonicalGoalsView({}, mgr)).toEqual({ view: "mine", canonicalHref: undefined, notice: undefined });
    expect(canonicalGoalsView({ view: "team" }, mgr).canonicalHref).toBeUndefined();
    expect(canonicalGoalsView({ view: "company" }, member).canonicalHref).toBeUndefined();
  });

  it("maps the three retired forms for one release", () => {
    expect(canonicalGoalsView({ mine: "1" }, mgr)).toMatchObject({ view: "mine", canonicalHref: "/okrs" });
    expect(canonicalGoalsView({ team: "1" }, mgr)).toMatchObject({ view: "team", canonicalHref: "/okrs?view=team" });
    expect(canonicalGoalsView({ level: "company" }, mgr)).toMatchObject({ view: "company", canonicalHref: "/okrs?view=company" });
    expect(canonicalGoalsView({ level: "COMPANY" }, member)).toMatchObject({ view: "company", canonicalHref: "/okrs?view=company" });
  });

  it("keeps ?new=1 across the rewrite so the create modal still opens", () => {
    expect(canonicalGoalsView({ mine: "1", new: "1" }, mgr).canonicalHref).toBe("/okrs?new=1");
    expect(canonicalGoalsView({ team: "1", new: "1" }, mgr).canonicalHref).toBe("/okrs?view=team&new=1");
  });

  it("a Member with no reports asking for Team goals gets My goals and the notice line", () => {
    const r = canonicalGoalsView({ view: "team" }, member);
    expect(r).toEqual({ view: "mine", canonicalHref: "/okrs", notice: TEAM_GOALS_NOTICE });
    expect(canonicalGoalsView({ team: "1" }, member).view).toBe("mine");
  });

  it("an unknown view falls back to My goals and is stripped", () => {
    expect(canonicalGoalsView({ view: "all" }, mgr)).toMatchObject({ view: "mine", canonicalHref: "/okrs" });
  });

  it("the never-printed ?level=department keeps narrowing instead of widening", () => {
    expect(canonicalGoalsView({ level: "department" }, mgr)).toEqual({ view: "level", legacyLevel: "department" });
  });
});
