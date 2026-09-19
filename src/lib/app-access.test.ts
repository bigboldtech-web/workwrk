import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ACCESS } from "./app-access";
import { visibleRailApps } from "./rail-apps";
import { WORK_HOME_HREF } from "./nav/route-hub";

// rail-apps.ts imports the client catalog for its APPS default; that module's
// alias graph does not load in vitest (see rail-apps.test.ts). The resolver
// under test is handed APP_ACCESS explicitly, so a bare mock is enough.
vi.mock("../components/layout/os/apps-catalog", () => ({
  APPS: [],
  canAccessTier: () => true,
  canAccessApp: () => true,
  isAlwaysPinned: () => false,
}));

/**
 * Parse the catalog SOURCE (it cannot be imported here: "use client" plus the
 * "@/" alias graph) and extract exactly the fields the mirror carries. If a
 * catalog entry gains, loses or changes `requiredAccess` / `alwaysPinned`, or
 * an entry is added, removed or reordered, this test names the drift.
 */
function catalogFromSource() {
  const file = join(__dirname, "../components/layout/os/apps-catalog.tsx");
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("export const APPS: AppEntry[] = [");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n];", start);
  const body = src.slice(start, end);
  const chunks = body.split(/\n\s*(?=\{\s*key:\s*")/).slice(1);
  return chunks.map((chunk) => {
    const key = chunk.match(/^\{\s*key:\s*"([^"]+)"/)![1];
    const label = chunk.match(/label:\s*"([^"]*)"/)![1];
    // `defaultHref` is a literal on every entry but Work, which reads the one
    // WORK_HOME_HREF constant so the Work landing flips in a single place
    // (Phase 2 W0). Resolve the identifier against the real export, so this
    // test still compares the catalog against the mirror rather than against
    // a string that is now spelled two ways.
    const literal = chunk.match(/defaultHref:\s*"([^"]*)"/)?.[1];
    const ident = chunk.match(/defaultHref:\s*([A-Z_][A-Z0-9_]*)\s*,/)?.[1];
    if (literal === undefined && ident !== "WORK_HOME_HREF") {
      throw new Error(`apps-catalog entry "${key}" has a defaultHref this test cannot read`);
    }
    const defaultHref = literal ?? WORK_HOME_HREF;
    // The entry's own requiredAccess: the first one that appears before any
    // createActions block (create actions carry their own tier).
    const head = chunk.split("createActions")[0];
    const tier = head.match(/requiredAccess:\s*"([^"]+)"/)?.[1];
    const alwaysPinned = /alwaysPinned:\s*true/.test(head);
    return { key, label, defaultHref, requiredAccess: tier, alwaysPinned: alwaysPinned || undefined };
  });
}

describe("APP_ACCESS mirrors apps-catalog.tsx", () => {
  it("has the same entries, in the same order, with the same access fields", () => {
    const fromSource = catalogFromSource();
    const mirror = APP_ACCESS.map((a) => ({
      key: a.key,
      label: a.label,
      defaultHref: a.defaultHref,
      requiredAccess: a.requiredAccess,
      alwaysPinned: a.alwaysPinned || undefined,
    }));
    expect(mirror).toEqual(fromSource);
  });

  it("stamps hubKey on the 19 folded apps and on nothing else", () => {
    const folded = APP_ACCESS.filter((a) => a.hubKey).map((a) => a.key).sort();
    expect(folded).toHaveLength(19);
    const hubs = APP_ACCESS.filter((a) => !a.hubKey).map((a) => a.key);
    expect(hubs).toEqual(["home", "planner", "ai", "chat", "teams", "docs", "tables", "settings"]);
  });

  it("resolves the same rail through visibleRailApps for the server", () => {
    const asEmployee = { config: {}, accessLevel: "EMPLOYEE", apps: APP_ACCESS };
    const employee = visibleRailApps({ ...asEmployee, activeModules: new Set(["chat"]) });
    expect(employee.map((a) => a.key)).toEqual(["home", "planner", "ai", "chat", "docs", "settings"]);
    // Talk off: the hub stays on the rail for a Member because Announcements does.
    const employeeTalkOff = visibleRailApps({ ...asEmployee, activeModules: new Set() });
    expect(employeeTalkOff.map((a) => a.key)).toEqual(["home", "planner", "ai", "chat", "docs", "settings"]);
    const admin = visibleRailApps({ config: { order: ["settings", "home"] }, accessLevel: "COMPANY_ADMIN", apps: APP_ACCESS, activeModules: new Set(["chat", "tables"]) });
    expect(admin.map((a) => a.key)).toEqual(["settings", "home", "planner", "ai", "chat", "teams", "docs", "tables"]);
    const launcher = visibleRailApps({ ...asEmployee, activeModules: new Set(), includeFolded: true });
    expect(launcher.map((a) => a.key)).toContain("goals");
    expect(launcher.map((a) => a.key)).not.toContain("tables"); // module off
    expect(launcher.map((a) => a.key)).not.toContain("forms"); // folded into Tables: goes with the module
    // Module off, but Announcements is read by every Member (sidebar-map 4
    // row 4), so the Talk hub survives on it and the row stays reachable.
    expect(launcher.map((a) => a.key)).toContain("chat");
    expect(launcher.map((a) => a.key)).toContain("announcements");
    expect(launcher.map((a) => a.key)).not.toContain("reviews"); // hr-admin
  });
});
