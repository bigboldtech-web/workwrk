import { describe, expect, it } from "vitest";
import { filterGoals, orderGoals, paginate, parseGoalsListQuery, type GoalListRow } from "./goal-list";

const row = (o: Partial<GoalListRow> & { id: string }): GoalListRow => ({
  title: o.id, level: "INDIVIDUAL", ownerId: "u1", endDate: null, createdAt: "2026-01-01", progress: 0, progressSource: "ROLLUP",
  verdict: "on_track", isStale: false, lastCheckInAt: null, ...o,
});

describe("goals list query", () => {
  it("maps the retired params onto one view", () => {
    expect(parseGoalsListQuery(new URLSearchParams("mine=1")).view).toBe("mine");
    expect(parseGoalsListQuery(new URLSearchParams("team=1")).view).toBe("team");
    expect(parseGoalsListQuery(new URLSearchParams("level=company")).view).toBe("company");
    expect(parseGoalsListQuery(new URLSearchParams("view=team&verdict=at_risk,bogus&level=TEAM")).verdicts).toEqual(["at_risk"]);
    expect(parseGoalsListQuery(new URLSearchParams("level=TEAM")).levels).toEqual(["DEPARTMENT"]);
  });
  it("the legacy unpaged list keeps completed goals; the paged one hides old ones by default", () => {
    expect(parseGoalsListQuery(new URLSearchParams("")).includeCompleted).toBe(true);
    expect(parseGoalsListQuery(new URLSearchParams("page=1")).includeCompleted).toBe(false);
  });
  it("hides completed goals from before this quarter only", () => {
    const q = parseGoalsListQuery(new URLSearchParams("page=1"));
    const rows = [
      row({ id: "old", verdict: "completed", endDate: "2026-03-01" }),
      row({ id: "new", verdict: "completed", endDate: "2026-08-01" }),
      row({ id: "open" }),
    ];
    expect(filterGoals(rows, q, { quarterStart: new Date("2026-07-01") }).map((r) => r.id)).toEqual(["new", "open"]);
  });
  it("needs a nudge = at risk, off track or stale", () => {
    const q = parseGoalsListQuery(new URLSearchParams("page=1&nudge=1"));
    const rows = [row({ id: "a", verdict: "at_risk" }), row({ id: "b", isStale: true }), row({ id: "c" })];
    expect(filterGoals(rows, q, { quarterStart: new Date(0) }).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("orders team goals by the person's verdict, unowned last, and pages", () => {
    const rows = [row({ id: "x", ownerId: null }), row({ id: "y", ownerId: "ok", ownerName: "Ann" }), row({ id: "z", ownerId: "bad", ownerName: "Zed" })];
    const out = orderGoals(rows, "team", "due", new Map([["ok", "on_track"], ["bad", "off_track"]]));
    expect(out.map((r) => r.id)).toEqual(["z", "y", "x"]);
    expect(paginate(out, 2, 2)).toEqual({ rows: [out[2]], page: 2, total: 3 });
    expect(paginate(out, 9, 2).page).toBe(2);
  });
});
