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

/**
 * The page's 20px sidebar glyph, as a Lucide component name. A string, not
 * the component, so this table stays pure and server-importable; the shell
 * maps the name to the icon (src/components/layout/os/settings-shell.tsx).
 */
export type SettingsIconName =
  | "LayoutGrid" | "Building2" | "Globe" | "Boxes" | "Users" | "Network" | "ShieldCheck" | "Shapes"
  | "BarChart3" | "Shield" | "Database" | "FileCheck" | "Key" | "CreditCard" | "List"
  | "CircleUser" | "SlidersHorizontal" | "Bell" | "CalendarCheck" | "Keyboard";

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
  /** Sidebar glyph (Lucide name). */
  icon: SettingsIconName;
  /** Old URLs that mean this page (with an optional tab). */
  aliases: string[];
  /** Other live routes that render inside this page's row (Data owns /imports until S5). */
  alsoActiveOn?: string[];
  /** Search terms beyond the label. */
  keywords: string[];
  /** Declared, not enforced (see header). */
  gate: PageGate;
  /** Tabs the page renders today, in order (`?tab=`); labels in SETTINGS_TAB_LABELS. */
  tabs?: string[];
}

function page(
  door: SettingsDoor,
  key: SettingsPageKey,
  label: string,
  href: string,
  icon: SettingsIconName,
  extra: Partial<Omit<SettingsPage, "door" | "key" | "label" | "href" | "gate" | "icon">> = {},
): SettingsPage {
  return {
    door,
    key,
    label,
    href,
    icon,
    aliases: [],
    keywords: [],
    ...extra,
    gate: SETTINGS_PAGE_GATES[key],
  };
}

/** Section 1's two sidebars, in order. */
export const SETTINGS_PAGE_LIST: readonly SettingsPage[] = [
  // My settings (flat, seven rows)
  page("me", "account/profile", "Profile", "/account/profile", "CircleUser", {
    keywords: ["name", "avatar", "phone", "photo", "personal"],
  }),
  page("me", "account/preferences", "Preferences", "/account/preferences", "SlidersHorizontal", {
    tabs: ["appearance", "region", "sidebar"],
    aliases: ["/account/appearance", "/settings?tab=themes"],
    keywords: ["theme", "appearance", "dark", "density", "accent", "language", "timezone", "sidebar"],
  }),
  page("me", "account/notifications", "Notifications", "/account/notifications", "Bell", {
    tabs: ["inbox", "email", "desktop"],
    aliases: ["/settings/notifications"],
    keywords: ["inbox", "email", "mute", "quiet hours", "desktop", "alerts"],
  }),
  page("me", "account/security", "Security", "/account/security", "ShieldCheck", {
    keywords: ["password", "two step verification", "2fa", "mfa", "sessions", "log out everywhere"],
  }),
  page("me", "account/connections", "Calendar & connections", "/account/connections", "CalendarCheck", {
    aliases: ["/settings/calendar"],
    keywords: ["google calendar", "ics", "feed", "sync", "integrations", "gmail", "google", "ai teammates"],
  }),
  page("me", "account/shortcuts", "Keyboard shortcuts", "/account/shortcuts", "Keyboard", {
    aliases: ["/settings?tab=shortcuts"],
    keywords: ["keys", "hotkeys", "chords"],
  }),
  page("me", "account/all", "All settings", "/account/all", "List", {
    keywords: ["index", "everything", "find"],
  }),

  // Workspace settings (grouped)
  page("workspace", "overview", "Overview", "/settings", "LayoutGrid", {
    keywords: ["workspace", "home"],
  }),
  page("workspace", "identity", "Identity & culture", "/settings/identity", "Building2", {
    group: "Workspace",
    tabs: ["profile", "culture", "appearance", "danger"],
    aliases: ["/settings/defaults"],
    keywords: ["name", "logo", "domain", "mission", "values", "splash", "defaults", "locks", "branding", "density", "theme"],
  }),
  page("workspace", "locale", "Locale & work week", "/settings/locale", "Globe", {
    group: "Workspace",
    keywords: ["timezone", "currency", "fiscal year", "language", "week start", "capacity"],
  }),
  page("workspace", "apps", "Apps & modules", "/settings/apps", "Boxes", {
    group: "Workspace",
    aliases: ["/settings/modules"],
    keywords: ["modules", "talk", "tables", "rail", "hubs", "automations", "hide", "floor", "premium", "google", "gmail", "ai teammates"],
  }),
  page("workspace", "members", "Members", "/settings/members", "Users", {
    group: "People",
    tabs: ["people", "guests", "teams", "pending"],
    keywords: ["people", "invite", "guests", "teams", "roles", "deactivate"],
  }),
  page("workspace", "structure", "Structure", "/settings/structure", "Network", {
    group: "People",
    tabs: ["departments", "titles", "offices", "fields", "chart"],
    // No /settings/hierarchy alias: that URL 308s to /organization, the one
    // org chart (next.config.ts), so search and the resolver agree with it.
    keywords: ["departments", "job titles", "offices", "org chart", "reporting", "hierarchy", "profile fields"],
  }),
  page("workspace", "access", "Access", "/settings/access", "ShieldCheck", {
    group: "People",
    // "Who can do what" is the read-only permission matrix (founder decision
    // 3): every cell from the gate that enforces it (access/permission-matrix.ts).
    tabs: ["settings", "matrix"],
    aliases: ["/settings/permissions"],
    keywords: ["permissions", "roles", "people team", "lock it down", "toggles", "public links"],
  }),
  page("workspace", "tasks", "Task system", "/settings/tasks", "Shapes", {
    group: "Work",
    tabs: ["types", "tags", "templates"],
    aliases: ["/settings/task-types", "/settings/tags"],
    keywords: ["task types", "tags", "labels", "templates", "statuses"],
  }),
  page("workspace", "scoring", "Scoring & reviews", "/settings/scoring", "BarChart3", {
    group: "Work",
    keywords: ["reviews", "weights", "bands", "cadence", "anchors", "kpi"],
  }),
  page("workspace", "security", "Security", "/settings/security", "Shield", {
    group: "Security & data",
    tabs: ["signin", "provisioning"],
    keywords: ["sign-in policy", "sso", "saml", "scim", "provisioning", "mfa", "sessions"],
  }),
  page("workspace", "data", "Data", "/settings/data", "Database", {
    group: "Security & data",
    tabs: ["export", "import", "retention", "trash"],
    aliases: ["/settings/import-export", "/imports"],
    keywords: ["export", "import", "csv", "retention", "privacy", "trash", "compliance", "gdpr", "backup"],
  }),
  page("workspace", "audit", "Audit log", "/settings/audit", "FileCheck", {
    group: "Security & data",
    tabs: ["all", "access", "security", "data", "settings"],
    keywords: ["activity", "history", "who did what", "log"],
  }),
  page("workspace", "api", "API & webhooks", "/settings/api", "Key", {
    group: "Security & data",
    tabs: ["keys"],
    aliases: ["/settings/integrations"],
    keywords: ["api keys", "webhooks", "tokens", "integrations", "byok", "ai keys"],
  }),
  page("workspace", "billing", "Plan & billing", "/settings/billing", "CreditCard", {
    group: "Billing",
    keywords: ["plan", "invoice", "subscription", "seats", "upgrade", "payment"],
  }),
  page("workspace", "all", "All settings", "/settings/all", "List", {
    keywords: ["index", "everything", "find"],
  }),
];

/**
 * settings-architecture 8.4 and spec-account-auth section 0: every old URL
 * and where it 308s to, query preserved. `next.config.ts` carries these
 * rows (it runs before the filesystem in production) and a route-handler
 * twin answers the path-only ones under hot reload. A vitest test holds the
 * three in step: every alias here has a config row, every config row with a
 * settings or account source is listed here.
 *
 * `/settings/hierarchy` goes to /organization (outside the doors) and
 * `/me/mentions` stays a page (it is the only door to doc and SOP mentions
 * until scripts/backfill-mentions.ts runs in production; see next.config.ts).
 */
export interface SettingsRedirect {
  source: string;
  /** Query condition (`has`), when the source is query-matched. */
  query?: { key: string; value: string };
  destination: string;
}

export const SETTINGS_REDIRECTS: readonly SettingsRedirect[] = [
  { source: "/settings/modules", destination: "/settings/apps#modules" },
  { source: "/settings/tags", destination: "/settings/tasks?tab=tags" },
  { source: "/settings/task-types", destination: "/settings/tasks?tab=types" },
  { source: "/settings/defaults", destination: "/settings/identity?tab=appearance" },
  { source: "/settings/hierarchy", destination: "/organization" },
  { source: "/settings/permissions", destination: "/settings/access" },
  { source: "/settings/import-export", destination: "/settings/data?tab=import" },
  { source: "/imports", destination: "/settings/data?tab=import" },
  { source: "/settings/integrations", destination: "/settings/api" },
  { source: "/settings/notifications", destination: "/account/notifications" },
  { source: "/settings/calendar", destination: "/account/connections" },
  { source: "/settings", query: { key: "tab", value: "themes" }, destination: "/account/preferences?tab=appearance" },
  { source: "/settings", query: { key: "tab", value: "shortcuts" }, destination: "/account/shortcuts" },
  { source: "/account", destination: "/account/profile" },
  { source: "/account/appearance", destination: "/account/preferences?tab=appearance" },
];

export const SETTINGS_PAGES: Record<SettingsPageKey, SettingsPage> = Object.fromEntries(
  SETTINGS_PAGE_LIST.map((p) => [p.key, p]),
) as Record<SettingsPageKey, SettingsPage>;

export const WORKSPACE_GROUP_ORDER: readonly WorkspaceGroup[] = ["Workspace", "People", "Work", "Security & data", "Billing"];

export const DOOR_LABELS: Record<SettingsDoor, string> = {
  me: "My settings",
  workspace: "Workspace settings",
};

/**
 * The ONE place a settings tab's label is written (settings-architecture
 * 8.2): each page's tab row and the All settings index both read it through
 * settingsTabs(), so the two can never drift. A test asserts every
 * registry tab has a label here.
 */
export const SETTINGS_TAB_LABELS: Readonly<Partial<Record<SettingsPageKey, Readonly<Record<string, string>>>>> = {
  "account/preferences": { appearance: "Appearance", region: "Language & region", sidebar: "Sidebar" },
  "account/notifications": { inbox: "Inbox", email: "Email", desktop: "Desktop" },
  identity: { profile: "Profile", culture: "Culture", appearance: "Appearance defaults", danger: "Danger zone" },
  structure: { departments: "Departments", titles: "Job titles", offices: "Offices", fields: "Profile fields", chart: "Org chart" },
  tasks: { types: "Task types", tags: "Tags", templates: "Templates" },
  data: { export: "Export", import: "Import", retention: "Retention & privacy", trash: "Trash" },
  access: { settings: "Settings", matrix: "Who can do what" },
  members: { people: "People", guests: "Guests", teams: "Teams", pending: "Pending invites" },
  security: { signin: "Sign-in policy", provisioning: "Provisioning" },
  audit: { all: "All", access: "Access", security: "Security", data: "Data", settings: "Settings" },
  api: { keys: "API keys" },
};

/** A page's tabs as { key, label }, in the registry's order. */
export function settingsTabs(pageKey: SettingsPageKey): { key: string; label: string }[] {
  const p = SETTINGS_PAGES[pageKey];
  const labels = SETTINGS_TAB_LABELS[pageKey] ?? {};
  return (p?.tabs ?? []).map((key) => ({ key, label: labels[key] ?? key }));
}

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
    const hrefs = [p.href, p.todayHref ?? null, ...p.aliases.filter((a) => !a.includes("?")), ...(p.alsoActiveOn ?? [])].filter((h): h is string => !!h);
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
 * The alias rows as redirects (settings-architecture 8.4): old URL to the
 * canonical page. The explicit SETTINGS_REDIRECTS table above carries the
 * exact target (tab, hash); this derived view is what the consistency test
 * compares it with, so an alias can never exist without its redirect.
 */
export function settingsAliasRedirects(): { source: string; destination: string }[] {
  const out: { source: string; destination: string }[] = [];
  for (const p of SETTINGS_PAGE_LIST) {
    for (const a of p.aliases) {
      if (a === p.href) continue;
      out.push({ source: a, destination: p.href });
    }
  }
  return out;
}

/** The redirect row for a URL (path plus optional query), when there is one. */
export function settingsRedirectFor(pathname: string, search: string = ""): SettingsRedirect | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const r of SETTINGS_REDIRECTS) {
    if (r.source !== path) continue;
    if (r.query) {
      if (params.get(r.query.key) === r.query.value) return r;
      continue;
    }
    return r;
  }
  return null;
}

/**
 * The URL a redirect lands on, with the request's other query parameters
 * carried along (the query is preserved, spec-account-auth section 0). The
 * matched `tab=` of a query-conditioned row is dropped, since the target
 * owns its own tab; a target hash stays last.
 */
export function settingsRedirectTarget(r: SettingsRedirect, search: string = ""): string {
  const [beforeHash, hash = ""] = r.destination.split("#");
  const [path, destQuery = ""] = beforeHash.split("?");
  const out = new URLSearchParams(destQuery);
  const incoming = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  // Exactly what Next does with a config redirect (the source query is
  // appended, a key the destination already names is not): so the twin and
  // next.config.ts answer the SAME Location for the same URL. For the
  // query-matched shortcuts row that carries `tab=shortcuts` along
  // (/account/shortcuts has no tabs, so it is inert); the themes row's own
  // `tab=appearance` wins over the matched one.
  for (const [k, v] of incoming) {
    if (!out.has(k)) out.append(k, v);
  }
  const q = out.toString();
  return `${path}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
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
  /**
   * The card behind it never renders for a Guest (Reports you receive: the
   * API answers a Guest 404), so the index must not point a Guest at it.
   */
  notForGuests?: boolean;
}

function entry(e: SettingEntry): SettingEntry {
  return e;
}

/** Every individually-addressable setting the door can find. */
export const SETTINGS_ENTRY_LIST: readonly SettingEntry[] = [
  // My settings: every field on the six personal pages (settings spec G1:
  // /account/all and the door filter list these; a test holds each href to
  // a registered page and tab).
  entry({ id: "profile.photo", door: "me", page: "account/profile", label: "Photo", description: "Your picture on your avatar everywhere.", href: "/account/profile#profile.photo", keywords: ["avatar", "picture", "image"] }),
  entry({ id: "profile.details", door: "me", page: "account/profile", label: "Name, phone and date of birth", description: "How teammates see and reach you.", href: "/account/profile#profile.details", keywords: ["first name", "last name", "phone", "birthday", "dob"] }),
  entry({ id: "profile.email", door: "me", page: "account/profile", label: "Email verification", description: "Send a new verification email.", href: "/account/profile#profile.email", keywords: ["verify", "email", "address"] }),
  entry({ id: "profile.place", door: "me", page: "account/profile", label: "Job title, department, office and manager", description: "Your place in the workspace, read only.", href: "/account/profile#profile.place", keywords: ["title", "department", "office", "manager", "role"] }),
  entry({ id: "profile.data", door: "me", page: "account/profile", label: "Download my data", description: "A JSON copy of your personal records.", href: "/account/profile#profile.data", keywords: ["export", "gdpr", "download"] }),
  entry({ id: "profile.delete", door: "me", page: "account/profile", label: "Delete my account", description: "Leave the workspace and erase your personal details.", href: "/account/profile#profile.delete", keywords: ["delete", "close account", "erase"] }),
  entry({ id: "preferences.appearance.theme.appearance", door: "me", page: "account/preferences", label: "Theme", description: "Light, dark, or follow your device.", href: "/account/preferences?tab=appearance#preferences.appearance.theme.appearance", keywords: ["dark mode", "light mode", "theme"] }),
  entry({ id: "preferences.appearance.density", door: "me", page: "account/preferences", label: "Density", description: "How tall table and list rows are.", href: "/account/preferences?tab=appearance#preferences.appearance.density", keywords: ["compact", "cozy", "comfortable", "rows"] }),
  entry({ id: "preferences.appearance.reducedMotion", door: "me", page: "account/preferences", label: "Reduced motion", description: "Turn off animations.", href: "/account/preferences?tab=appearance#preferences.appearance.reducedMotion", keywords: ["animation", "motion", "accessibility"] }),
  entry({ id: "preferences.appearance.showUpcoming", door: "me", page: "account/preferences", label: "Show upcoming features", description: "Reveal rows still being built.", href: "/account/preferences?tab=appearance#preferences.appearance.showUpcoming", keywords: ["coming soon", "beta", "preview"] }),
  entry({ id: "preferences.region.language", door: "me", page: "account/preferences", label: "Language", description: "The language WorkwrK uses for you.", href: "/account/preferences?tab=region#preferences.region.language", keywords: ["locale", "translation"] }),
  entry({ id: "preferences.region.timezone", door: "me", page: "account/preferences", label: "Time zone", description: "Used for due dates, reminders and timesheets.", href: "/account/preferences?tab=region#preferences.region.timezone", keywords: ["timezone", "zone", "tz"] }),
  entry({ id: "preferences.region.weekStart", door: "me", page: "account/preferences", label: "Week starts on", description: "Monday or Sunday.", href: "/account/preferences?tab=region#preferences.region.weekStart", keywords: ["week", "calendar", "monday", "sunday"] }),
  entry({ id: "preferences.region.dateFormat", door: "me", page: "account/preferences", label: "Date format", description: "How dates are written for you.", href: "/account/preferences?tab=region#preferences.region.dateFormat", keywords: ["date", "dd/mm", "mm/dd"] }),
  entry({ id: "preferences.region.timeFormat", door: "me", page: "account/preferences", label: "Time format", description: "24 hour or 12 hour.", href: "/account/preferences?tab=region#preferences.region.timeFormat", keywords: ["clock", "am", "pm"] }),
  entry({ id: "preferences.sidebar.width", door: "me", page: "account/preferences", label: "Sidebar width", description: "How wide the sidebar is.", href: "/account/preferences?tab=sidebar#preferences.sidebar.width", keywords: ["sidebar", "width"] }),
  entry({ id: "preferences.sidebar.collapsed", door: "me", page: "account/preferences", label: "Start collapsed", description: "Open with only the rail showing.", href: "/account/preferences?tab=sidebar#preferences.sidebar.collapsed", keywords: ["collapse", "sidebar"] }),
  entry({ id: "preferences.sidebar.quickTools", door: "me", page: "account/preferences", label: "Quick actions", description: "The tools pinned to the avatar menu and the top bar.", href: "/account/preferences?tab=sidebar#preferences.sidebar.quickTools", keywords: ["tools", "pins", "quick"] }),
  entry({ id: "preferences.sidebar.order", door: "me", page: "account/preferences", label: "Section order and Work sidebar rows", description: "What the sidebar shows first.", href: "/account/preferences?tab=sidebar#preferences.sidebar.order", keywords: ["sections", "favorites", "spaces", "rows"] }),
  entry({ id: "notifications.mutedUntil", door: "me", page: "account/notifications", label: "Mute everything", description: "Pause every ping for a while.", href: "/account/notifications#notifications.mutedUntil", keywords: ["mute", "snooze", "do not disturb", "pause"] }),
  entry({ id: "notifications.preset", door: "me", page: "account/notifications", label: "Notification preset", description: "Default, Focused or Custom.", href: "/account/notifications?tab=inbox#notifications.preset", keywords: ["focused", "preset"] }),
  entry({ id: "notifications.inbox.work", door: "me", page: "account/notifications", label: "Task notifications", description: "Assigned, status changes and due dates.", href: "/account/notifications?tab=inbox#notifications.inbox.work", keywords: ["tasks", "assigned", "status", "due"] }),
  entry({ id: "notifications.inbox.people", door: "me", page: "account/notifications", label: "Mentions, comments and kudos", description: "What people send your way.", href: "/account/notifications?tab=inbox#notifications.inbox.people", keywords: ["mentions", "comments", "kudos"] }),
  entry({ id: "notifications.inbox.talk", door: "me", page: "account/notifications", label: "Talk and announcements", description: "Messages, channels, calls and announcements.", href: "/account/notifications?tab=inbox#notifications.inbox.talk", keywords: ["dm", "channel", "calls", "announcements"] }),
  entry({ id: "notifications.inboxView", door: "me", page: "account/notifications", label: "How the Inbox behaves", description: "Grouping, clearing and where it opens.", href: "/account/notifications?tab=inbox#notifications.inboxView", keywords: ["inbox", "group", "clear"] }),
  entry({ id: "notifications.muted", door: "me", page: "account/notifications", label: "Muted items", description: "Spaces, Lists and channels you muted.", href: "/account/notifications?tab=inbox#notifications.muted", keywords: ["muted", "unmute"] }),
  entry({ id: "notifications.email", door: "me", page: "account/notifications", label: "Email notifications", description: "What WorkwrK emails you.", href: "/account/notifications?tab=email#notifications.email", keywords: ["email", "send me email"] }),
  entry({ id: "reports", door: "me", page: "account/notifications", label: "Reports you receive", description: "Scheduled reports sent to you.", href: "/account/notifications?tab=email#reports", keywords: ["reports", "schedule", "digest"], notForGuests: true }),
  entry({ id: "notifications.desktop", door: "me", page: "account/notifications", label: "Desktop notifications", description: "Browser alerts and ringing for calls.", href: "/account/notifications?tab=desktop#notifications.desktop", keywords: ["desktop", "browser", "push", "ring", "calls"] }),
  entry({ id: "security.password", door: "me", page: "account/security", label: "Password", description: "Change your password.", href: "/account/security#security.password", keywords: ["password", "change password"] }),
  entry({ id: "security.mfa", door: "me", page: "account/security", label: "Two step verification", description: "An authenticator app code at log in.", href: "/account/security#security.mfa", keywords: ["2fa", "mfa", "authenticator", "two factor"] }),
  entry({ id: "security.sessions", door: "me", page: "account/security", label: "Log out everywhere", description: "End every session on every device.", href: "/account/security#security.sessions", keywords: ["sessions", "devices", "log out"] }),
  entry({ id: "security.activity", door: "me", page: "account/security", label: "Recent security activity", description: "Log ins, password changes and more.", href: "/account/security#security.activity", keywords: ["activity", "history", "log"] }),
  entry({ id: "security.presence", door: "me", page: "account/security", label: "Presence", description: "Active, Away or Do not disturb.", href: "/account/security#security.presence", keywords: ["status", "away", "dnd", "presence"] }),
  entry({ id: "connections.google", door: "me", page: "account/connections", label: "Google Calendar", description: "See your meetings next to your work.", href: "/account/connections", keywords: ["google", "calendar", "sync", "meetings"] }),
  entry({ id: "connections.feed", door: "me", page: "account/connections", label: "Your calendar feed", description: "An ICS link for Apple Calendar or Outlook.", href: "/account/connections", keywords: ["ics", "feed", "outlook", "apple"] }),

  // Workspace settings: one row per card or field a page renders (settings
  // spec 1.11); the hrefs carry the tab and the card anchor.
  entry({ id: "identity.logo", door: "workspace", page: "identity", label: "Logo", description: "The workspace's picture on the rail and in emails.", href: "/settings/identity?tab=profile#identity.logo", keywords: ["logo", "picture", "brand"] }),
  entry({ id: "identity.name", door: "workspace", page: "identity", label: "Workspace name", description: "What everyone sees at the top of the rail.", href: "/settings/identity?tab=profile#identity.name", keywords: ["name", "company name", "rename"] }),
  entry({ id: "identity.domain", door: "workspace", page: "identity", label: "Primary email domain", description: "The domain invitations and sign-in are locked to.", href: "/settings/identity?tab=profile#identity.domain", keywords: ["domain", "email", "company email"] }),
  entry({ id: "identity.business", door: "workspace", page: "identity", label: "Industry, business type and team size", description: "Grounds AI drafts in what the company does.", href: "/settings/identity?tab=profile#identity.business", keywords: ["industry", "business type", "team size"] }),
  entry({ id: "culture.mission", door: "workspace", page: "identity", label: "Mission, vision and about", description: "Shown on the welcome splash and used by AI drafts.", href: "/settings/identity?tab=culture#identity.mission", keywords: ["mission", "vision", "about", "purpose"] }),
  entry({ id: "culture.values", door: "workspace", page: "identity", label: "Core values and the welcome splash", description: "Values on the splash and in kudos.", href: "/settings/identity?tab=culture#identity.values", keywords: ["values", "splash", "culture", "kudos"] }),
  entry({ id: "identity.appearance", door: "workspace", page: "identity", label: "Default theme, density and locks", description: "What everyone starts with, and what they cannot change.", href: "/settings/identity?tab=appearance", keywords: ["theme", "density", "dark", "lock", "defaults"] }),
  entry({ id: "identity.danger", door: "workspace", page: "identity", label: "Transfer ownership and delete workspace", description: "Owner only.", href: "/settings/identity?tab=danger#identity.danger", keywords: ["owner", "transfer", "delete workspace", "close"] }),
  entry({ id: "locale.timezone", door: "workspace", page: "locale", label: "Time zone", description: "The workspace clock for reminders and due dates.", href: "/settings/locale#locale.timezone", keywords: ["timezone", "time zone", "clock"] }),
  entry({ id: "locale.currency", door: "workspace", page: "locale", label: "Currency", description: "How every amount is shown.", href: "/settings/locale#locale.currency", keywords: ["currency", "money", "inr", "usd"] }),
  entry({ id: "locale.language", door: "workspace", page: "locale", label: "Default language", description: "The language people start with.", href: "/settings/locale#locale.language", keywords: ["language", "translation"] }),
  entry({ id: "locale.dates", door: "workspace", page: "locale", label: "Week start, date and time format", description: "The workspace defaults under each person's own.", href: "/settings/locale#locale.dates", keywords: ["week start", "monday", "sunday", "date format", "12 hour", "24 hour"] }),
  entry({ id: "locale.fiscalYearStart", door: "workspace", page: "locale", label: "Fiscal year start", description: "The month fiscal quarters count from.", href: "/settings/locale#locale.fiscal", keywords: ["fiscal", "financial year", "quarter"] }),
  entry({ id: "locale.workWeek", door: "workspace", page: "locale", label: "Work days, day length and holidays", description: "The working calendar Workload and Timesheets use.", href: "/settings/locale", keywords: ["work week", "holidays", "working days", "capacity", "hours"] }),
  entry({ id: "apps.modules", door: "workspace", page: "apps", label: "Talk and Tables", description: "Turn the premium modules on or off.", href: "/settings/apps#modules", keywords: ["talk", "tables", "modules", "premium"] }),
  entry({ id: "apps.rail", door: "workspace", page: "apps", label: "Rail apps: order, hide and who can see", description: "What shows in everyone's rail.", href: "/settings/apps#rail", keywords: ["rail", "hide", "order", "floor", "apps"] }),
  entry({ id: "apps.automations", door: "workspace", page: "apps", label: "Pause all automations", description: "Stops every automation in the workspace.", href: "/settings/apps#apps.automations", keywords: ["automation", "pause", "workflows", "runs"] }),
  entry({ id: "members.people", door: "workspace", page: "members", label: "People and their roles", description: "Owner, Admin or Member, job title, department and manager.", href: "/settings/members?tab=people", keywords: ["people", "roles", "deactivate", "remove", "reports to"] }),
  entry({ id: "members.teams", door: "workspace", page: "members", label: "Teams", description: "Named groups of people: who is in each and who leads it.", href: "/settings/members?tab=teams", keywords: ["teams", "groups", "lead"] }),
  entry({ id: "members.inviteRules", door: "workspace", page: "members", label: "Invite rules", description: "Allowed domains, default role and invitation expiry.", href: "/settings/members?tab=pending#members.inviteRules", keywords: ["invite", "domains", "expiry", "default role"] }),
  entry({ id: "structure.departments", door: "workspace", page: "structure", label: "Departments", description: "The departments people belong to.", href: "/settings/structure?tab=departments", keywords: ["departments", "functions", "teams"] }),
  entry({ id: "structure.titles", door: "workspace", page: "structure", label: "Job titles", description: "The job titles people hold.", href: "/settings/structure?tab=titles", keywords: ["job titles", "roles", "seniority"] }),
  entry({ id: "structure.offices", door: "workspace", page: "structure", label: "Offices", description: "Where people work from, and the headquarters.", href: "/settings/structure?tab=offices", keywords: ["offices", "locations", "headquarters"] }),
  entry({ id: "structure.fields", door: "workspace", page: "structure", label: "Profile fields", description: "Extra fields on every person's record.", href: "/settings/structure?tab=fields", keywords: ["custom fields", "employee id", "profile"] }),
  entry({ id: "access.publicLinks", door: "workspace", page: "access", label: "Public links", description: "Whether a Doc or SOP can be shared by link.", href: "/settings/access#access.publicLinks", keywords: ["public link", "share", "anyone with the link"] }),
  entry({ id: "access.legacy", door: "workspace", page: "access", label: "Legacy permission rules", description: "The old grid's rules the server still checks.", href: "/settings/access#access.legacy", keywords: ["permissions", "matrix", "grid", "legacy"] }),
  entry({ id: "tasks.types", door: "workspace", page: "tasks", label: "Task types", description: "Task, Milestone and your own types.", href: "/settings/tasks?tab=types", keywords: ["task types", "milestone", "bug"] }),
  entry({ id: "tasks.tags", door: "workspace", page: "tasks", label: "Tags", description: "Labels you can put on anything.", href: "/settings/tasks?tab=tags", keywords: ["tags", "labels"] }),
  entry({ id: "tasks.defaultType", door: "workspace", page: "tasks", label: "Default task type", description: "The type a new task starts as.", href: "/settings/tasks?tab=templates#tasks.defaultType", keywords: ["default type", "templates", "template center"] }),
  entry({ id: "scoring.cadence", door: "workspace", page: "scoring", label: "Review cadence", description: "Weekly, monthly, quarterly and annual reviews.", href: "/settings/scoring#scoring.cadence", keywords: ["cadence", "reviews", "cycle", "reminders"] }),
  entry({ id: "scoring.weights", door: "workspace", page: "scoring", label: "Score weights", description: "How KPIs, SOPs, behaviour and peers add up.", href: "/settings/scoring#scoring.weights", keywords: ["weights", "score", "composite"] }),
  entry({ id: "scoring.bands", door: "workspace", page: "scoring", label: "Performance bands", description: "The names of score ranges.", href: "/settings/scoring#scoring.bands", keywords: ["bands", "ratings", "exceptional"] }),
  entry({ id: "scoring.anchors", door: "workspace", page: "scoring", label: "Behavioural anchors", description: "The five words a reviewer picks from.", href: "/settings/scoring#scoring.anchors", keywords: ["anchors", "scale", "likert"] }),
  entry({ id: "signin.passwords", door: "workspace", page: "security", label: "Password rules and expiry", description: "Length, uppercase, number, symbol and age.", href: "/settings/security?tab=signin#signin.passwords", keywords: ["password", "length", "symbol", "expiry"] }),
  entry({ id: "signin.sessions", door: "workspace", page: "security", label: "Session idle time and lifetime", description: "When people are signed out.", href: "/settings/security?tab=signin#signin.sessions", keywords: ["session", "idle", "timeout", "sign out"] }),
  entry({ id: "signin.mfa", door: "workspace", page: "security", label: "Two step verification", description: "Required for nobody, Admins or everyone.", href: "/settings/security?tab=signin#signin.mfa", keywords: ["2fa", "mfa", "two factor", "authenticator"] }),
  entry({ id: "signin.lockout", door: "workspace", page: "security", label: "Failed sign-ins", description: "How many tries before an account locks.", href: "/settings/security?tab=signin#signin.lockout", keywords: ["lockout", "brute force", "attempts"] }),
  entry({ id: "signin.signOutAll", door: "workspace", page: "security", label: "Sign everyone out", description: "End every session on every device.", href: "/settings/security?tab=signin#signin.signOutAll", keywords: ["sign out", "log out everyone", "sessions"] }),
  entry({ id: "signin.provisioning", door: "workspace", page: "security", label: "Provisioning (SCIM)", description: "Tokens for your identity provider.", href: "/settings/security?tab=provisioning", keywords: ["scim", "okta", "azure", "provisioning"] }),
  entry({ id: "data.export", door: "workspace", page: "data", label: "Export", description: "The whole workspace, people, timesheets and the audit log.", href: "/settings/data?tab=export#data.export", keywords: ["export", "download", "backup", "csv", "zip"] }),
  entry({ id: "data.import", door: "workspace", page: "data", label: "Import", description: "People and tables from a CSV file.", href: "/settings/data?tab=import", keywords: ["import", "csv", "upload"] }),
  entry({ id: "data.retention", door: "workspace", page: "data", label: "Retention", description: "How long Trash and the audit log keep things.", href: "/settings/data?tab=retention#data.retention", keywords: ["retention", "trash", "purge", "audit"] }),
  entry({ id: "data.aiEnabled", door: "workspace", page: "data", label: "AI features for everyone", description: "Turn every AI entry point on or off.", href: "/settings/data?tab=retention#data.aiEnabled", keywords: ["ai", "assistant", "privacy"] }),
  entry({ id: "data.aiFields", door: "workspace", page: "data", label: "AI fields in Lists", description: "Summary, Sentiment, Categorize and Translation fields.", href: "/settings/data?tab=retention#data.aiFields", keywords: ["ai", "fields", "autofill", "summary", "sentiment", "translate"] }),
  entry({ id: "data.aiTalkUpdates", door: "workspace", page: "data", label: "Scheduled AI updates in Talk", description: "A daily standup or weekly project update posted in a channel.", href: "/settings/data?tab=retention#data.aiTalkUpdates", keywords: ["ai", "standup", "update", "talk", "channel", "schedule"] }),
  entry({ id: "audit.log", door: "workspace", page: "audit", label: "Audit log and its export", description: "What happened, who did it, what changed.", href: "/settings/audit", keywords: ["audit", "activity", "history", "export"] }),
  entry({ id: "api.keys", door: "workspace", page: "api", label: "API keys", description: "Keys, scopes and rate limits.", href: "/settings/api?tab=keys", keywords: ["api", "keys", "tokens", "rate limit"] }),
  entry({ id: "billing.plan", door: "workspace", page: "billing", label: "Plan and usage", description: "Your plan, seats and AI use this month.", href: "/settings/billing", keywords: ["plan", "billing", "seats", "invoice", "upgrade"] }),

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
  opts: { door?: SettingsDoor; allowedExternalGates?: readonly OrgAction[]; guest?: boolean } = {},
): SettingEntry[] {
  const q = query.trim().toLowerCase();
  const allowed = opts.allowedExternalGates ?? [];
  return SETTINGS_ENTRY_LIST.filter((e) => {
    if (opts.door && e.door !== opts.door) return false;
    if (opts.guest && e.notForGuests) return false;
    if (e.externalGate && !allowed.includes(e.externalGate)) return false;
    if (!q) return true;
    if (e.label.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if (e.id.toLowerCase().includes(q)) return true;
    return e.keywords.some((k) => k.includes(q));
  });
}
