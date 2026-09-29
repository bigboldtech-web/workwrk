import { describe, expect, it } from "vitest";
import { canManageCycle, cycleDeleteBlocked, launchAudience } from "./review-cycle-rules";

describe("canManageCycle", () => {
  it("the People team and Admin manage every cycle, legacy ones included", () => {
    expect(canManageCycle({ callerId: "a", peopleTeamOrAdmin: true, createdById: null })).toBe(true);
    expect(canManageCycle({ callerId: "a", peopleTeamOrAdmin: true, createdById: "b" })).toBe(true);
  });
  it("a manager manages only the cycles they started", () => {
    expect(canManageCycle({ callerId: "m", peopleTeamOrAdmin: false, createdById: "m" })).toBe(true);
    expect(canManageCycle({ callerId: "m", peopleTeamOrAdmin: false, createdById: "x" })).toBe(false);
  });
  it("a cycle with no recorded creator is never a manager's", () => {
    expect(canManageCycle({ callerId: "m", peopleTeamOrAdmin: false, createdById: null })).toBe(false);
    expect(canManageCycle({ callerId: "m", peopleTeamOrAdmin: false, createdById: undefined })).toBe(false);
  });
});

describe("launchAudience", () => {
  const people = [
    { id: "p1", departmentId: "d1" },
    { id: "p2", departmentId: "d2" },
    { id: "p3", departmentId: null },
  ];
  it("the People team launches for the cycle's own audience", () => {
    const base = { peopleTeamOrAdmin: true, departmentIds: ["d1"], userIds: ["p3"], chainIds: [], people };
    expect(launchAudience({ ...base, audienceType: "ALL" })).toEqual(["p1", "p2", "p3"]);
    expect(launchAudience({ ...base, audienceType: "DEPARTMENTS" })).toEqual(["p1"]);
    expect(launchAudience({ ...base, audienceType: "USERS" })).toEqual(["p3"]);
  });
  it("a manager's cycle is clipped to their chain, whatever the row says", () => {
    const base = { peopleTeamOrAdmin: false, departmentIds: ["d1", "d2"], userIds: ["p1", "p2"], chainIds: ["p2"], people };
    expect(launchAudience({ ...base, audienceType: "ALL" })).toEqual(["p2"]);
    expect(launchAudience({ ...base, audienceType: "DEPARTMENTS" })).toEqual(["p2"]);
    expect(launchAudience({ ...base, audienceType: "USERS" })).toEqual(["p2"]);
    expect(launchAudience({ ...base, chainIds: [], audienceType: "ALL" })).toEqual([]);
  });
});

describe("cycleDeleteBlocked", () => {
  const draft = { status: "DRAFT", reviewCount: 0, isAgent: false };
  it("the starter deletes their own empty Draft", () => {
    expect(cycleDeleteBlocked({ ...draft, callerId: "m", peopleTeamOrAdmin: false, createdById: "m" })).toBeNull();
  });
  it("the People team and Admin delete any empty Draft, legacy ones included", () => {
    expect(cycleDeleteBlocked({ ...draft, callerId: "a", peopleTeamOrAdmin: true, createdById: "m" })).toBeNull();
    expect(cycleDeleteBlocked({ ...draft, callerId: "a", peopleTeamOrAdmin: true, createdById: null })).toBeNull();
  });
  it("nobody else, and never an Agent", () => {
    expect(cycleDeleteBlocked({ ...draft, callerId: "x", peopleTeamOrAdmin: false, createdById: "m" })).toBe("who");
    expect(cycleDeleteBlocked({ ...draft, callerId: "m", peopleTeamOrAdmin: false, createdById: null })).toBe("who");
    expect(cycleDeleteBlocked({ ...draft, isAgent: true, callerId: "m", peopleTeamOrAdmin: false, createdById: "m" })).toBe("who");
    expect(cycleDeleteBlocked({ ...draft, isAgent: true, callerId: "a", peopleTeamOrAdmin: true, createdById: "m" })).toBe("who");
  });
  it("past Draft, or with any review, is Cancel's (state), for the starter and the People team alike", () => {
    for (const peopleTeamOrAdmin of [false, true]) {
      const who = { callerId: "m", peopleTeamOrAdmin, createdById: "m", isAgent: false };
      expect(cycleDeleteBlocked({ ...who, status: "ACTIVE", reviewCount: 0 })).toBe("state");
      expect(cycleDeleteBlocked({ ...who, status: "CANCELLED", reviewCount: 0 })).toBe("state");
      expect(cycleDeleteBlocked({ ...who, status: "DRAFT", reviewCount: 1 })).toBe("state");
    }
  });
});
