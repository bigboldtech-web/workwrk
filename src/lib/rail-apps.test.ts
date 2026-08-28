import { describe, expect, it, vi } from "vitest";
import type { AppEntry } from "../components/layout/os/apps-catalog";

// The real apps-catalog module cannot load in vitest's node environment —
// its transitive component graph imports through the "@/" alias, which this
// vitest config does not resolve (the tested src/lib modules avoid aliases
// for the same reason). So the catalog is mocked with a FAITHFUL MIRROR of
// canAccessTier's ladder plus a synthetic APPS array. If the ladder in
// apps-catalog.tsx ever changes, update the mirror below to match.
vi.mock("../components/layout/os/apps-catalog", () => {
  const MANAGER_LEVELS = new Set([
    "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR",
    "MANAGER", "TEAM_LEAD", "HR",
  ]);
  const HR_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "HR"]);
  const ORG_ADMIN_LEVELS = new Set(["SUPER_ADMIN", "COMPANY_ADMIN"]);

  function canAccessTier(tier: string | undefined, accessLevel: string | null | undefined): boolean {
    if (!tier) return true;
    if (!accessLevel) return false;
    if (tier === "manager") return MANAGER_LEVELS.has(accessLevel);
    if (tier === "hr-admin") return HR_ADMIN_LEVELS.has(accessLevel);
    return ORG_ADMIN_LEVELS.has(accessLevel);
  }
  function canAccessApp(app: { requiredAccess?: string }, accessLevel: string | null | undefined): boolean {
    return canAccessTier(app.requiredAccess, accessLevel);
  }

  const stub = (key: string, extra?: Record<string, unknown>) => ({
    key,
    label: key,
    Icon: () => null,
    defaultHref: `/${key}`,
    matchPaths: [`/${key}`],
    Sidebar: () => null,
    ...extra,
  });

  // Mirrors the real catalog's shape in miniature: an alwaysPinned Home,
  // open apps, a manager-gated app, and an hr-admin-gated app.
  const APPS = [
    stub("home", { alwaysPinned: true }),
    stub("planner"),
    stub("docs"),
    stub("teams", { requiredAccess: "manager" }),
    stub("reviews", { requiredAccess: "hr-admin" }),
    stub("more-tile", { hideFromCatalog: true }),
  ];

  // rail-apps re-exports this for its consumers; the mock must define every
  // named export rail-apps imports or vitest rejects the import.
  const isAlwaysPinned = (key: string) =>
    APPS.some((a) => a.key === key && "alwaysPinned" in a);

  return { canAccessTier, canAccessApp, isAlwaysPinned, APPS };
});

import { orderedCatalogForAdmin, parseOrgAppsConfig, visibleRailApps } from "./rail-apps";
import { APPS } from "../components/layout/os/apps-catalog";

const keys = (apps: AppEntry[]) => apps.map((a) => a.key);

describe("parseOrgAppsConfig", () => {
  it("returns {} for non-object shapes", () => {
    expect(parseOrgAppsConfig(null)).toEqual({});
    expect(parseOrgAppsConfig(undefined)).toEqual({});
    expect(parseOrgAppsConfig("apps")).toEqual({});
    expect(parseOrgAppsConfig(42)).toEqual({});
    expect(parseOrgAppsConfig(["home"])).toEqual({});
  });

  it("keeps well-formed keys and drops malformed ones", () => {
    expect(parseOrgAppsConfig({
      order: ["docs", "home"],
      hidden: ["planner"],
      minAccess: { docs: "manager" },
    })).toEqual({
      order: ["docs", "home"],
      hidden: ["planner"],
      minAccess: { docs: "manager" },
    });

    // order is not an array -> dropped; non-string members filtered out.
    expect(parseOrgAppsConfig({
      order: "docs",
      hidden: [1, "planner", null],
      minAccess: ["nope"],
    })).toEqual({ hidden: ["planner"] });
  });

  it("drops minAccess values outside the tier vocabulary", () => {
    // "bogus" must not survive: canAccessTier would treat it as org-admin.
    expect(parseOrgAppsConfig({
      minAccess: { docs: "bogus", planner: "manager", teams: 7 },
    })).toEqual({ minAccess: { planner: "manager" } });
  });
});

describe("visibleRailApps", () => {
  it("empty config = catalog order, gated only by the catalog baseline", () => {
    expect(keys(visibleRailApps({ config: {}, accessLevel: "SUPER_ADMIN" })))
      .toEqual(["home", "planner", "docs", "teams", "reviews", "more-tile"]);
    // EMPLOYEE never sees manager/hr-admin apps — org config or not.
    expect(keys(visibleRailApps({ config: {}, accessLevel: "EMPLOYEE" })))
      .toEqual(["home", "planner", "docs", "more-tile"]);
  });

  it("hidden removes an app for everyone, but alwaysPinned is immune", () => {
    const config = { hidden: ["planner", "home"] };
    expect(keys(visibleRailApps({ config, accessLevel: "SUPER_ADMIN" })))
      .toEqual(["home", "docs", "teams", "reviews", "more-tile"]);
  });

  it("minAccess floors on top of the baseline and never weakens it", () => {
    // Floor an open app at manager: EMPLOYEE loses it, TEAM_LEAD keeps it.
    const floored = { minAccess: { docs: "manager" } };
    expect(keys(visibleRailApps({ config: floored, accessLevel: "EMPLOYEE" })))
      .toEqual(["home", "planner", "more-tile"]);
    expect(keys(visibleRailApps({ config: floored, accessLevel: "TEAM_LEAD" })))
      .toContain("docs");

    // "Weakening" attempt: reviews requires hr-admin; an org floor of
    // manager must NOT open it to a plain manager tier.
    const weakened = { minAccess: { reviews: "manager" } };
    expect(keys(visibleRailApps({ config: weakened, accessLevel: "TEAM_LEAD" })))
      .not.toContain("reviews");
    expect(keys(visibleRailApps({ config: weakened, accessLevel: "HR" })))
      .toContain("reviews");
  });

  it("alwaysPinned apps cannot be floored", () => {
    const config = { minAccess: { home: "org-admin" } };
    expect(keys(visibleRailApps({ config, accessLevel: "EMPLOYEE" })))
      .toContain("home");
  });

  it("orders by config.order, ignores unknown keys, appends the rest in catalog order", () => {
    const config = { order: ["ghost-app", "docs", "planner", "docs"] };
    expect(keys(visibleRailApps({ config, accessLevel: "SUPER_ADMIN" })))
      .toEqual(["docs", "planner", "home", "teams", "reviews", "more-tile"]);
  });

  it("never renders empty: alwaysPinned survives a hide-everything config", () => {
    const config = {
      hidden: ["home", "planner", "docs", "teams", "reviews", "more-tile"],
      minAccess: { planner: "org-admin", docs: "org-admin" },
    };
    expect(keys(visibleRailApps({ config, accessLevel: "EMPLOYEE" })))
      .toEqual(["home"]);
  });

  it("never renders empty: even a catalog with no alwaysPinned falls back to the baseline", () => {
    const bare = APPS.filter((a) => !a.alwaysPinned);
    const config = { hidden: bare.map((a) => a.key), order: ["docs", "planner"] };
    const out = visibleRailApps({ config, accessLevel: "EMPLOYEE", apps: bare });
    // hidden/minAccess are abandoned, baseline + order kept.
    expect(keys(out)).toEqual(["docs", "planner", "more-tile"]);
  });
});

describe("orderedCatalogForAdmin", () => {
  it("lists every manageable app (no access filter) in org order with flags", () => {
    const rows = orderedCatalogForAdmin({
      order: ["reviews", "ghost-app", "docs"],
      hidden: ["planner"],
      minAccess: { docs: "manager" },
    });
    expect(rows.map((r) => r.app.key))
      .toEqual(["reviews", "docs", "home", "planner", "teams"]);
    expect(rows.find((r) => r.app.key === "planner")).toMatchObject({ hidden: true });
    expect(rows.find((r) => r.app.key === "docs")).toMatchObject({ hidden: false, minAccess: "manager" });
    expect(rows.find((r) => r.app.key === "reviews")).toMatchObject({ hidden: false, minAccess: null });
  });

  it("excludes hideFromCatalog tiles", () => {
    const rows = orderedCatalogForAdmin({});
    expect(rows.map((r) => r.app.key)).not.toContain("more-tile");
  });

  it("reports the EFFECTIVE state for alwaysPinned apps even under stale config", () => {
    const rows = orderedCatalogForAdmin({
      hidden: ["home"],
      minAccess: { home: "org-admin" },
    });
    expect(rows.find((r) => r.app.key === "home"))
      .toMatchObject({ hidden: false, minAccess: null });
  });
});

describe("visibleRailApps — premium module gating", () => {
  // Build a catalog with a real module key ("tables") so the module filter
  // (which imports the real lib/modules registry) actually engages.
  const mk = (key: string, extra: Record<string, unknown> = {}) =>
    ({
      key,
      label: key,
      Icon: () => null,
      defaultHref: `/${key}`,
      matchPaths: [`/${key}`],
      Sidebar: () => null,
      ...extra,
    }) as unknown as AppEntry;
  const withModule = [mk("home", { alwaysPinned: true }), mk("planner"), mk("tables")];

  it("hides a premium module until it is active", () => {
    const out = keys(visibleRailApps({ config: {}, accessLevel: "SUPER_ADMIN", apps: withModule }));
    expect(out).toContain("home");
    expect(out).toContain("planner");
    expect(out).not.toContain("tables");
  });

  it("shows a premium module once it is active", () => {
    const out = keys(
      visibleRailApps({
        config: {},
        accessLevel: "SUPER_ADMIN",
        apps: withModule,
        activeModules: new Set(["tables"]),
      }),
    );
    expect(out).toContain("tables");
  });

  it("keeps the module hidden even through the empty-rail fallback", () => {
    // No alwaysPinned app + everything hidden forces the last-ditch resolve;
    // it must NOT resurface an inactive module.
    const noPin = [mk("planner"), mk("tables")];
    const out = keys(
      visibleRailApps({
        config: { hidden: ["planner", "tables"] },
        accessLevel: "SUPER_ADMIN",
        apps: noPin,
      }),
    );
    expect(out).toEqual(["planner"]);
    expect(out).not.toContain("tables");
  });
});
