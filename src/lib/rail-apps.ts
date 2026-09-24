// Rail app-access resolution — the single source of truth for WHICH apps
// appear in the left rail and IN WHAT ORDER, for both the rail itself and
// the Settings admin page that edits the config.
//
// 2026-08-22: personal pinning is gone. The Super Admin configures the rail
// once for the whole org (OrgPreference.sidebarDefault.apps) and every
// user's rail shows every app they have access to, in the admin's order:
//
//   visible = catalog
//     MINUS  config.hidden                (org switched the app off)
//     FILTER canAccessApp(app, level)     (catalog baseline — never weakened)
//     FILTER config.minAccess[app.key]    (org floor ON TOP of the baseline)
//     ORDER  config.order, then catalog order for the rest
//
// alwaysPinned apps (Home) ignore hidden/minAccess entirely — they are the
// escape hatch that guarantees the rail is never empty for any access level.
//
// hidden/minAccess are DISPLAY-level in v1: they remove rail entries only.
// Routes stay reachable by URL; the catalog's requiredAccess plus the
// per-page gates (src/lib/page-gates.ts) keep doing the real enforcement.
//
// Imports are RELATIVE (not "@/") on purpose: vitest's node environment has
// no path-alias resolution, and this module's colocated test mocks the
// catalog module by this exact specifier.

import {
  APPS,
  canAccessApp,
  canAccessTier,
  isAlwaysPinned,
  type AccessTier,
  type AppEntry,
} from "../components/layout/os/apps-catalog";
// Relative on purpose (see header) — the premium-module registry, so the rail
// can hide a module the org hasn't turned on.
import { MODULE_APP_KEYS } from "./modules";
// The tier ladder itself, from the engine's one pure copy. The resolver calls
// this rather than the catalog's re-export so it also runs on the SERVER
// (/api/boot): apps-catalog.tsx is a "use client" module, and its function
// exports are client references, not callables, inside a route handler.
import { legacyTierAllows, type LegacyTier } from "./access/legacy-levels";

// Re-export so the rail and the admin page have ONE import for the whole
// access story instead of splitting it across this module and the catalog.
export { APPS, canAccessApp, canAccessTier, isAlwaysPinned };
export type { AccessTier, AppEntry };

/**
 * The fields the resolver reads. `AppEntry` satisfies it; so does the pure
 * server mirror in ./app-access.ts, which is how /api/boot resolves the same
 * rail without loading the client catalog.
 */
export type AppLike = {
  key: string;
  label: string;
  defaultHref: string;
  requiredAccess?: AccessTier;
  alwaysPinned?: boolean;
  hideFromCatalog?: boolean;
  hubKey?: string;
};

function tierAllows(tier: AccessTier | undefined, accessLevel: string | null | undefined): boolean {
  if (!tier) return true;
  return legacyTierAllows(tier as LegacyTier, accessLevel);
}

/**
 * The org rail config as stored in OrgPreference.sidebarDefault.apps.
 * minAccess values use the SAME tier vocabulary as the catalog's
 * requiredAccess ("manager" | "hr-admin" | "org-admin").
 *
 * A `type` alias, not an interface, on purpose: this shape is written into
 * a Prisma Json column, and only object-literal types get the implicit
 * index signature Prisma's InputJsonValue requires.
 */
export type OrgAppsConfig = {
  /** Full desired order of app keys; unknown/new keys append in catalog order. */
  order?: string[];
  /** App keys the org has switched off (display-level). */
  hidden?: string[];
  /** App key -> access tier floor ON TOP of the catalog's requiredAccess. */
  minAccess?: Record<string, string>;
};

// Typed against AccessTier so adding a tier to the catalog union without
// updating this list is a compile error — one ladder, one vocabulary.
const VALID_TIERS: ReadonlySet<string> = new Set<AccessTier>([
  "manager", "hr-admin", "org-admin",
]);

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Tolerant parse of the raw JSON blob. Malformed or unknown shapes come
 * back as {} (or with the bad key dropped) — the rail must render from
 * whatever an old deploy, a hand-edited row, or a future version stored.
 * minAccess values outside the tier vocabulary are dropped rather than
 * kept: an unknown tier would otherwise fall through canAccessTier's
 * ladder as "org-admin" and hide the app from nearly everyone.
 */
export function parseOrgAppsConfig(raw: unknown): OrgAppsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: OrgAppsConfig = {};

  const order = stringArray(o.order);
  if (order) out.order = order;

  const hidden = stringArray(o.hidden);
  if (hidden) out.hidden = hidden;

  if (o.minAccess && typeof o.minAccess === "object" && !Array.isArray(o.minAccess)) {
    const minAccess: Record<string, string> = {};
    for (const [key, tier] of Object.entries(o.minAccess as Record<string, unknown>)) {
      if (typeof tier === "string" && VALID_TIERS.has(tier)) minAccess[key] = tier;
    }
    if (Object.keys(minAccess).length > 0) out.minAccess = minAccess;
  }

  return out;
}

/** config.order first (unknown keys silently skipped — an app may have been
 *  removed from the catalog), then everything else in catalog order. */
function orderApps<T extends AppLike>(apps: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return apps;
  const byKey = new Map(apps.map((a) => [a.key, a]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    const app = byKey.get(key);
    if (app && !seen.has(key)) {
      out.push(app);
      seen.add(key);
    }
  }
  for (const app of apps) {
    if (!seen.has(app.key)) out.push(app);
  }
  return out;
}

/**
 * The one hub that is not its own module (spec-shell §1.4). Announcements is
 * not module-gated and lives in the Talk hub, so the hub stays visible with the
 * Talk module off whenever the viewer may see the folded app named here. The
 * key is the module app key; the value is the folded app that keeps the hub
 * alive. Every other module app disappears with its module.
 */
const MODULE_HUB_SURVIVES_ON: Readonly<Record<string, string>> = {
  chat: "announcements",
  // Forms is core (founder decision D15): with the spreadsheets module off the
  // Tables hub still holds Forms, the same shape as Talk and Announcements.
  tables: "forms",
};

/** The org floor for one app, or undefined when unset/invalid/alwaysPinned. */
function orgFloor(config: OrgAppsConfig, app: AppLike): AccessTier | undefined {
  if (app.alwaysPinned) return undefined; // escape hatch — never floored
  const tier = config.minAccess?.[app.key];
  return typeof tier === "string" && VALID_TIERS.has(tier) ? (tier as AccessTier) : undefined;
}

/**
 * The apps one user's rail shows, resolved from the org config + their
 * access level. This is the whole visibility story — there is no personal
 * pin state anymore.
 */
export function visibleRailApps<T extends AppLike = AppEntry>(opts: {
  // undefined tolerated (= {}) so callers can pass a not-yet-hydrated
  // config without a guard — the rail must render something immediately.
  config: OrgAppsConfig | undefined;
  accessLevel: string | undefined;
  apps?: readonly T[];
  // The rail app keys of the premium modules the org has ACTIVE. undefined
  // until /api/preferences answers; a module app is hidden while unknown so an
  // org that never enabled it never flashes it. Core apps ignore this.
  activeModules?: ReadonlySet<string>;
  // Keep the folded apps (the ones carrying a hubKey) in the result. The rail
  // never wants them — they have no icon of their own — but a launcher or a
  // search palette does, and leaving them out is what made the 19 folded apps
  // unreachable from the "More" grid. Every other filter still applies, so an
  // app the org hid or the viewer cannot access never resurfaces this way.
  includeFolded?: boolean;
}): T[] {
  const { accessLevel, activeModules, includeFolded } = opts;
  const config = opts.config ?? {};
  const catalog = (opts.apps ?? (APPS as unknown as readonly T[])) as readonly T[];
  const hidden = new Set(config.hidden ?? []);

  // Is this app allowed for this viewer once the org config and the catalog
  // baseline are both applied? Used for the app itself and for the folded app
  // that keeps a module hub alive.
  const allowed = (cfg: OrgAppsConfig, hiddenSet: Set<string>, app: AppLike): boolean => {
    if (hiddenSet.has(app.key) && !app.alwaysPinned) return false;
    if (!tierAllows(app.requiredAccess, accessLevel)) return false;
    const floor = orgFloor(cfg, app);
    return !(floor && !tierAllows(floor, accessLevel));
  };

  const resolve = (cfg: OrgAppsConfig, hiddenSet: Set<string>) =>
    orderApps(
      catalog.filter((app) => {
        // Folded into a hub — kept in the catalog + reachable by route/search/
        // launcher, but not its own rail icon. `hubKey` names the hub whose
        // sidebar carries its rows (src/lib/nav/route-hub.ts FOLDED_APP_HUB);
        // an app WITHOUT one is a hub itself.
        if (app.hubKey && !app.alwaysPinned && !includeFolded) return false;
        // Premium module: hidden unless the org has it ACTIVE. Applied in both
        // the primary and the last-ditch fallback resolve, so a pathological
        // all-hidden config can't resurface a disabled module.
        if (MODULE_APP_KEYS.has(app.key) && !activeModules?.has(app.key)) {
          // ...unless a NON-module app folded into this hub keeps it alive.
          // Talk is the only one: with the module off the hub still holds
          // Announcements, so dropping it would leave that app with no hub at
          // all (spec-shell §1.4). The keeper runs the same org/access gate,
          // so this never widens what the viewer may see.
          const keeperKey = MODULE_HUB_SURVIVES_ON[app.key];
          const keeper = keeperKey ? catalog.find((a) => a.key === keeperKey) : undefined;
          if (!keeper || !allowed(cfg, hiddenSet, keeper)) return false;
        }
        // A folded app of an off module goes with the module (spec-shell
        // §1.4: a module-off app is absent for everyone), so Forms cannot
        // outlive Tables in the palette. The keeper (Announcements under
        // Talk) is the one exception, by the same table as above.
        if (
          app.hubKey &&
          MODULE_APP_KEYS.has(app.hubKey) &&
          !activeModules?.has(app.hubKey) &&
          MODULE_HUB_SURVIVES_ON[app.hubKey] !== app.key
        ) {
          return false;
        }
        // Catalog baseline first — the org can only TIGHTEN access, never
        // widen it (applies to alwaysPinned apps too).
        return allowed(cfg, hiddenSet, app);
      }),
      cfg.order,
    );

  const visible = resolve(config, hidden);
  if (visible.length > 0) return visible;

  // Last-ditch guarantee: a pathological config (everything hidden AND no
  // alwaysPinned app in the catalog) must not produce an empty rail — the
  // user would have no way to navigate. Ignore the org's hidden/minAccess
  // and fall back to the plain baseline-accessible catalog.
  return resolve({ order: config.order }, new Set());
}

/**
 * The admin page's view: EVERY manageable catalog app in the org's order,
 * flagged with its stored config. Nothing is filtered by access here — the
 * admin edits apps they may not use themselves. alwaysPinned apps report
 * their EFFECTIVE state (never hidden, never floored) even if stale config
 * says otherwise, so the UI shows the truth and can disable those controls.
 */
export function orderedCatalogForAdmin(
  rawConfig: OrgAppsConfig | undefined, // undefined tolerated (= {})
  apps: typeof APPS = APPS,
): { app: AppEntry; hidden: boolean; minAccess: string | null }[] {
  const config = rawConfig ?? {};
  const hidden = new Set(config.hidden ?? []);
  // hideFromCatalog entries (e.g. a synthetic "More" tile) are not real
  // rail apps — nothing to manage.
  const manageable = apps.filter((a) => !a.hideFromCatalog);
  return orderApps(manageable, config.order).map((app) => ({
    app,
    hidden: app.alwaysPinned ? false : hidden.has(app.key),
    minAccess: orgFloor(config, app) ?? null,
  }));
}
