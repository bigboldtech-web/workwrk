import { describe, expect, it } from "vitest";
import { APP_RULES } from "@/lib/access/settings";
import {
  TEAMS_ROWS,
  TEAMS_SEARCH_THRESHOLD,
  teamsActiveHref,
  teamsActivePath,
  teamsRowCount,
  visibleTeamsRows,
  type TeamsViewer,
} from "./teams-rows";

const member: TeamsViewer = { userId: "me", orgRole: "MEMBER", isAgent: false, hasReports: false, peopleTeam: false };
const agent: TeamsViewer = { ...member, isAgent: true };
const manager: TeamsViewer = { ...member, hasReports: true };
const peopleTeam: TeamsViewer = { ...member, peopleTeam: true };
const admin: TeamsViewer = { ...member, orgRole: "ADMIN" };
const guest: TeamsViewer = { ...member, orgRole: "GUEST" };
const keys = (v: TeamsViewer) => visibleTeamsRows(v).map((r) => r.key);

describe("the Teams sidebar: 20 rows, in the spec's order", () => {
  it("prints the sidebar-map section 5 table", () => {
    expect(TEAMS_ROWS.map((r) => r.label)).toEqual([
      "My profile", "My team", "Workload", "Directory", "Org chart", "Departments", "Job titles", "Skills",
      "KRAs & KPIs", "Alignment", "KPI reviews", "Weekly reviews", "Review cycles", "Talent (9-box)", "Analytics",
      "Kudos", "Candor", "Surveys", "Tools", "Assets",
    ]);
  });

  it("every gated row names a real APP_RULES key", () => {
    for (const r of TEAMS_ROWS) if (r.app) expect(APP_RULES[r.app], r.key).toBeTruthy();
  });

  it("icons are unique inside the set (Scale vs Gauge, CalendarCheck vs ClipboardCheck)", () => {
    const icons = TEAMS_ROWS.map((r) => r.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(TEAMS_ROWS.find((r) => r.key === "weekly-reviews")?.icon).toBe("CalendarCheck");
    expect(TEAMS_ROWS.find((r) => r.key === "workload")?.icon).toBe("Scale");
  });

  it("retires the Rollup row: /team/rollup is the Sub-teams view of Alignment", () => {
    expect(TEAMS_ROWS.some((r) => r.href === "/team/rollup")).toBe(false);
  });
});

describe("who sees which row", () => {
  it("a plain Member sees nine rows (ten when targeted by a survey), so no search field", () => {
    expect(keys(member)).toEqual(["profile", "directory", "org", "departments", "titles", "skills", "kra-kpi", "kudos", "tools"]);
    expect(keys({ ...member, surveyTargeted: true })).toContain("surveys");
    expect(visibleTeamsRows({ ...member, surveyTargeted: true }).length).toBeLessThanOrEqual(TEAMS_SEARCH_THRESHOLD);
  });

  it("an Agent sees what a Member sees and never a manager row", () => {
    expect(keys(agent)).toEqual(keys(member));
  });

  it("an invited Member gets Candor (they respond), nobody else without reports does", () => {
    expect(keys(member)).not.toContain("candor");
    expect(keys({ ...member, candorInvited: true })).toContain("candor");
  });

  it("the People team and Admins see all 20 rows; a manager sees Surveys only when targeted", () => {
    for (const v of [peopleTeam, admin]) {
      expect(keys(v)).toHaveLength(20);
    }
    // Surveys follows access 5.2.1 (People team and Admin create; targeted
    // Members respond), so a manager in no audience has nothing to open.
    expect(keys(manager)).toHaveLength(19);
    expect(keys({ ...manager, surveyTargeted: true })).toHaveLength(20);
    expect(visibleTeamsRows(admin).length).toBeGreaterThan(TEAMS_SEARCH_THRESHOLD);
  });

  it("Assets follows its APP_RULES audience alone (the page is on the app-key gate)", () => {
    expect(keys(manager)).toContain("assets");
    expect(keys(member)).not.toContain("assets");
  });

  it("a Guest sees nothing: the Teams hub is never shown to a Guest", () => {
    expect(keys(guest)).toEqual([]);
  });

  it("a manager whose last report moved away loses the manager rows the moment hasReports is false", () => {
    expect(keys({ ...manager, hasReports: false })).toEqual(keys(member));
  });
});

describe("the active row follows the URL", () => {
  it("/people/{me} lights My profile, /people/{someone} lights the Directory", () => {
    expect(teamsActiveHref("/people/me", "", "me")).toBe("/people/me");
    expect(teamsActiveHref("/people/me", "", "u1")).toBe("/people/me");
    expect(teamsActiveHref("/people/u1", "", "u1")).toBe("/people/me");
    expect(teamsActiveHref("/people/u2", "", "u1")).toBe("/people");
    expect(teamsActiveHref("/people/u2", "tab=kras", "u1")).toBe("/people");
    expect(teamsActiveHref("/people", "", "u1")).toBe("/people");
  });

  it("the static /people children are never taken for an id", () => {
    expect(teamsActivePath("/people/departments", "u1")).toBe("/people/departments");
    expect(teamsActiveHref("/people/roles/r1", "", "u1")).toBe("/people/roles");
    expect(teamsActiveHref("/people/skills", "", "u1")).toBe("/people/skills");
  });

  it("/team/rollup lights Alignment, and /team lights only My team", () => {
    expect(teamsActiveHref("/team/rollup", "", "u1")).toBe("/team/alignment");
    expect(teamsActiveHref("/team", "", "u1")).toBe("/team");
    expect(teamsActiveHref("/team/workload", "", "u1")).toBe("/team/workload");
    expect(teamsActiveHref("/team/reviews", "", "u1")).toBe("/team/reviews");
  });

  it("detail pages light their list row", () => {
    expect(teamsActiveHref("/reviews/c1", "", "u1")).toBe("/reviews");
    expect(teamsActiveHref("/candor/s1", "", "u1")).toBe("/candor");
    expect(teamsActiveHref("/surveys/s1", "", "u1")).toBe("/surveys");
    expect(teamsActiveHref("/kra-kpi", "new=kpi", "u1")).toBe("/kra-kpi");
  });
});

describe("row counts ride the boot counts", () => {
  const counts = { weeklyReviews: 2, kpiReviews: 3, reviewForms: 1, candorOpen: 0, surveysOpen: 4 };
  it("My team is weekly reviews plus KPI sign-offs", () => {
    expect(teamsRowCount(TEAMS_ROWS.find((r) => r.key === "team")!, counts)).toBe(5);
  });
  it("each badge reads its own key, and a row without one reads 0", () => {
    const byKey = Object.fromEntries(TEAMS_ROWS.map((r) => [r.key, teamsRowCount(r, counts)]));
    expect(byKey["weekly-reviews"]).toBe(2);
    expect(byKey["kpi-reviews"]).toBe(3);
    expect(byKey.reviews).toBe(1);
    expect(byKey.surveys).toBe(4);
    expect(byKey.directory).toBe(0);
  });
});

describe("the Teams breadcrumb trail (route-hub resolveCrumbTrail)", () => {
  it("My team is a sibling of the /team pages, and Sub-teams sits under Alignment", async () => {
    const { resolveCrumbTrail } = await import("./route-hub");
    expect(resolveCrumbTrail("/team")).toEqual([{ label: "My team" }]);
    expect(resolveCrumbTrail("/team/alignment")).toEqual([{ label: "Alignment" }]);
    expect(resolveCrumbTrail("/team/kpi-reviews")).toEqual([{ label: "KPI reviews" }]);
    expect(resolveCrumbTrail("/team/rollup")).toEqual([{ label: "Alignment", href: "/team/alignment" }, { label: "Sub-teams" }]);
    expect(resolveCrumbTrail("/people")).toEqual([{ label: "Directory" }]);
    expect(resolveCrumbTrail("/people/departments")).toEqual([{ label: "Directory", href: "/people" }, { label: "Departments" }]);
  });
});
