import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSOLE_PREFS,
  DRAWER_WIDTH_DEFAULT,
  MAX_RECENTS,
  clampDrawerWidth,
  mergeConsolePrefs,
  pushRecent,
  readConsolePrefs,
  validateConsolePatch,
} from "./console-prefs";

const ID = (n: number) => `cmcompany${String(n).padStart(8, "0")}`;

describe("readConsolePrefs", () => {
  it("reads null, junk and arrays as the defaults, never throws", () => {
    expect(readConsolePrefs(null)).toEqual(DEFAULT_CONSOLE_PREFS);
    expect(readConsolePrefs("x")).toEqual(DEFAULT_CONSOLE_PREFS);
    expect(readConsolePrefs([1, 2])).toEqual(DEFAULT_CONSOLE_PREFS);
    expect(readConsolePrefs({ sidebar: "yes", companies: 3, recent: "abc" })).toEqual(DEFAULT_CONSOLE_PREFS);
  });
  it("keeps valid stored values and clamps the drawer", () => {
    const p = readConsolePrefs({
      sidebar: { collapsed: true },
      companies: { drawerWidth: 9000, columns: ["plan", "status", "plan", "bad key!"] },
      audit: { columns: [] },
      recent: [ID(1), "../etc", ID(1), ID(2)],
    });
    expect(p.sidebar.collapsed).toBe(true);
    expect(p.companies.drawerWidth).toBe(720);
    expect(p.companies.columns).toEqual(["plan", "status"]);
    expect(p.audit.columns).toEqual([]);
    expect(p.recent).toEqual([ID(1), ID(2)]);
  });
  it("caps a stored recent list at five", () => {
    const p = readConsolePrefs({ recent: [1, 2, 3, 4, 5, 6, 7].map(ID) });
    expect(p.recent).toHaveLength(MAX_RECENTS);
  });
});

describe("clampDrawerWidth", () => {
  it("clamps to 480..720 and rounds", () => {
    expect(clampDrawerWidth(100)).toBe(480);
    expect(clampDrawerWidth(1000)).toBe(720);
    expect(clampDrawerWidth(600.4)).toBe(600);
    expect(clampDrawerWidth(Number.NaN)).toBe(DRAWER_WIDTH_DEFAULT);
  });
});

describe("validateConsolePatch", () => {
  it("refuses a non-object and any unknown key", () => {
    expect(validateConsolePatch(null).ok).toBe(false);
    expect(validateConsolePatch([]).ok).toBe(false);
    const r = validateConsolePatch({ theme: "dark" });
    expect(r).toEqual({ ok: false, error: "Unknown setting: theme" });
  });
  it("never accepts a product preference such as density", () => {
    expect(validateConsolePatch({ density: "compact" }).ok).toBe(false);
  });
  it("checks every type", () => {
    expect(validateConsolePatch({ sidebar: { collapsed: "yes" } }).ok).toBe(false);
    expect(validateConsolePatch({ companies: { drawerWidth: "wide" } }).ok).toBe(false);
    expect(validateConsolePatch({ companies: { columns: "plan" } }).ok).toBe(false);
    expect(validateConsolePatch({ audit: { columns: 3 } }).ok).toBe(false);
    expect(validateConsolePatch({ recent: "x" }).ok).toBe(false);
    expect(validateConsolePatch({ openedCompany: "not an id!" }).ok).toBe(false);
  });
  it("passes a good patch through, clamped", () => {
    expect(validateConsolePatch({ sidebar: { collapsed: true }, companies: { drawerWidth: 10 } })).toEqual({
      ok: true,
      patch: { sidebar: { collapsed: true }, companies: { drawerWidth: 480 } },
    });
    expect(validateConsolePatch({ companies: { columns: null } })).toEqual({ ok: true, patch: { companies: { columns: null } } });
    expect(validateConsolePatch({ openedCompany: ID(3) })).toEqual({ ok: true, patch: { openedCompany: ID(3) } });
  });
});

describe("pushRecent", () => {
  it("puts the company first, removes its older copy, keeps five", () => {
    expect(pushRecent([ID(1), ID(2)], ID(2))).toEqual([ID(2), ID(1)]);
    expect(pushRecent([1, 2, 3, 4, 5].map(ID), ID(9))).toEqual([ID(9), ID(1), ID(2), ID(3), ID(4)]);
  });
});

describe("mergeConsolePrefs", () => {
  it("changes only the named keys and returns a new object", () => {
    const cur = readConsolePrefs({ companies: { drawerWidth: 600, columns: ["plan"] }, recent: [ID(1)] });
    const next = mergeConsolePrefs(cur, { sidebar: { collapsed: true } });
    expect(next).not.toBe(cur);
    expect(next.sidebar.collapsed).toBe(true);
    expect(next.companies).toEqual({ drawerWidth: 600, columns: ["plan"] });
    expect(next.recent).toEqual([ID(1)]);
    expect(cur.sidebar.collapsed).toBe(false);
  });
  it("applies openedCompany on top of the stored recents", () => {
    const cur = readConsolePrefs({ recent: [ID(1), ID(2)] });
    expect(mergeConsolePrefs(cur, { openedCompany: ID(2) }).recent).toEqual([ID(2), ID(1)]);
  });
});
