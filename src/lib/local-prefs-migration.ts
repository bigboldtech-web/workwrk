// The one-time move of personal settings out of browser storage and into the
// server preference keys (settings-architecture 7.3). Pure: the shell passes
// in what localStorage holds and what the person's OWN preference row holds
// (GET /api/preferences?raw=1, never the merged view, so "not set" is
// distinguishable from "set to the default"), and gets back the writes to
// make and the keys to remove.
//
// The rules, decided by the smallest worst case:
//   - The server wins. A key already set on the row (from another device or
//     a later choice) is never overwritten by an older browser's value.
//   - A key is removed from localStorage only after the write that carries
//     it has succeeded (the caller removes `removeAfterWrite` then), so a
//     failed write retries on the next load instead of losing the value.
//   - Keys with nothing left to carry (the icons-only rail, the retired lens
//     and active-app keys) are removed at once: nothing reads them.
//   - Anything unparseable is dropped, never written as a guess.

export const LEGACY_KEYS = {
  collapsed: "workwrk:os:sidebar-collapsed",
  width: "workwrk:os:sidebar-width",
  toolPins: "workwrk:os:profile-tool-pins:v2",
  muted: "workwrk:os:muted-notifs",
  density: "workwrk:density",
  desktop: "desktop-notifications-pref",
  presence: "workwrk:os:presence",
  savedFilters: "workwrk:task-saved-filters",
} as const;

/** Keys whose value has no home any more; removed without a write. */
export const DEAD_KEYS = ["workwrk:os:active-app", "workwrk:os:lens", "workwrk:os:icons-only"] as const;

export type LegacyKey = (typeof LEGACY_KEYS)[keyof typeof LEGACY_KEYS];
export type LocalSnapshot = Partial<Record<LegacyKey, string | null>>;

/** The person's own UserPreference row, as GET /api/preferences?raw=1 returns it. */
export interface RawPreferenceRow {
  sidebar?: Record<string, unknown> | null;
  home?: Record<string, unknown> | null;
  density?: string | null;
}

export interface LegacyPresence {
  emoji: string | null;
  label: string;
  expiresAt: string | null;
}

export interface LocalMigrationPlan {
  /** A PATCH /api/preferences body, or null when nothing is left to write. */
  patch: { sidebar?: Record<string, unknown>; home?: Record<string, unknown>; density?: string } | null;
  /** Keys to remove once `patch` succeeded (or at once when patch is null). */
  removeAfterWrite: LegacyKey[];
  /** A presence to share through PUT /api/me/presence, when the server has none. */
  presence: LegacyPresence | null;
  /** Keys removed without a write (dead, or the server already had a value). */
  removeNow: string[];
}

/** How long an old per-browser mute carries up to the server (see below). */
const LEGACY_MUTE_CARRY_MS = 24 * 60 * 60 * 1000;
const DENSITIES = new Set(["compact", "cozy", "comfortable"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function has(obj: unknown, key: string): boolean {
  return isObj(obj) && obj[key] !== undefined && obj[key] !== null;
}

export function planLocalPrefsMigration(
  local: LocalSnapshot,
  row: RawPreferenceRow | null,
  opts: { now?: Date; serverPresence?: string | null } = {},
): LocalMigrationPlan {
  const now = opts.now ?? new Date();
  const sidebar: Record<string, unknown> = {};
  const home: Record<string, unknown> = {};
  const notifications: Record<string, unknown> = {};
  const work: Record<string, unknown> = {};
  let density: string | undefined;
  const removeAfterWrite: LegacyKey[] = [];
  const removeNow: string[] = [...DEAD_KEYS];
  const rowSidebar = row?.sidebar ?? null;
  const rowHome = row?.home ?? null;
  const rowNotif = isObj(rowHome) ? rowHome.notifications : null;
  const rowWork = isObj(rowHome) ? rowHome.work : null;

  // Decide one key: carry it (value !== undefined and the server has none),
  // or drop it (the server already has one, or it does not parse).
  const decide = (key: LegacyKey, serverHas: boolean, value: unknown, apply: (v: unknown) => void) => {
    if (local[key] === undefined || local[key] === null) return;
    if (serverHas || value === undefined) {
      removeNow.push(key);
      return;
    }
    apply(value);
    removeAfterWrite.push(key);
  };

  const collapsedRaw = local[LEGACY_KEYS.collapsed];
  decide(LEGACY_KEYS.collapsed, has(rowSidebar, "collapsed"), collapsedRaw === "1" ? true : collapsedRaw === "0" ? false : undefined, (v) => { sidebar.collapsed = v; });

  const widthNum = Number(local[LEGACY_KEYS.width]);
  decide(
    LEGACY_KEYS.width,
    has(rowSidebar, "width"),
    Number.isFinite(widthNum) && widthNum >= 160 && widthNum <= 600 ? Math.round(widthNum) : undefined,
    (v) => { sidebar.width = v; },
  );

  let pins: unknown;
  try { pins = JSON.parse(local[LEGACY_KEYS.toolPins] ?? "null"); } catch { pins = undefined; }
  decide(
    LEGACY_KEYS.toolPins,
    has(rowSidebar, "quickTools"),
    Array.isArray(pins) && pins.every((p) => typeof p === "string") ? pins.slice(0, 20) : undefined,
    (v) => { sidebar.quickTools = v; },
  );

  // "1" was the old on/off mute, kept per browser with no end. It carries up
  // BOUNDED, for 24 hours: the server value silences every device, and one
  // stale browser coming back months later must not mute the person
  // everywhere indefinitely (the release before this one ignored the key
  // entirely, so a returning browser was "not muted"). "0" carries nothing.
  const mutedRaw = local[LEGACY_KEYS.muted];
  const carriedMute = new Date(now.getTime() + LEGACY_MUTE_CARRY_MS);
  decide(LEGACY_KEYS.muted, has(rowNotif, "mutedUntil"), mutedRaw === "1" ? carriedMute.toISOString() : undefined, (v) => { notifications.mutedUntil = v; });

  const desktopRaw = local[LEGACY_KEYS.desktop];
  decide(LEGACY_KEYS.desktop, has(rowNotif, "desktop"), desktopRaw === "on" ? true : desktopRaw === "off" ? false : undefined, (v) => { notifications.desktop = v; });

  const densityRaw = local[LEGACY_KEYS.density];
  decide(LEGACY_KEYS.density, !!row?.density, densityRaw && DENSITIES.has(densityRaw) ? densityRaw : undefined, (v) => { density = v as string; });

  let filters: unknown;
  try { filters = JSON.parse(local[LEGACY_KEYS.savedFilters] ?? "null"); } catch { filters = undefined; }
  const cleanFilters = Array.isArray(filters)
    ? filters.filter((f) => isObj(f) && typeof f.id === "string" && typeof f.name === "string" && f.name.trim())
    : [];
  decide(
    LEGACY_KEYS.savedFilters,
    isObj(rowWork) && Array.isArray(rowWork.savedFilters) && rowWork.savedFilters.length > 0,
    cleanFilters.length > 0 ? cleanFilters.slice(0, 50) : undefined,
    (v) => { work.savedFilters = v; },
  );

  // Presence goes through PUT /api/me/presence (User.presenceStatus), not
  // the preference row, so it is planned apart and its key is removed by
  // the caller once that PUT answers.
  let presence: LegacyPresence | null = null;
  const presRaw = local[LEGACY_KEYS.presence];
  if (presRaw !== undefined && presRaw !== null) {
    let p: unknown;
    try { p = JSON.parse(presRaw); } catch { p = null; }
    const label = isObj(p) && typeof p.label === "string" ? p.label.trim() : "";
    const expiresAt = isObj(p) && typeof p.expiresAt === "string" ? p.expiresAt : null;
    const live = !expiresAt || new Date(expiresAt).getTime() > now.getTime();
    if (!opts.serverPresence && label && label !== "Online" && live) {
      presence = { emoji: isObj(p) && typeof p.emoji === "string" ? p.emoji : null, label, expiresAt };
    } else {
      removeNow.push(LEGACY_KEYS.presence);
    }
  }

  if (Object.keys(notifications).length) home.notifications = notifications;
  if (Object.keys(work).length) home.work = work;
  const patch: LocalMigrationPlan["patch"] = {};
  if (Object.keys(sidebar).length) patch.sidebar = sidebar;
  if (Object.keys(home).length) patch.home = home;
  if (density) patch.density = density;

  return {
    patch: Object.keys(patch).length ? patch : null,
    removeAfterWrite,
    presence,
    removeNow,
  };
}

/** True when this browser holds anything the migration would read (a cheap first check). */
export function hasLegacyLocalPrefs(getItem: (k: string) => string | null): boolean {
  return [...Object.values(LEGACY_KEYS), ...DEAD_KEYS].some((k) => {
    try { return getItem(k) !== null; } catch { return false; }
  });
}
