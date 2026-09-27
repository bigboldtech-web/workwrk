import { describe, expect, it } from "vitest";
import {
  dashboardsAllowedFor,
  isSpaceOverviewId,
  overviewSourceProblem,
  spaceOverviewId,
  SPACE_OVERVIEW_PREFIX,
} from "./dashboard-access";

describe("the Space Overview id", () => {
  it("is the prefix and the Space id, and only that shape reads as one", () => {
    expect(spaceOverviewId("sp1")).toBe("sov_sp1");
    expect(SPACE_OVERVIEW_PREFIX).toBe("sov_");
    expect(isSpaceOverviewId(spaceOverviewId("cmsfz98mz0000p3xp51wy97id"))).toBe(true);
    expect(isSpaceOverviewId("sov_")).toBe(false);
    expect(isSpaceOverviewId("cmsfz98mz0000p3xp51wy97id")).toBe(false);
    expect(isSpaceOverviewId("xsov_1")).toBe(false);
  });
});

describe("dashboardsAllowedFor", () => {
  it("lets members in and keeps a Guest, a missing and an unknown role out", () => {
    expect(dashboardsAllowedFor("OWNER")).toBe(true);
    expect(dashboardsAllowedFor("ADMIN")).toBe(true);
    expect(dashboardsAllowedFor("MEMBER")).toBe(true);
    expect(dashboardsAllowedFor("GUEST")).toBe(false);
    expect(dashboardsAllowedFor(null)).toBe(false);
    expect(dashboardsAllowedFor(undefined)).toBe(false);
    expect(dashboardsAllowedFor("")).toBe(false);
    expect(dashboardsAllowedFor("EMPLOYEE")).toBe(false);
  });
});

describe("overviewSourceProblem", () => {
  const spaces = new Map<string, string | null>([
    ["in1", "S"],
    ["in2", "S"],
    ["other", "T"],
    ["loose", null],
  ]);
  it("accepts this Space and Lists inside it", () => {
    expect(overviewSourceProblem({ kind: "space", spaceId: "S" }, "S", spaces)).toBeNull();
    expect(overviewSourceProblem({ kind: "lists", listIds: ["in1", "in2"] }, "S", spaces)).toBeNull();
  });
  it("refuses everything, another Space, and any List outside this Space", () => {
    expect(overviewSourceProblem({ kind: "all" }, "S", spaces)).toBe("overview_source");
    expect(overviewSourceProblem({ kind: "space", spaceId: "T" }, "S", spaces)).toBe("overview_source");
    expect(overviewSourceProblem({ kind: "lists", listIds: ["in1", "other"] }, "S", spaces)).toBe("overview_source");
    expect(overviewSourceProblem({ kind: "lists", listIds: ["loose"] }, "S", spaces)).toBe("overview_source");
    // An id the board query did not find is outside, never a pass.
    expect(overviewSourceProblem({ kind: "lists", listIds: ["in1", "ghost"] }, "S", spaces)).toBe("overview_source");
    expect(overviewSourceProblem({ kind: "lists", listIds: [] }, "S", spaces)).toBe("overview_source");
  });
});
