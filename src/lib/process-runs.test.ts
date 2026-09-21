import { describe, expect, it } from "vitest";
import { allowedRunsViews, effectiveRunStatus, resolveRunsView, runsSummaryLine } from "./process-runs";

const member = { hasReports: false, peopleTeam: false, orgRole: "MEMBER" };
const manager = { hasReports: true, peopleTeam: false, orgRole: "MEMBER" };
const admin = { hasReports: false, peopleTeam: false, orgRole: "ADMIN" };
const people = { hasReports: false, peopleTeam: true, orgRole: "MEMBER" };

describe("allowedRunsViews", () => {
  it("gives Mine to everyone, Team to hasReports, All to admins and the People team", () => {
    expect(allowedRunsViews(member)).toEqual(["mine"]);
    expect(allowedRunsViews(manager)).toEqual(["mine", "team"]);
    expect(allowedRunsViews(admin)).toEqual(["mine", "team", "all"]);
    expect(allowedRunsViews(people)).toEqual(["mine", "team", "all"]);
  });
});

describe("resolveRunsView (views a viewer cannot hold, shape 2)", () => {
  it("renders the requested view when held", () => {
    expect(resolveRunsView("team", manager)).toEqual({ view: "team", notice: null, strip: false });
    expect(resolveRunsView("all", admin)).toEqual({ view: "all", notice: null, strip: false });
    expect(resolveRunsView("own", member)).toEqual({ view: "mine", notice: null, strip: false });
  });
  it("falls back to My runs with the one notice line when not held", () => {
    expect(resolveRunsView("team", member)).toEqual({ view: "mine", notice: "Team runs is for people who have reports.", strip: true });
    expect(resolveRunsView("all", manager)).toEqual({ view: "mine", notice: "All runs is for the People team and admins.", strip: true });
  });
  it("treats an unknown value as no view at all, with no notice", () => {
    expect(resolveRunsView("bogus", member)).toEqual({ view: "mine", notice: null, strip: true });
    expect(resolveRunsView(null, member)).toEqual({ view: "mine", notice: null, strip: false });
  });
});

describe("effectiveRunStatus and runsSummaryLine", () => {
  it("derives Overdue from the due date and keeps terminal states", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(effectiveRunStatus("ACTIVE", "2026-09-20T00:00:00Z", now)).toBe("OVERDUE");
    expect(effectiveRunStatus("ACTIVE", "2026-09-22T00:00:00Z", now)).toBe("ACTIVE");
    expect(effectiveRunStatus("COMPLETED", "2026-09-20T00:00:00Z", now)).toBe("COMPLETED");
    expect(effectiveRunStatus("CANCELLED", null, now)).toBe("CANCELLED");
    expect(effectiveRunStatus("ACTIVE", null, now)).toBe("ACTIVE");
  });
  it("writes the summary line", () => {
    expect(runsSummaryLine({ ACTIVE: 4, OVERDUE: 1, COMPLETED: 27 })).toBe("4 active · 1 overdue · 27 completed");
    expect(runsSummaryLine({})).toBe("0 active · 0 overdue · 0 completed");
  });
});
