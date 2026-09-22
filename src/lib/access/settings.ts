// Organization.settings.access (the ten toggles, spec section 8), plus the two
// fixed tables the gate reads: APP_RULES (spec 5.2.1) and SETTINGS_PAGE_GATES
// (spec 6.6).
//
// The toggles do not exist in the schema yet (step 4 writes them). Until then
// `parseAccessSettings` returns the section 8 defaults for every org, which is
// why the parity harness diffs against TODAY_EQUIVALENT_ACCESS_SETTINGS
// instead: three of the section 8 defaults are deliberately more permissive
// than today's code, and reading them as "today" would fake a mismatch.
//
// Pure: imports ./types and zod only (node_modules resolves in vitest; the
// "@/" alias does not).

import { z } from "zod";
import type {
  AccessSettings,
  AdminScope,
  AppKey,
  AppsConfig,
  ObjectRole,
  ObjectType,
  SettingsPageKey,
} from "./types";

// ── The ten toggles (spec 8) ──────────────────────────────────────

export const accessSettingsSchema = z.object({
  whoCanCreateSpaces: z.enum(["everyone", "admins"]).default("everyone"),
  newSpaceDefault: z.enum(["everyone_edit", "everyone_view", "private"]).default("everyone_edit"),
  findableSpaces: z.boolean().default(true),
  editorsCanShare: z.boolean().default(true),
  whoCanInviteGuests: z.enum(["full_access", "admins", "nobody"]).default("full_access"),
  peopleTeamUserIds: z.array(z.string()).default([]),
  peopleTeamDepartmentId: z.string().nullable().default(null),
  whoCanPublish: z.enum(["editors", "admins_people_team"]).default("editors"),
  whoCanDelete: z.enum(["full_access", "admins"]).default("full_access"),
  guestExpiryDays: z.union([z.literal(0), z.literal(30), z.literal(90)]).default(0),
  publicLinks: z.enum(["off", "view"]).default("off"),
});

/** Spec 8, "Defaults for a fresh org". */
export const DEFAULT_ACCESS_SETTINGS: AccessSettings = accessSettingsSchema.parse({});

/**
 * What today's code actually enforces, for the step-2 parity harness only.
 * Three toggles differ from the section 8 defaults:
 *   3 findableSpaces  - nothing is discoverable-by-name today; rule 14 would
 *                       invent discoverability the old helpers never had.
 *   4 editorsCanShare - today `share` is canEditSpace / canEditBoard, i.e. the
 *                       FULL-equivalent rung; EDIT never shares.
 *   10 publicLinks    - already off.
 * Everything else matches.
 */
export const TODAY_EQUIVALENT_ACCESS_SETTINGS: AccessSettings = {
  ...DEFAULT_ACCESS_SETTINGS,
  findableSpaces: false,
  editorsCanShare: false,
};

/** G9, spec 7.4: the one-click preset on /settings/access. */
export const LOCK_IT_DOWN_ACCESS_SETTINGS: AccessSettings = {
  ...DEFAULT_ACCESS_SETTINGS,
  whoCanCreateSpaces: "admins",
  newSpaceDefault: "private",
  findableSpaces: false,
  editorsCanShare: false,
  whoCanInviteGuests: "admins",
  whoCanPublish: "admins_people_team",
  whoCanDelete: "admins",
  guestExpiryDays: 30,
  publicLinks: "off",
};

/**
 * Tolerant parse of the untyped Organization.settings blob. A hand-edited or
 * older row must never throw inside a gate and must never fail open: every
 * unparseable key falls back to its section 8 default.
 */
export function parseAccessSettings(raw: unknown): AccessSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_ACCESS_SETTINGS };
  const parsed = accessSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Partial recovery: keep the keys that do parse, default the rest.
  const out: Record<string, unknown> = {};
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(accessSettingsSchema.shape)) {
    const field = (accessSettingsSchema.shape as Record<string, z.ZodTypeAny>)[key];
    const one = field.safeParse(source[key]);
    if (one.success) out[key] = one.data;
  }
  return accessSettingsSchema.parse(out);
}

export const TOGGLE_KEYS = [
  "whoCanCreateSpaces",
  "newSpaceDefault",
  "findableSpaces",
  "editorsCanShare",
  "whoCanInviteGuests",
  "peopleTeam",
  "whoCanPublish",
  "whoCanDelete",
  "guestExpiryDays",
  "publicLinks",
] as const;

export type ToggleKey = (typeof TOGGLE_KEYS)[number];

// ── APP_RULES (spec 5.2.1) ────────────────────────────────────────

/**
 * Who sees an app row and opens its route. "member" means Owner, Admin and
 * Member (Agents included); Guests are handled by `guest` separately.
 */
export type AppAudience =
  /** everyone signed in, Guests included */
  | "signed-in"
  /** every Member (so not Guests) */
  | "member"
  /** anyone with reports (their chain), the People team, and Owner/Admin */
  | "reports-people-team-admin"
  /** the People team and Owner/Admin */
  | "people-team-admin"
  /** Owner and Admin only */
  | "owner-admin";

export type AppGuestAccess =
  /** never rendered for a Guest */
  | "none"
  /** rendered only when something of that kind is shared with the Guest */
  | "shared"
  /** always rendered for a Guest */
  | "always";

export interface AppRule {
  /** The hub this key lives in, or "hub" when the key IS a hub. */
  hub: AppKey | "hub";
  audience: AppAudience;
  guest: AppGuestAccess;
  /** Rule 2: the premium module this app belongs to. */
  moduleKey?: "chat" | "tables";
  /** Rail escape hatch: never floored or hidden by the org Apps config. */
  alwaysPinned?: boolean;
}

/**
 * One row per app key. The 8 hubs and the 21 keys of FOLDED_APP_HUB
 * (src/lib/nav/route-hub.ts), plus `talent`, `analytics`, `rollup` and
 * `integrations`, which are routes rather than catalog entries. 33 rows.
 *
 * Phase 4 added `meetings` and `clock`, the two Planner routes that had no
 * key at all.
 *
 * NOTE on the spec's own count: section 5.2.1's preamble says "8 + 19 + 3 = 30"
 * while its table lists 31. The fourth route-only key is `integrations`; the
 * table is right and the preamble undercounts.
 */
export const APP_RULES: Record<AppKey, AppRule> = {
  // hubs
  home: { hub: "hub", audience: "signed-in", guest: "always", alwaysPinned: true },
  planner: { hub: "hub", audience: "member", guest: "none" },
  chat: { hub: "hub", audience: "member", guest: "shared", moduleKey: "chat" },
  docs: { hub: "hub", audience: "member", guest: "shared" },
  teams: { hub: "hub", audience: "member", guest: "none" },
  tables: { hub: "hub", audience: "member", guest: "shared", moduleKey: "tables" },
  ai: { hub: "hub", audience: "member", guest: "none" },
  settings: { hub: "hub", audience: "signed-in", guest: "always", alwaysPinned: true },
  // Work
  goals: { hub: "home", audience: "member", guest: "none" },
  trash: { hub: "home", audience: "member", guest: "none" },
  // spec-spaces-lists section 1, "The `templates` app key": Work hub row plus
  // the Task system > Templates link. Every Member browses and applies; "Save
  // as template" needs Full access on the source object; Owner, Admin and the
  // creator delete a "Made here" template. Guests never.
  templates: { hub: "home", audience: "member", guest: "none" },
  // Planner
  timesheets: { hub: "planner", audience: "member", guest: "none" },
  // Phase 4. Content scoping is the routes' own job and is stricter than the
  // row: /meetings lists only meetings the viewer attends or created (Owners
  // and Admins org-wide, rule 4), and /clock shows the viewer's own punches
  // and nobody else's. Agents see both rows: frontline work is who the clock
  // is for.
  meetings: { hub: "planner", audience: "member", guest: "none" },
  clock: { hub: "planner", audience: "member", guest: "none" },
  // Docs
  library: { hub: "docs", audience: "member", guest: "shared" },
  clips: { hub: "docs", audience: "member", guest: "none" },
  sops: { hub: "docs", audience: "member", guest: "shared" },
  policies: { hub: "docs", audience: "member", guest: "none" },
  agreements: { hub: "docs", audience: "people-team-admin", guest: "none" },
  // Teams
  reviews: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  talent: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  analytics: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  rollup: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  candor: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  kudos: { hub: "teams", audience: "member", guest: "none" },
  surveys: { hub: "teams", audience: "people-team-admin", guest: "none" },
  tools: { hub: "teams", audience: "member", guest: "none" },
  assets: { hub: "teams", audience: "reports-people-team-admin", guest: "none" },
  // Talk
  announcements: { hub: "chat", audience: "member", guest: "none" },
  // Tables
  forms: { hub: "tables", audience: "member", guest: "shared", moduleKey: "tables" },
  // AI
  automation: { hub: "ai", audience: "member", guest: "none" },
  build: { hub: "ai", audience: "owner-admin", guest: "none" },
  store: { hub: "ai", audience: "member", guest: "none" },
  integrations: { hub: "ai", audience: "member", guest: "none" },
};

export const APP_KEYS = Object.keys(APP_RULES) as AppKey[];

// ── SETTINGS_PAGE_GATES (spec 6.6) ────────────────────────────────

export interface PageGate {
  /**
   * "owner-or-scope": Owner always, Admin only with `scope`.
   * "owner-admin": Owner and Admin.
   * "personal": everyone signed in (the /account/* door).
   */
  gate: "owner-or-scope" | "owner-admin" | "personal";
  scope?: AdminScope;
  /** Spec 6.6: the People team reads these four Workspace pages. */
  peopleTeamRead?: boolean;
}

export const SETTINGS_PAGE_GATES: Record<SettingsPageKey, PageGate> = {
  billing: { gate: "owner-or-scope", scope: "billing" },
  security: { gate: "owner-or-scope", scope: "security" },
  api: { gate: "owner-or-scope", scope: "security" },

  overview: { gate: "owner-admin" },
  identity: { gate: "owner-admin" },
  locale: { gate: "owner-admin" },
  apps: { gate: "owner-admin" },
  members: { gate: "owner-admin", peopleTeamRead: true },
  structure: { gate: "owner-admin", peopleTeamRead: true },
  access: { gate: "owner-admin", peopleTeamRead: true },
  scoring: { gate: "owner-admin", peopleTeamRead: true },
  tasks: { gate: "owner-admin" },
  data: { gate: "owner-admin" },
  audit: { gate: "owner-admin" },

  "account/profile": { gate: "personal" },
  "account/preferences": { gate: "personal" },
  "account/notifications": { gate: "personal" },
  "account/security": { gate: "personal" },
  "account/connections": { gate: "personal" },
  "account/shortcuts": { gate: "personal" },
};

export const SETTINGS_PAGE_KEYS = Object.keys(SETTINGS_PAGE_GATES) as SettingsPageKey[];

// ── Object type -> module (rule 2) ────────────────────────────────

/**
 * Which premium module owns an object type. Rule 2 short-circuits before the
 * object row is loaded, so this has to be answerable from the ref alone.
 */
export const MODULE_BY_OBJECT_TYPE: Partial<Record<ObjectType, "chat" | "tables">> = {
  channel: "chat",
  table: "tables",
  form: "tables",
};

// ── Object type -> app key (rule 2, the Apps-config half) ─────────

/**
 * Which Apps-config row governs an object type. Spec 7.1: "A hidden app or a
 * floor is enforced by rule 2, so a hidden app's routes lock, not just its
 * icon." Rule 2 reads `ObjectFacts.appKey`, and without this table that half
 * of the rule is dead code for every object ref: an org that hides `assets` or
 * floors `analytics` to Admins would still get a full decision for
 * { type: "asset", id }.
 *
 * Only the types whose app row is unambiguous are listed. A Space, Folder,
 * List, Item or Doc belongs to no single app (they are the Work OS itself and
 * are reachable from several hubs), so they carry no app key and rule 2's
 * module half is all that applies to them.
 */
export const APP_BY_OBJECT_TYPE: Partial<Record<ObjectType, AppKey>> = {
  channel: "chat",
  table: "tables",
  form: "forms",
  goal: "goals",
  timesheet: "timesheets",
  file: "library",
  file_folder: "library",
  sop: "sops",
  sop_folder: "sops",
  policy: "policies",
  contract: "agreements",
  review_cycle: "reviews",
  candor: "candor",
  kudos: "kudos",
  survey: "surveys",
  announcement: "announcements",
  tool: "tools",
  asset: "assets",
  automation: "automation",
  template: "settings",
};

// ── Space.settings.defaultPermission -> the EVERYONE role ─────────

/**
 * Spec 3.1: `Visibility.ORG` on a Space becomes an EVERYONE grant at the role
 * `Space.settings.defaultPermission` maps to (Full edit or Edit to EDIT,
 * Comment to COMMENT, View to VIEW; missing = EDIT). This is the dead
 * "Default permission" select of audit Broken #9 becoming enforced.
 *
 * It lives here, in the pure module, because three places make the mapping:
 * facts.ts (loadFacts), ids.ts (accessibleIds) and parity.ts (the harness's
 * engine half). Two of them used to hard-code EDIT, which both widened
 * accessibleIds past can() and made the parity report under-report.
 */
export function roleFromDefaultPermission(settings: unknown): ObjectRole {
  const raw =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).defaultPermission
      : undefined;
  if (raw === "view" || raw === "VIEW" || raw === "Can view") return "VIEW";
  if (raw === "comment" || raw === "COMMENT" || raw === "Can comment") return "COMMENT";
  return "EDIT";
}

// ── OrgPreference.sidebarDefault.apps, validated ──────────────────

const APPS_CONFIG_TIERS: ReadonlySet<string> = new Set(["manager", "hr-admin", "org-admin"]);

/**
 * The org rail config is an untyped JSON blob. Rule 2 calls `.includes` on
 * `hidden` and indexes `minAccess`, so a hand-edited row holding a number or a
 * string there would throw a TypeError INSIDE a gate (a 500 rather than a
 * decision), and a stray string would substring-match app keys. This parses
 * defensively and drops anything it does not recognise, including unknown
 * tiers, which is what lets `clearsAppFloor` treat an unknown tier as the
 * narrowest without an unknown tier ever reaching it.
 */
export function parseOrgAppsConfig(raw: unknown): AppsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

  const out: AppsConfig = {};
  const order = strings(source.order);
  if (order) out.order = order;
  const hidden = strings(source.hidden);
  if (hidden) out.hidden = hidden;

  const minAccessRaw = source.minAccess;
  if (minAccessRaw && typeof minAccessRaw === "object" && !Array.isArray(minAccessRaw)) {
    const minAccess: Record<string, string> = {};
    for (const [key, value] of Object.entries(minAccessRaw as Record<string, unknown>)) {
      if (typeof value === "string" && APPS_CONFIG_TIERS.has(value)) minAccess[key] = value;
    }
    if (Object.keys(minAccess).length > 0) out.minAccess = minAccess;
  }
  return out;
}
