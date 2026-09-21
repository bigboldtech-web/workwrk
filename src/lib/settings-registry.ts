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

// ─────────────────────────────────────────────────────────────────
// Per-SETTING entries (settings-architecture section 8.2, the door's
// "Find a setting" field; spec-process section 4 registers the first three).
//
// The table above answers "which PAGE is this URL". This one answers "where
// does one named setting live", which is a different question the moment a
// setting stops living on a settings page. `externalGate` is the field that
// makes that honest: a setting rendered on a product page carries the org
// verb that page checks, so the door can hide a row the viewer could not act
// on rather than sending them to a 404.
//
// Every row is FINDABLE FROM THE DOOR and NOT DUPLICATED IN IT. The three
// acknowledgement defaults belong on /sops/manage, the Organize page the
// People team already uses for SOP folders and tags; putting a second editor
// for them inside /settings would be two writers for one value, which is the
// drift this registry exists to end. The hrefs are the ones spec-process
// section 4 registers verbatim.
//
// THESE THREE HREFS ARE AHEAD OF THEIR PAGE, and that is deliberate rather
// than an oversight. /sops/manage exists and answers, but it has no `?tab=`
// switcher and no `#process.ack.*` cards yet: both arrive with the Organize
// rebuild (spec-process section 2 `/sops/manage`, step 6), which also adds
// the `defaults` tab and the hash-scroll. Until then a row that followed one
// of these would land on the Organize page with an inert parameter, not on a
// 404. NOTHING RENDERS THEM TODAY: `filterSettingsEntries` has no caller, and
// the settings door that will list them is the settings unit's own step. The
// order matters: the tab ships before the door starts listing these rows, or
// the door would offer three destinations that do not scroll anywhere.

import type { OrgAction } from "./access/types";

export interface SettingEntry {
  /** Stable id, also the fragment the href anchors on. */
  id: string;
  door: SettingsDoor;
  /** The one label for this setting, in the door and on the page. */
  label: string;
  /** One line for the search result row. */
  description: string;
  /** Where the control actually is. May be outside /settings and /account. */
  href: string;
  /** The settings page this belongs to, when it is on one. */
  page?: SettingsPageKey;
  /** Search terms beyond the label. */
  keywords: string[];
  /**
   * For a setting that lives OUTSIDE the settings door: the org verb the
   * hosting page checks. Declared, not enforced here (the same contract as
   * `gate` above); the door reads it to decide whether to list the row.
   */
  externalGate?: OrgAction;
}

function entry(e: SettingEntry): SettingEntry {
  return e;
}

/** Every individually-addressable setting the door can find. */
export const SETTINGS_ENTRY_LIST: readonly SettingEntry[] = [
  // spec-process section 2 (/sops/manage) and section 4: the acknowledgement
  // defaults a new SOP or policy assignment inherits.
  entry({
    id: "process.ack.statement",
    door: "workspace",
    label: "Attestation statement",
    description: "The sentence a person confirms when they acknowledge a SOP or a policy.",
    href: "/sops/manage?tab=defaults#process.ack.statement",
    keywords: ["acknowledge", "attestation", "sop", "policy", "statement", "confirm", "process"],
    externalGate: "manage_process",
  }),
  entry({
    id: "process.ack.dueDays",
    door: "workspace",
    label: "Acknowledgement due after",
    description: "How many days a person gets to acknowledge, counted from the day it is assigned.",
    href: "/sops/manage?tab=defaults#process.ack.dueDays",
    keywords: ["acknowledge", "due", "deadline", "days", "sop", "policy", "process"],
    externalGate: "manage_process",
  }),
  entry({
    id: "process.ack.remindDays",
    door: "workspace",
    label: "Acknowledgement reminder",
    description: "How many days before the due date the reminder goes out.",
    href: "/sops/manage?tab=defaults#process.ack.remindDays",
    keywords: ["acknowledge", "reminder", "nudge", "days", "sop", "policy", "process"],
    externalGate: "manage_process",
  }),
];

export const SETTINGS_ENTRIES: Readonly<Record<string, SettingEntry>> = Object.fromEntries(
  SETTINGS_ENTRY_LIST.map((e) => [e.id, e]),
);

/**
 * The door's "Find a setting" rows for one query.
 *
 * `allowedExternalGates` is what the CALLER already decided with `can()`: an
 * entry whose `externalGate` is not in that set is left out, because a row
 * that lands on a page the viewer gets a 404 from is worse than no row. An
 * entry with no `externalGate` is on a settings page and is gated by that
 * page, so it is always listed here.
 */
export function filterSettingsEntries(
  query: string,
  opts: { door?: SettingsDoor; allowedExternalGates?: readonly OrgAction[] } = {},
): SettingEntry[] {
  const q = query.trim().toLowerCase();
  const allowed = opts.allowedExternalGates ?? [];
  return SETTINGS_ENTRY_LIST.filter((e) => {
    if (opts.door && e.door !== opts.door) return false;
    if (e.externalGate && !allowed.includes(e.externalGate)) return false;
    if (!q) return true;
    if (e.label.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if (e.id.toLowerCase().includes(q)) return true;
    return e.keywords.some((k) => k.includes(q));
  });
}
