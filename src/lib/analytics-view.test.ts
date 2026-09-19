import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PERIODS,
  ANALYTICS_SCOPES,
  ANALYTICS_TILES,
  allowedAnalyticsScopes,
  analyticsScopeAllowed,
  deltaOf,
  formatTileValue,
  parseAnalyticsScope,
  periodDays,
  periodLabel,
  personName,
  viewerAnalyticsFacts,
  weekKeyOf,
  weekLabel,
  weekSeries,
} from "./analytics-view";
import type { Viewer } from "./access/types";

function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    userId: "u_me",
    organizationId: "org_1",
    orgRole: "MEMBER",
    isAgent: false,
    adminScopes: [],
    ...over,
  };
}

const IC = { isOrgAdmin: false, onPeopleTeam: false, hasReports: false };
const MANAGER = { isOrgAdmin: false, onPeopleTeam: false, hasReports: true };
const PEOPLE = { isOrgAdmin: false, onPeopleTeam: true, hasReports: false };
const ADMIN = { isOrgAdmin: true, onPeopleTeam: false, hasReports: false };

describe("parseAnalyticsScope", () => {
  it("defaults to the viewer's own chain", () => {
    expect(parseAnalyticsScope(null)).toBe("team");
    expect(parseAnalyticsScope(undefined)).toBe("team");
    expect(parseAnalyticsScope("")).toBe("team");
    expect(parseAnalyticsScope("nonsense")).toBe("team");
    expect(parseAnalyticsScope("team")).toBe("team");
  });

  it("accepts the three words a link might carry for org-wide", () => {
    expect(parseAnalyticsScope("org")).toBe("org");
    expect(parseAnalyticsScope("all")).toBe("org");
    expect(parseAnalyticsScope("Everyone")).toBe("org");
    expect(parseAnalyticsScope("  ORG  ")).toBe("org");
  });
});

describe("analyticsScopeAllowed: access 5.2.1 reports-people-team-admin", () => {
  it("gives an IC nothing: they never reach the page at all", () => {
    expect(analyticsScopeAllowed("team", IC)).toBe(false);
    expect(analyticsScopeAllowed("org", IC)).toBe(false);
    expect(allowedAnalyticsScopes(IC)).toEqual([]);
  });

  it("gives a manager their chain and nothing wider", () => {
    expect(analyticsScopeAllowed("team", MANAGER)).toBe(true);
    expect(analyticsScopeAllowed("org", MANAGER)).toBe(false);
    expect(allowedAnalyticsScopes(MANAGER)).toEqual(["team"]);
  });

  it("gives the People team and admins both scopes", () => {
    expect(allowedAnalyticsScopes(PEOPLE)).toEqual(["team", "org"]);
    expect(allowedAnalyticsScopes(ADMIN)).toEqual(["team", "org"]);
  });

  it("returns scopes in pill order so the views row cannot reorder itself", () => {
    expect(ANALYTICS_SCOPES.map((s) => s.key)).toEqual(["team", "org"]);
    expect(allowedAnalyticsScopes(ADMIN)).toEqual(ANALYTICS_SCOPES.map((s) => s.key));
  });
});

describe("viewerAnalyticsFacts", () => {
  it("reads admin off the org role", () => {
    expect(viewerAnalyticsFacts(viewer({ orgRole: "OWNER" }), []).isOrgAdmin).toBe(true);
    expect(viewerAnalyticsFacts(viewer({ orgRole: "ADMIN" }), []).isOrgAdmin).toBe(true);
    expect(viewerAnalyticsFacts(viewer({ orgRole: "MEMBER" }), []).isOrgAdmin).toBe(false);
  });

  it("reads hasReports off a non-empty report tree, never off a title", () => {
    expect(viewerAnalyticsFacts(viewer(), []).hasReports).toBe(false);
    expect(viewerAnalyticsFacts(viewer({ reportTree: new Set() }), []).hasReports).toBe(false);
    expect(viewerAnalyticsFacts(viewer({ reportTree: new Set(["u_a"]) }), []).hasReports).toBe(true);
  });

  it("reads People team off the id list the org facts carry", () => {
    expect(viewerAnalyticsFacts(viewer(), ["u_other"]).onPeopleTeam).toBe(false);
    expect(viewerAnalyticsFacts(viewer(), ["u_me"]).onPeopleTeam).toBe(true);
  });
});

describe("periodDays / periodLabel", () => {
  it("maps every declared period", () => {
    for (const p of ANALYTICS_PERIODS) {
      expect(periodDays(p.key)).toBe(p.days);
      expect(periodLabel(p.key)).toBe(p.label);
    }
  });

  it("falls back to Last 30 days for missing and unknown", () => {
    expect(periodDays(null)).toBe(30);
    expect(periodDays("century")).toBe(30);
    expect(periodLabel(undefined)).toBe("Last 30 days");
  });
});

describe("ANALYTICS_TILES", () => {
  it("is the spec's five, in order", () => {
    expect(ANALYTICS_TILES.map((t) => t.label)).toEqual([
      "Open tasks",
      "Completed",
      "Overdue",
      "Hours logged",
      "SOPs acknowledged",
    ]);
  });

  it("colours exactly one tile's delta, and it is the one where a rise is bad", () => {
    const danger = ANALYTICS_TILES.filter((t) => t.deltaMeaning === "danger");
    expect(danger).toHaveLength(1);
    expect(danger[0].key).toBe("overdue");
  });

  it("marks the point-in-time count as having no previous window", () => {
    expect(ANALYTICS_TILES.find((t) => t.key === "openTasks")!.comparable).toBe(false);
    for (const t of ANALYTICS_TILES.filter((x) => x.key !== "openTasks")) {
      expect(t.comparable).toBe(true);
    }
  });

  it("formats hours to one decimal and counts whole", () => {
    const hours = ANALYTICS_TILES.find((t) => t.key === "hoursLogged")!;
    const open = ANALYTICS_TILES.find((t) => t.key === "openTasks")!;
    expect(formatTileValue(hours, 12.25)).toBe("12.3");
    expect(formatTileValue(hours, 0)).toBe("0.0");
    expect(formatTileValue(open, 7)).toBe("7");
    expect(formatTileValue(open, Number.NaN)).toBe("0");
  });
});

describe("deltaOf", () => {
  it("is null when there is no base to compare against", () => {
    expect(deltaOf(5, 0)).toBeNull();
    expect(deltaOf(0, 0)).toBeNull();
  });

  it("is null when nothing changed, so the tile prints no delta row", () => {
    expect(deltaOf(10, 10)).toBeNull();
  });

  it("reports direction and a rounded percentage", () => {
    expect(deltaOf(12, 10)).toEqual({ pct: 20, direction: "up" });
    expect(deltaOf(8, 10)).toEqual({ pct: -20, direction: "down" });
    expect(deltaOf(11, 9)).toEqual({ pct: 22, direction: "up" });
  });

  it("survives non-finite inputs rather than printing NaN%", () => {
    expect(deltaOf(Number.NaN, 4)).toBeNull();
    expect(deltaOf(4, Number.NaN)).toBeNull();
    expect(deltaOf(Number.POSITIVE_INFINITY, 4)).toBeNull();
  });
});

describe("weekKeyOf", () => {
  it("returns the Monday of the week, for every day of that week", () => {
    // 2026-09-14 is a Monday.
    const monday = "2026-09-14";
    for (let d = 14; d <= 20; d += 1) {
      expect(weekKeyOf(new Date(2026, 8, d, 12))).toBe(monday);
    }
  });

  it("puts Sunday at the END of its week, not the start", () => {
    // 2026-09-20 is a Sunday: it belongs to the week beginning the 14th.
    expect(weekKeyOf(new Date(2026, 8, 20, 23, 30))).toBe("2026-09-14");
    // The next day, Monday, opens a new week.
    expect(weekKeyOf(new Date(2026, 8, 21, 0, 30))).toBe("2026-09-21");
  });

  it("uses local parts, so a late-evening completion cannot slip a week", () => {
    const late = new Date(2026, 8, 20, 23, 59, 59);
    const early = new Date(2026, 8, 14, 0, 0, 1);
    expect(weekKeyOf(late)).toBe(weekKeyOf(early));
  });

  it("crosses a month and a year boundary", () => {
    expect(weekKeyOf(new Date(2026, 9, 1, 9))).toBe("2026-09-28");
    // 2027-01-01 is a Friday, so its week opened on Monday 2026-12-28.
    expect(weekKeyOf(new Date(2027, 0, 1, 9))).toBe("2026-12-28");
  });

  it("zero-pads so the keys sort as strings", () => {
    expect(weekKeyOf(new Date(2026, 0, 8))).toBe("2026-01-05");
  });
});

describe("weekSeries", () => {
  it("includes every week in the window, oldest first, with no gaps", () => {
    const out = weekSeries(new Date(2026, 8, 1), new Date(2026, 8, 30));
    expect(out[0]).toBe("2026-08-31");
    expect(out).toEqual([...out].sort());
    expect(new Set(out).size).toBe(out.length);
    // Consecutive Mondays, seven days apart.
    for (let i = 1; i < out.length; i += 1) {
      const [a, b] = [out[i - 1], out[i]].map((k) => {
        const [y, m, d] = k.split("-").map(Number);
        return new Date(y, m - 1, d).getTime();
      });
      expect(b - a).toBe(7 * 86_400_000);
    }
  });

  it("always covers the end of the window", () => {
    const to = new Date(2026, 8, 30);
    expect(weekSeries(new Date(2026, 8, 1), to)).toContain(weekKeyOf(to));
  });

  it("returns one week when from and to are the same day", () => {
    const d = new Date(2026, 8, 16);
    expect(weekSeries(d, d)).toEqual(["2026-09-14"]);
  });

  it("stays bounded on an absurd range rather than looping forever", () => {
    const out = weekSeries(new Date(2000, 0, 1), new Date(2026, 0, 1));
    expect(out.length).toBeLessThanOrEqual(61);
  });
});

describe("weekLabel", () => {
  it("renders a short day and month", () => {
    expect(weekLabel("2026-09-14")).toMatch(/14/);
    expect(weekLabel("2026-09-14")).toMatch(/Sep/);
  });

  it("hands back anything it cannot parse rather than printing Invalid Date", () => {
    expect(weekLabel("not-a-week")).toBe("not-a-week");
    expect(weekLabel("")).toBe("");
  });
});

describe("personName", () => {
  it("joins the two parts and trims", () => {
    expect(personName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(personName({ firstName: "Ada", lastName: null })).toBe("Ada");
    expect(personName({ firstName: null, lastName: "Lovelace" })).toBe("Lovelace");
  });

  it("never renders an empty cell", () => {
    expect(personName({ firstName: null, lastName: null })).toBe("Unnamed");
    expect(personName({ firstName: "  ", lastName: "  " })).toBe("Unnamed");
  });
});
