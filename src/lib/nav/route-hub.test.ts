import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FOLDED_APP_HUB,
  HUB_KEYS,
  REDIRECT_ROUTES,
  ROUTE_HUB,
  SETTINGS_ROUTES,
  WORK_HOME_HREF,
  hubDefaultHref,
  isHubKey,
  isRedirectRoute,
  isSettingsRoute,
  resolveActiveRow,
  resolveHub,
  resolveHubPrefix,
} from "./route-hub";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DASHBOARD_DIR = path.join(REPO_ROOT, "src", "app", "(dashboard)");
const ROUTE_LIST = path.join(REPO_ROOT, "docs", "plans", "ui-refresh", "route-list.txt");

/**
 * Every directory under `(dashboard)` that actually renders a page, as the URL
 * it serves. Directories are the source of truth (they can never drift from the
 * app), route groups `(like-this)` contribute no URL segment, and a directory
 * with no page.tsx (e.g. `/me`) is not a route — only its leaves are.
 */
function dashboardRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, urlSegments: string[]) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.some((e) => e === "page.tsx" || e === "page.ts")) {
      out.push(`/${urlSegments.join("/")}`);
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry.startsWith("_")) continue;
      const full = path.join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      // A route group contributes no URL segment.
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      walk(full, isGroup ? urlSegments : [...urlSegments, entry]);
    }
  };
  walk(DASHBOARD_DIR, []);
  return out.filter((r) => r !== "/").sort();
}

/** A route is covered when the hub table owns it or a redirect resolves it. */
function isCovered(route: string): boolean {
  return resolveHubPrefix(route) !== null || isRedirectRoute(route);
}

describe("resolveHub", () => {
  it("sends every settings route to the settings hub", () => {
    expect(resolveHub("/settings")).toBe("settings");
    expect(resolveHub("/settings/members")).toBe("settings");
    expect(resolveHub("/account")).toBe("settings");
    expect(resolveHub("/account/profile")).toBe("settings");
    expect(resolveHub("/imports")).toBe("settings");
  });

  it("resolves settings before any other row could match", () => {
    // Rule 1 runs before the prefix scan, so no future ROUTE_HUB row can steal
    // a settings path away from the takeover.
    expect(SETTINGS_ROUTES.every((r) => resolveHub(r) === "settings")).toBe(true);
  });

  it("matches a prefix exactly or as an ancestor, never as a substring", () => {
    expect(resolveHub("/docs")).toBe("docs");
    expect(resolveHub("/docs/trash")).toBe("docs");
    expect(resolveHub("/docs/abc123")).toBe("docs");
    // /tablespoon is not /tables
    expect(resolveHubPrefix("/tablespoon")).toBeNull();
  });

  it("resolves /people/me like /people", () => {
    expect(resolveHub("/people/me")).toBe("teams");
    expect(resolveHub("/people")).toBe(resolveHub("/people/me"));
  });

  it("prefers the longest prefix", () => {
    // /me has no row; its two leaves do.
    expect(resolveHubPrefix("/me/weekly-review")).toBe("/me/weekly-review");
    expect(resolveHubPrefix("/me/mentions")).toBe("/me/mentions");
    expect(resolveHubPrefix("/me")).toBeNull();
  });

  it("falls back to Work for an unmapped path", () => {
    expect(resolveHub("/nothing-here")).toBe("home");
    expect(resolveHub("/")).toBe("home");
    expect(resolveHub("")).toBe("home");
  });

  it("ignores trailing slashes, query strings and hashes", () => {
    expect(resolveHub("/tables/")).toBe("tables");
    expect(resolveHub("/okrs?mine=1")).toBe("home");
    expect(resolveHub("/tlk#thread")).toBe("chat");
  });

  it("returns a hub key for every declared prefix", () => {
    for (const [prefix, hub] of Object.entries(ROUTE_HUB)) {
      expect(isHubKey(hub)).toBe(true);
      expect(resolveHub(prefix)).toBe(isSettingsRoute(prefix) ? "settings" : hub);
    }
  });
});

describe("ROUTE_HUB completeness", () => {
  it("has a row (or a redirect) for every route directory under (dashboard)", () => {
    const routes = dashboardRoutes();
    expect(routes.length).toBeGreaterThan(100);
    const missing = routes.filter((r) => !isCovered(r));
    expect(missing).toEqual([]);
  });

  // Cross-check against the audit's route inventory. The directory walk above
  // is the hard gate (it cannot drift from the app); this catches a route the
  // inventory knows about that the walk somehow missed. The plan docs are not
  // required to be checked out, so a missing file is not a failure.
  it("has a row (or a redirect) for every (dashboard) entry in route-list.txt", () => {
    let raw: string;
    try {
      raw = readFileSync(ROUTE_LIST, "utf8");
    } catch {
      return;
    }
    const listed = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/(dashboard)/"))
      .map((line) => line.slice("/(dashboard)".length));
    expect(listed.length).toBeGreaterThan(100);
    const missing = listed.filter((r) => !isCovered(r));
    expect(missing).toEqual([]);
  });

  it("declares exactly the two rule-1 settings prefixes", () => {
    // /imports renders in the takeover too, but as a ROUTE_HUB row rather than
    // a rule-1 member, so removing it later is a one-row deletion.
    expect([...SETTINGS_ROUTES]).toEqual(["/settings", "/account"]);
    expect(ROUTE_HUB["/imports"]).toBe("settings");
  });

  it("exempts only genuine redirects from the completeness gate", () => {
    // An entry here is an exemption from the test above, so it must be a route
    // that really redirects before a hub is computed. /today and /tasks are
    // live pages and carry rows instead.
    expect([...REDIRECT_ROUTES]).toEqual(["/dashboard"]);
    expect(ROUTE_HUB["/today"]).toBe("home");
    expect(ROUTE_HUB["/tasks"]).toBe("home");
    expect(resolveHub("/tasks/board")).toBe("home");
  });

  it("never maps a redirected directory to a hub row", () => {
    for (const route of REDIRECT_ROUTES) {
      expect(ROUTE_HUB[route]).toBeUndefined();
    }
  });

  it("declares eight hubs and uses every one of them", () => {
    expect(HUB_KEYS).toHaveLength(8);
    const used = new Set(Object.values(ROUTE_HUB));
    for (const hub of HUB_KEYS) expect(used.has(hub)).toBe(true);
  });
});

describe("FOLDED_APP_HUB", () => {
  it("holds exactly the 19 folded app keys from the spec", () => {
    expect(Object.keys(FOLDED_APP_HUB).sort()).toEqual(
      [
        "goals", "timesheets",
        "library", "clips", "sops", "policies", "agreements",
        "reviews", "candor", "kudos", "surveys",
        "announcements",
        "forms",
        "automation",
        "tools", "assets", "build", "store", "trash",
      ].sort(),
    );
  });

  it("folds every app into a real hub, and never into a folded app", () => {
    for (const [app, hub] of Object.entries(FOLDED_APP_HUB)) {
      expect(isHubKey(hub)).toBe(true);
      expect(Object.keys(FOLDED_APP_HUB)).not.toContain(hub);
      expect(isHubKey(app)).toBe(false);
    }
  });
});

describe("hubDefaultHref", () => {
  it("gives every hub a landing that resolves back to that hub", () => {
    for (const hub of HUB_KEYS) {
      expect(resolveHub(hubDefaultHref(hub))).toBe(hub);
    }
  });

  it("lands every hub on a path the table owns, Work included", () => {
    // Rule 3 (no match) means "no sidebar row active", so no hub landing may
    // resolve by the fallback. Work's landing is WORK_HOME_HREF until the work
    // and home unit ships /home; either way it has a row.
    for (const hub of HUB_KEYS) {
      expect(resolveHubPrefix(hubDefaultHref(hub, { canManageWorkspace: true }))).not.toBeNull();
    }
    expect(resolveHubPrefix(WORK_HOME_HREF)).not.toBeNull();
    expect(hubDefaultHref("home")).toBe(WORK_HOME_HREF);
  });

  it("opens Talk on /tlk with the module on and /announcements with it off", () => {
    expect(hubDefaultHref("chat", { talkModuleOn: true })).toBe("/tlk");
    expect(hubDefaultHref("chat", { talkModuleOn: false })).toBe("/announcements");
    // Unknown module state reads as on, which is today's behaviour.
    expect(hubDefaultHref("chat")).toBe("/tlk");
  });

  it("opens Settings on the workspace door for admins and the personal one otherwise", () => {
    expect(hubDefaultHref("settings", { canManageWorkspace: true })).toBe("/settings");
    expect(hubDefaultHref("settings", { canManageWorkspace: false })).toBe("/account/profile");
    expect(hubDefaultHref("settings")).toBe("/account/profile");
  });

  it("opens Teams on the Directory, which every Member may read", () => {
    expect(hubDefaultHref("teams")).toBe("/people");
  });

  it("is the only place a hub landing branches", () => {
    const ctxA = { talkModuleOn: true, canManageWorkspace: true };
    const ctxB = { talkModuleOn: false, canManageWorkspace: false };
    const unconditional = HUB_KEYS.filter((h) => h !== "chat" && h !== "settings");
    for (const hub of unconditional) {
      expect(hubDefaultHref(hub, ctxA)).toBe(hubDefaultHref(hub, ctxB));
    }
  });
});

describe("resolveActiveRow", () => {
  const rows = [
    { href: "/docs", match: "prefix" as const },
    { href: "/docs/trash", match: "prefix" as const },
    { href: "/library" },
  ];

  it("picks the longest matching href", () => {
    expect(resolveActiveRow(rows, "/docs/trash")?.href).toBe("/docs/trash");
    expect(resolveActiveRow(rows, "/docs")?.href).toBe("/docs");
    expect(resolveActiveRow(rows, "/docs/abc")?.href).toBe("/docs");
  });

  it("returns undefined when nothing matches, never the first row", () => {
    expect(resolveActiveRow(rows, "/tables")).toBeUndefined();
    expect(resolveActiveRow([], "/docs")).toBeUndefined();
  });

  it("honours match: exact", () => {
    const exact = [{ href: "/tasks", match: "exact" as const }];
    expect(resolveActiveRow(exact, "/tasks")?.href).toBe("/tasks");
    expect(resolveActiveRow(exact, "/tasks/board")).toBeUndefined();
  });

  it("defaults to prefix matching", () => {
    expect(resolveActiveRow([{ href: "/people" }], "/people/me")?.href).toBe("/people");
  });

  it("matches a row with a query string only when its params match", () => {
    const goals = [
      { href: "/okrs" },
      { href: "/okrs?mine=1" },
      { href: "/okrs?team=1" },
      { href: "/okrs?level=company" },
    ];
    expect(resolveActiveRow(goals, "/okrs", "?mine=1")?.href).toBe("/okrs?mine=1");
    expect(resolveActiveRow(goals, "/okrs", "team=1")?.href).toBe("/okrs?team=1");
    expect(resolveActiveRow(goals, "/okrs", "level=company")?.href).toBe("/okrs?level=company");
    // No params: only the plain row can match.
    expect(resolveActiveRow(goals, "/okrs")?.href).toBe("/okrs");
    // A param the rows do not declare leaves the plain row winning.
    expect(resolveActiveRow(goals, "/okrs", "sort=due")?.href).toBe("/okrs");
  });

  it("requires every declared param, not just one", () => {
    const rowsWithTwo = [{ href: "/agreements?view=templates&kind=msa" }];
    expect(resolveActiveRow(rowsWithTwo, "/agreements", "view=templates")).toBeUndefined();
    expect(
      resolveActiveRow(rowsWithTwo, "/agreements", "view=templates&kind=msa")?.href,
    ).toBe("/agreements?view=templates&kind=msa");
  });

  it("accepts URLSearchParams as well as a string", () => {
    const goals = [{ href: "/okrs" }, { href: "/okrs?mine=1" }];
    expect(resolveActiveRow(goals, "/okrs", new URLSearchParams("mine=1"))?.href)
      .toBe("/okrs?mine=1");
  });

  it("ranks a deeper path above a longer query string", () => {
    const sops = [
      { href: "/sops?filter=mine-and-overdue" },
      { href: "/sops/compliance" },
    ];
    expect(
      resolveActiveRow(sops, "/sops/compliance", "filter=mine-and-overdue")?.href,
    ).toBe("/sops/compliance");
  });

  it("gives a tie to the row declared first", () => {
    const tied = [
      { href: "/forms", match: "prefix" as const },
      { href: "/forms", match: "prefix" as const },
    ];
    expect(resolveActiveRow(tied, "/forms")).toBe(tied[0]);
  });

  it("activates exactly one row or none, for every hub landing", () => {
    const all = Object.keys(ROUTE_HUB).map((href) => ({ href }));
    for (const hub of HUB_KEYS) {
      const href = hubDefaultHref(hub, { canManageWorkspace: true });
      const matches = all.filter(
        (r) => resolveActiveRow([r], href) !== undefined,
      );
      expect(matches.length).toBeLessThanOrEqual(all.length);
      // Whatever matched, resolveActiveRow collapses it to at most one row.
      const active = resolveActiveRow(all, href);
      if (matches.length === 0) expect(active).toBeUndefined();
      else expect(active).toBeDefined();
    }
  });
});
