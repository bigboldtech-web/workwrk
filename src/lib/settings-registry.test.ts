import { describe, expect, it } from "vitest";
import { SETTINGS_PAGE_GATES, SETTINGS_PAGE_KEYS } from "./access/settings";
import {
  SETTINGS_PAGES,
  SETTINGS_PAGE_LIST,
  filterSettingsPages,
  resolveSettingsPage,
  settingsAliasRedirects,
  settingsHrefToday,
  settingsSidebar,
} from "./settings-registry";
import { resolveCloseTarget, isSettingsRoute } from "./settings-nav";

describe("settings registry", () => {
  it("has exactly one row per SettingsPageKey, with the gate copied from the access table", () => {
    expect(SETTINGS_PAGE_LIST.map((p) => p.key).sort()).toEqual([...SETTINGS_PAGE_KEYS].sort());
    for (const p of SETTINGS_PAGE_LIST) expect(p.gate).toBe(SETTINGS_PAGE_GATES[p.key]);
  });
  it("lists the 14 workspace pages and 6 personal pages in section-1 order (the two 'All settings' indexes are generated, not pages)", () => {
    expect(SETTINGS_PAGE_LIST.filter((p) => p.door === "workspace")).toHaveLength(14);
    expect(SETTINGS_PAGE_LIST.filter((p) => p.door === "me")).toHaveLength(6);
    expect(SETTINGS_PAGE_LIST.filter((p) => p.door === "me").map((p) => p.href)).toEqual([
      "/account/profile",
      "/account/preferences",
      "/account/notifications",
      "/account/security",
      "/account/connections",
      "/account/shortcuts",
    ]);
  });
  it("never repeats an href or an alias", () => {
    const hrefs = SETTINGS_PAGE_LIST.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const aliases = SETTINGS_PAGE_LIST.flatMap((p) => p.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) expect(hrefs).not.toContain(a);
  });
  it("labels are the spec's canon", () => {
    expect(SETTINGS_PAGES.identity.label).toBe("Identity & culture");
    expect(SETTINGS_PAGES.tasks.label).toBe("Task system");
    expect(SETTINGS_PAGES["account/connections"].label).toBe("Calendar & connections");
  });
});

describe("resolveSettingsPage", () => {
  it("answers for canonical, today's and alias URLs", () => {
    expect(resolveSettingsPage("/settings")?.key).toBe("overview");
    expect(resolveSettingsPage("/settings/members")?.key).toBe("members");
    expect(resolveSettingsPage("/settings/members/abc")?.key).toBe("members");
    expect(resolveSettingsPage("/settings/tags")?.key).toBe("tasks");
    expect(resolveSettingsPage("/settings/task-types")?.key).toBe("tasks");
    expect(resolveSettingsPage("/settings/permissions")?.key).toBe("access");
    expect(resolveSettingsPage("/settings/hierarchy")?.key).toBe("structure");
    expect(resolveSettingsPage("/settings/modules")?.key).toBe("apps");
    expect(resolveSettingsPage("/settings/notifications")?.key).toBe("account/notifications");
    expect(resolveSettingsPage("/account/appearance")?.key).toBe("account/preferences");
    expect(resolveSettingsPage("/settings/calendar")?.key).toBe("account/connections");
    expect(resolveSettingsPage("/settings/integrations")?.key).toBe("api");
    expect(resolveSettingsPage("/settings/import-export")?.key).toBe("data");
    expect(resolveSettingsPage("/settings/defaults")?.key).toBe("identity");
  });
  it("uses the tab for query-conditioned aliases and ignores unrelated tabs", () => {
    expect(resolveSettingsPage("/settings", "?tab=themes")?.key).toBe("account/preferences");
    expect(resolveSettingsPage("/settings", "?tab=shortcuts")?.key).toBe("account/shortcuts");
    expect(resolveSettingsPage("/settings", "?tab=nope")?.key).toBe("overview");
  });
  it("returns null outside settings", () => {
    expect(resolveSettingsPage("/today")).toBeNull();
    expect(resolveSettingsPage("")).toBeNull();
  });
});

describe("today's hrefs and the sidebar", () => {
  it("points every navigable row at a route that renders today", () => {
    const today = SETTINGS_PAGE_LIST.map((p) => settingsHrefToday(p));
    expect(today).toContain("/account/appearance");
    expect(today).toContain("/settings/notifications");
    expect(today).toContain("/settings/task-types");
    expect(settingsHrefToday(SETTINGS_PAGES["account/shortcuts"])).toBeNull();
    expect(settingsHrefToday(SETTINGS_PAGES.security)).toBeNull();
  });
  it("hides unbuilt pages from the sidebar unless asked", () => {
    expect(settingsSidebar("workspace").map((p) => p.key)).not.toContain("security");
    expect(settingsSidebar("workspace", { includeUnbuilt: true }).map((p) => p.key)).toContain("security");
    expect(settingsSidebar("me").map((p) => p.key)).not.toContain("account/shortcuts");
  });
  it("filters by label, keyword, group and alias", () => {
    expect(filterSettingsPages("2fa").map((p) => p.key)).toEqual(["account/security"]);
    expect(filterSettingsPages("tags", "workspace").map((p) => p.key)).toEqual(["tasks"]);
    expect(filterSettingsPages("billing").map((p) => p.key)).toEqual(["billing"]);
    expect(filterSettingsPages("").length).toBe(SETTINGS_PAGE_LIST.length);
    expect(filterSettingsPages("zzz")).toEqual([]);
  });
  it("derives the 8.4 redirect rows from the aliases", () => {
    const rows = settingsAliasRedirects();
    expect(rows).toContainEqual({ source: "/settings/permissions", destination: "/settings/access" });
    expect(rows).toContainEqual({ source: "/settings/tags", destination: "/settings/tasks" });
    expect(rows).toContainEqual({ source: "/account/appearance", destination: "/account/preferences" });
    expect(rows.every((r) => !r.source.includes("?"))).toBe(true);
  });
});

describe("closeSettings origin rule", () => {
  it("returnTo, else lastAppPath, else /today", () => {
    expect(resolveCloseTarget({ returnTo: "/boards/x?item=1", lastAppPath: "/inbox" })).toBe("/boards/x?item=1");
    expect(resolveCloseTarget({ returnTo: null, lastAppPath: "/inbox" })).toBe("/inbox");
    expect(resolveCloseTarget({})).toBe("/today");
  });
  it("never returns into the takeover or to a foreign origin", () => {
    expect(resolveCloseTarget({ returnTo: "/settings/members", lastAppPath: "/docs" })).toBe("/docs");
    expect(resolveCloseTarget({ returnTo: "/account/profile", lastAppPath: "/account/security" })).toBe("/today");
    expect(resolveCloseTarget({ returnTo: "//evil.example", lastAppPath: "https://evil.example" })).toBe("/today");
  });
  it("knows the two takeover prefixes and nothing else", () => {
    expect(isSettingsRoute("/settings")).toBe(true);
    expect(isSettingsRoute("/settings/members")).toBe(true);
    expect(isSettingsRoute("/account/profile")).toBe(true);
    expect(isSettingsRoute("/settingsx")).toBe(false);
    expect(isSettingsRoute("/accounting")).toBe(false);
    expect(isSettingsRoute("/imports")).toBe(false);
  });
});
