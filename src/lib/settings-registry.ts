// Settings page registry (settings-architecture.md sections 1, 8.2, 9).
//
// ONE table of every settings page in both doors. It drives sidebar labels,
// page titles, breadcrumbs, the door filter and Overview search, so a label
// can only ever be written once. Keys are `SettingsPageKey` from the access
// lib's rule table; the gate is DECLARED here (`gate`, copied from
// SETTINGS_PAGE_GATES so the two tables cannot drift) but NOT enforced: who
// may open which page is unchanged in this step, and the gate work
// (`gatePage` over this registry) is a later one.
//
// Two hrefs per page: `href` is the canonical URL from the spec's IA, and
// `todayHref` is where that page's content renders TODAY when the canonical
// route does not exist yet (undefined = canonical exists; null = nothing
// renders it yet, so the row is not navigable). Every old URL is an alias, so
// `resolveSettingsPage(pathname)` answers for every link in the product and
// the 8.4 redirects are just the alias rows whose targets exist.
//
// Pure: imports types and one pure table from src/lib/access (no can()).

import type { SettingsPageKey } from "./access/types";
import { SETTINGS_PAGE_GATES, type PageGate } from "./access/settings";

export type SettingsDoor = "me" | "workspace";

export type WorkspaceGroup = "Workspace" | "People" | "Work" | "Security & data" | "Billing";

export interface SettingsPage {
  door: SettingsDoor;
  key: SettingsPageKey;
  label: string;
  /** Canonical URL (the spec's IA). */
  href: string;
  /** Where the content renders today, when `href` is not a route yet. */
  todayHref?: string | null;
  /** Sidebar group (Workspace door only). */
  group?: WorkspaceGroup;
  /** Old URLs that mean this page (with an optional tab). */
  aliases: string[];
  /** Search terms beyond the label. */
  keywords: string[];
  /** Declared, not enforced (see header). */
  gate: PageGate;
  /** Tabs the page owns, in order (`?tab=`). */
  tabs?: string[];
}

function page(
  door: SettingsDoor,
  key: SettingsPageKey,
  label: string,
  href: string,
  extra: Partial<Omit<SettingsPage, "door" | "key" | "label" | "href" | "gate">> = {},
): SettingsPage {
  return {
    door,
    key,
    label,
    href,
    aliases: [],
    keywords: [],
    ...extra,
    gate: SETTINGS_PAGE_GATES[key],
  };
}

/** Section 1's two sidebars, in order. */
export const SETTINGS_PAGE_LIST: readonly SettingsPage[] = [
  // ── My settings (flat) ─────────────────────────────────────────
  page("me", "account/profile", "Profile", "/account/profile", {
    keywords: ["name", "avatar", "phone", "photo", "personal"],
  }),
  page("me", "account/preferences", "Preferences", "/account/preferences", {
    todayHref: "/account/appearance",
    tabs: ["appearance", "locale", "sidebar"],
    aliases: ["/account/appearance", "/settings?tab=themes"],
    keywords: ["theme", "appearance", "dark", "density", "accent", "language", "timezone", "sidebar"],
  }),
  page("me", "account/notifications", "Notifications", "/account/notifications", {
    todayHref: "/settings/notifications",
    tabs: ["inbox", "email", "desktop"],
    aliases: ["/settings/notifications"],
    keywords: ["inbox", "email", "mute", "quiet hours", "desktop", "alerts"],
  }),
  page("me", "account/security", "Security", "/account/security", {
    keywords: ["password", "two-factor", "2fa", "mfa", "sessions", "sign out"],
  }),
  page("me", "account/connections", "Calendar & connections", "/account/connections", {
    todayHref: "/settings/calendar",
    aliases: ["/settings/calendar"],
    keywords: ["google calendar", "ics", "feed", "sync", "integrations"],
  }),
  page("me", "account/shortcuts", "Keyboard shortcuts", "/account/shortcuts", {
    todayHref: null,
    aliases: ["/settings?tab=shortcuts"],
    keywords: ["keys", "hotkeys", "chords"],
  }),

  // ── Workspace settings (grouped) ───────────────────────────────
  page("workspace", "overview", "Overview", "/settings", {
    keywords: ["all settings", "workspace"],
  }),
  page("workspace", "identity", "Identity & culture", "/settings/identity", {
    group: "Workspace",
    tabs: ["profile", "culture", "appearance", "danger"],
    aliases: ["/settings/defaults"],
    keywords: ["name", "logo", "domain", "mission", "values", "splash", "defaults", "locks", "branding"],
  }),
  page("workspace", "locale", "Locale & work week", "/settings/locale", {
    group: "Workspace",
    keywords: ["timezone", "currency", "fiscal year", "language", "week start", "capacity"],
  }),
  page("workspace", "apps", "Apps & modules", "/settings/apps", {
    group: "Workspace",
    aliases: ["/settings/modules"],
    keywords: ["modules", "talk", "tables", "rail", "hubs", "automations", "hide", "floor"],
  }),
  page("workspace", "members", "Members", "/settings/members", {
    group: "People",
    tabs: ["people", "guests", "teams", "invites"],
    keywords: ["people", "invite", "guests", "teams", "roles", "deactivate"],
  }),
  page("workspace", "structure", "Structure", "/settings/structure", {
    group: "People",
    tabs: ["departments", "titles", "offices", "orgchart"],
    aliases: ["/settings/hierarchy"],
    keywords: ["departments", "job titles", "offices", "org chart", "reporting", "hierarchy"],
  }),
  page("workspace", "access", "Access", "/settings/access", {
    group: "People",
    todayHref: "/settings/permissions",
    aliases: ["/settings/permissions"],
    keywords: ["permissions", "roles", "people team", "lock it down", "toggles"],
  }),
  page("workspace", "tasks", "Task system", "/settings/tasks", {
    group: "Work",
    todayHref: "/settings/task-types",
    tabs: ["types", "tags", "templates"],
    aliases: ["/settings/task-types", "/settings/tags"],
    keywords: ["task types", "tags", "labels", "templates", "statuses"],
  }),
  page("workspace", "scoring", "Scoring & reviews", "/settings/scoring", {
    group: "Work",
    keywords: ["reviews", "weights", "bands", "cadence", "anchors", "kpi"],
  }),
  page("workspace", "security", "Security", "/settings/security", {
    group: "Security & data",
    todayHref: null,
    tabs: ["signin", "sso", "scim"],
    keywords: ["sign-in policy", "sso", "saml", "scim", "provisioning", "mfa", "sessions"],
  }),
  page("workspace", "data", "Data", "/settings/data", {
    group: "Security & data",
    tabs: ["export", "import", "retention", "trash"],
    aliases: ["/settings/import-export"],
    keywords: ["export", "import", "retention", "privacy", "trash", "compliance", "gdpr"],
  }),
  page("workspace", "audit", "Audit log", "/settings/audit", {
    group: "Security & data",
    keywords: ["activity", "history", "who did what", "log"],
  }),
  page("workspace", "api", "API & webhooks", "/settings/api", {
    group: "Security & data",
    tabs: ["keys", "webhooks", "ai"],
    aliases: ["/settings/integrations"],
    keywords: ["api keys", "webhooks", "tokens", "integrations", "byok", "ai keys"],
  }),
  page("workspace", "billing", "Plan & billing", "/settings/billing", {
    group: "Billing",
    keywords: ["plan", "invoice", "subscription", "seats", "upgrade", "payment"],
  }),
];

export const SETTINGS_PAGES: Record<SettingsPageKey, SettingsPage> = Object.fromEntries(
  SETTINGS_PAGE_LIST.map((p) => [p.key, p]),
) as Record<SettingsPageKey, SettingsPage>;

export const WORKSPACE_GROUP_ORDER: readonly WorkspaceGroup[] = ["Workspace", "People", "Work", "Security & data", "Billing"];

export const DOOR_LABELS: Record<SettingsDoor, string> = {
  me: "My settings",
  workspace: "Workspace settings",
};

/** The href a link should use today: canonical when it exists, else the interim. */
export function settingsHrefToday(p: SettingsPage): string | null {
  if (p.todayHref === null) return null;
  return p.todayHref ?? p.href;
}

function splitPath(input: string): { path: string; tab: string | null } {
  const [path, query = ""] = input.split("?");
  const tab = new URLSearchParams(query).get("tab");
  return { path: path.replace(/\/+$/, "") || "/", tab };
}

/**
 * Which page a URL means: canonical href, today's href, or any alias. Aliases
 * with a `?tab=` (e.g. "/settings?tab=themes") match only when the tab
 * matches; a bare "/settings" is the Overview.
 */
export function resolveSettingsPage(pathname: string, search: string = ""): SettingsPage | null {
  if (!pathname) return null;
  const { path, tab } = splitPath(`${pathname}${search && search.startsWith("?") ? search : search ? `?${search}` : ""}`);
  // Exact tabbed aliases first (they are more specific than a bare path).
  if (tab) {
    for (const p of SETTINGS_PAGE_LIST) {
      for (const a of p.aliases) {
        const s = splitPath(a);
        if (s.tab && s.path === path && s.tab === tab) return p;
      }
    }
  }
  const candidates: { page: SettingsPage; len: number }[] = [];
  for (const p of SETTINGS_PAGE_LIST) {
    const hrefs = [p.href, p.todayHref ?? null, ...p.aliases.filter((a) => !a.includes("?"))].filter((h): h is string => !!h);
    for (const h of hrefs) {
      if (path === h || path.startsWith(`${h}/`)) candidates.push({ page: p, len: h.length });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.len - a.len);
  return candidates[0].page;
}

export function settingsPageTitle(pathname: string, search: string = ""): string | null {
  return resolveSettingsPage(pathname, search)?.label ?? null;
}

/** Sidebar rows for a door, navigable today, in section-1 order. */
export function settingsSidebar(door: SettingsDoor, opts: { includeUnbuilt?: boolean } = {}): SettingsPage[] {
  return SETTINGS_PAGE_LIST.filter((p) => p.door === door && (opts.includeUnbuilt || settingsHrefToday(p) !== null));
}

/** The door filter and Overview search: label, keywords and aliases, case-insensitive. */
export function filterSettingsPages(query: string, door?: SettingsDoor): SettingsPage[] {
  const q = query.trim().toLowerCase();
  const pool = door ? SETTINGS_PAGE_LIST.filter((p) => p.door === door) : SETTINGS_PAGE_LIST;
  if (!q) return [...pool];
  return pool.filter((p) => {
    if (p.label.toLowerCase().includes(q)) return true;
    if (p.keywords.some((k) => k.includes(q))) return true;
    if (p.group && p.group.toLowerCase().includes(q)) return true;
    return p.aliases.some((a) => a.toLowerCase().includes(q));
  });
}

/**
 * The redirect table from settings-architecture.md section 8.4, derived from
 * the aliases: old URL -> canonical URL. `next.config.ts` adds only the rows
 * whose target renders the same content today; the rest wait for their page.
 */
export function settingsAliasRedirects(): { source: string; destination: string }[] {
  const out: { source: string; destination: string }[] = [];
  for (const p of SETTINGS_PAGE_LIST) {
    for (const a of p.aliases) {
      if (a.includes("?")) continue; // query-conditioned rows need `has`; handled by hand
      if (a === p.href) continue;
      out.push({ source: a, destination: p.href });
    }
  }
  return out;
}
