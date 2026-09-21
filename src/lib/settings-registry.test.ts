import { describe, expect, it } from "vitest";
import { SETTINGS_PAGE_GATES, SETTINGS_PAGE_KEYS } from "./access/settings";
import {
  SETTINGS_PAGES,
  SETTINGS_PAGE_LIST,
  SETTINGS_ENTRY_LIST,
  filterSettingsEntries,
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
    expect(resolveSettingsPage("/home")).toBeNull();
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
  it("returnTo, else lastAppPath, else the Work landing", () => {
    expect(resolveCloseTarget({ returnTo: "/boards/x?item=1", lastAppPath: "/inbox" })).toBe("/boards/x?item=1");
    expect(resolveCloseTarget({ returnTo: null, lastAppPath: "/inbox" })).toBe("/inbox");
    // SETTINGS_FALLBACK_HREF is WORK_HOME_HREF, which is /home as of Phase 2
    // Stage C. It was /today, which was itself a redirect into the viewer's
    // first Space, so closing Settings landed you in somebody's project list.
    expect(resolveCloseTarget({})).toBe("/home");
  });
  it("never returns into the takeover or to a foreign origin", () => {
    expect(resolveCloseTarget({ returnTo: "/settings/members", lastAppPath: "/docs" })).toBe("/docs");
    expect(resolveCloseTarget({ returnTo: "/account/profile", lastAppPath: "/account/security" })).toBe("/home");
    expect(resolveCloseTarget({ returnTo: "//evil.example", lastAppPath: "https://evil.example" })).toBe("/home");
  });
  it("knows the three takeover prefixes and nothing else", () => {
    expect(isSettingsRoute("/settings")).toBe(true);
    expect(isSettingsRoute("/settings/members")).toBe(true);
    expect(isSettingsRoute("/account/profile")).toBe(true);
    // /imports renders inside the takeover until it 308s into
    // /settings/data?tab=import (spec-shell 2.8).
    expect(isSettingsRoute("/imports")).toBe(true);
    expect(isSettingsRoute("/settingsx")).toBe(false);
    expect(isSettingsRoute("/accounting")).toBe(false);
    expect(isSettingsRoute("/importsx")).toBe(false);
  });
});

// ── Per-setting entries (spec-process section 4) ──────────────────

describe("SETTINGS_ENTRY_LIST", () => {
  it("registers the three acknowledgement defaults in the workspace door", () => {
    const ids = SETTINGS_ENTRY_LIST.map((e) => e.id);
    expect(ids).toContain("process.ack.statement");
    expect(ids).toContain("process.ack.dueDays");
    expect(ids).toContain("process.ack.remindDays");
    for (const e of SETTINGS_ENTRY_LIST) expect(e.door).toBe("workspace");
  });

  it("points each one at the Organize page's defaults tab, anchored on its own id", () => {
    for (const e of SETTINGS_ENTRY_LIST) {
      if (!e.id.startsWith("process.ack.")) continue;
      expect(e.href).toBe(`/sops/manage?tab=defaults#${e.id}`);
    }
  });

  it("carries manage_process as the external gate, because the control is outside the door", () => {
    for (const e of SETTINGS_ENTRY_LIST) {
      if (!e.id.startsWith("process.ack.")) continue;
      expect(e.externalGate).toBe("manage_process");
    }
  });

  it("has unique ids", () => {
    const ids = SETTINGS_ENTRY_LIST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filterSettingsEntries", () => {
  it("lists nothing externally gated until the caller says the viewer holds the verb", () => {
    expect(filterSettingsEntries("acknowledge")).toEqual([]);
    expect(filterSettingsEntries("acknowledge", { allowedExternalGates: ["manage_process"] }).length).toBe(3);
  });

  it("matches on label, description, id and keyword", () => {
    const opts = { allowedExternalGates: ["manage_process"] as const };
    expect(filterSettingsEntries("statement", opts).map((e) => e.id)).toEqual(["process.ack.statement"]);
    expect(filterSettingsEntries("due date", opts).map((e) => e.id)).toEqual(["process.ack.remindDays"]);
    expect(filterSettingsEntries("process.ack.dueDays", opts).map((e) => e.id)).toEqual(["process.ack.dueDays"]);
    expect(filterSettingsEntries("nudge", opts).map((e) => e.id)).toEqual(["process.ack.remindDays"]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    const opts = { allowedExternalGates: ["manage_process"] as const };
    expect(filterSettingsEntries("  REMINDER ", opts).map((e) => e.id)).toEqual(["process.ack.remindDays"]);
  });

  it("filters by door", () => {
    const opts = { allowedExternalGates: ["manage_process"] as const };
    expect(filterSettingsEntries("", { ...opts, door: "me" })).toEqual([]);
    expect(filterSettingsEntries("", { ...opts, door: "workspace" }).length).toBe(3);
  });
});
