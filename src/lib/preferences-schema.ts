// The PATCH /api/preferences body schema (settings-architecture.md section
// 9.3) and the merge rule the route applies, both pure so vitest proves:
//
//   1. WIDENING ONLY. Every body the previous schema accepted is accepted
//      unchanged (no key became required, no enum shrank). The one intended
//      exception is spelled out in rule 2.
//   2. STRICT in every namespace this schema owns. A stray key there is a
//      400 that names it, never a silent strip. This is the mechanism fix
//      for critic S7: Inbox display prefs were sent as a top-level `inbox`
//      key, stripped, and never persisted; My Tasks sent
//      `home.taskCardLayoutV3`, also stripped. (The previous schema accepted
//      such bodies and threw the key away; rejecting them is the deliberate
//      narrowing spec 9.3 asks for, and the test names it.) Objects owned by
//      a library (react-grid-layout items) are loose: kept whole, never
//      rejected for a key this file does not list.
//   3. DEEP MERGE. `mergePreferencePatch` merges plain objects recursively
//      and replaces arrays and scalars, so PATCHing
//      `{ home: { notifications: { inboxView } } }` keeps `inbox` and
//      `email` (the previous shallow spread would have dropped them).
//
// Lives under src/lib (not in the route file) because vitest only includes
// src/lib/**/*.test.ts; the route imports it and behaves exactly as before
// for every body that was valid before.

import { z } from "zod";

// ── Reused fragments ──────────────────────────────────────────────

const stringList = z.array(z.string());
const boolRecord = z.record(z.string(), z.boolean());

const resizeHandleAxis = z.enum(["s", "w", "e", "n", "sw", "nw", "se", "ne"]);

/**
 * react-grid-layout per-breakpoint shape: { lg: [{ i, x, y, w, h }], ... }
 *
 * The item is LOOSE on purpose: these objects are react-grid-layout's own
 * (its `cloneLayoutItem` carries every key below and a client forwards them
 * verbatim), not a namespace this schema owns, so an item key it does not
 * name is kept as sent rather than rejected. That is both the widening rule
 * (the previous strip-mode schema accepted any item key) and the no-silent-
 * strip rule (nothing visible is dropped). The keys that ARE named are typed.
 */
const gridLayout = z.record(
  z.string(),
  z.array(
    z.looseObject({
      i: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      minW: z.number().optional(),
      maxW: z.number().optional(),
      minH: z.number().optional(),
      maxH: z.number().optional(),
      static: z.boolean().optional(),
      isDraggable: z.boolean().optional(),
      isResizable: z.boolean().optional(),
      isBounded: z.boolean().optional(),
      resizeHandles: z.array(resizeHandleAxis).optional(),
      moved: z.boolean().optional(),
    }),
  ),
);

// ── sidebar ───────────────────────────────────────────────────────

export const sidebarPatchSchema = z.strictObject({
  // Legacy pinning keys: accepted and ignored for one release (spec 9.3).
  pinned: stringList.optional(),
  hidden: stringList.optional(),
  order: stringList.optional(),
  iconsOnly: z.boolean().optional(),
  sectionsOrder: stringList.optional(),
  // 9.2 personal sidebar state, moving out of localStorage.
  width: z.number().int().min(160).max(600).optional(),
  collapsed: z.boolean().optional(),
  quickTools: stringList.optional(),
  collapsedSections: stringList.optional(),
  hiddenSections: stringList.optional(),
  // ORG-ONLY: the rail config lives on OrgPreference.sidebarDefault.apps and
  // getEffectivePreferences re-stamps it from the org row. Accepted here so
  // a typed client body that carries it is not a 400, then DROPPED by the
  // route before the write (`stripOrgOnlyKeys`), exactly as before.
  apps: z.unknown().optional(),
});

// ── home ──────────────────────────────────────────────────────────

/** Inbox display prefs (was a stripped top-level `inbox` key; spec 7.3). */
export const inboxViewSchema = z.strictObject({
  showAll: z.boolean().optional(),
  groupByDate: z.boolean().optional(),
  sortNewest: z.boolean().optional(),
  mode: z.enum(["fullscreen", "inline"]).optional(),
});

export const quietHoursSchema = z.strictObject({
  /** "HH:MM" local. */
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  /** 0 = Sunday .. 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).optional(),
  enabled: z.boolean().optional(),
});

export const notificationsPatchSchema = z.strictObject({
  inbox: boolRecord.optional(),
  email: boolRecord.optional(),
  inboxView: inboxViewSchema.optional(),
  /** ISO timestamp or null to unmute. */
  mutedUntil: z.string().nullable().optional(),
  quietHours: quietHoursSchema.optional(),
  /** Muted object ids ("space:abc", "list:def"). */
  muted: stringList.optional(),
  desktop: z.boolean().optional(),
  reminderEmail: z.boolean().optional(),
});

export const localePatchSchema = z.strictObject({
  language: z.string().max(16).optional(),
  timezone: z.string().max(64).optional(),
  /** 0 = Sunday .. 6 = Saturday. */
  weekStart: z.number().int().min(0).max(6).optional(),
  dateFormat: z.string().max(32).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
});

export const uiPatchSchema = z.strictObject({
  reducedMotion: z.boolean().optional(),
  showUpcoming: z.boolean().optional(),
  /** Dismissed banner and tip ids. */
  dismissed: stringList.optional(),
  contrast: z.enum(["normal", "high"]).optional(),
});

export const workPatchSchema = z.strictObject({
  savedFilters: z.array(z.unknown()).optional(),
  pinnedViews: stringList.optional(),
  /** Per-view TaskListSurface options, keyed by view id. */
  surface: z.record(z.string(), z.unknown()).optional(),
});

export const homePatchSchema = z.strictObject({
  cards: stringList.optional(),
  order: stringList.optional(),
  favoriteBoardIds: stringList.optional(),
  favoriteSpaceIds: stringList.optional(),
  favoriteDocIds: stringList.optional(),
  favoriteFolderIds: stringList.optional(),
  favoriteTableIds: stringList.optional(),
  favoriteWhiteboardIds: stringList.optional(),
  favoriteFileIds: stringList.optional(),
  taskCardLayout: gridLayout.optional(),
  /** The key My Tasks actually writes (was stripped, so the layout never persisted). */
  taskCardLayoutV3: gridLayout.optional(),
  taskCardsHidden: stringList.optional(),
  overviewCardLayout: gridLayout.optional(),
  overviewCardsHidden: stringList.optional(),
  notifications: notificationsPatchSchema.optional(),
  locale: localePatchSchema.optional(),
  ui: uiPatchSchema.optional(),
  work: workPatchSchema.optional(),
});

// ── theme, density ────────────────────────────────────────────────

export const themePatchSchema = z.strictObject({
  appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
  accent: z.string().max(40).optional(),
  /** Navy (default) or Light chrome (spec-shell 1.9). */
  chrome: z.enum(["navy", "light"]).optional(),
});

export const densityPatchSchema = z.enum(["compact", "cozy", "comfortable"]);

export const preferencesPatchSchema = z.strictObject({
  sidebar: sidebarPatchSchema.optional(),
  home: homePatchSchema.optional(),
  theme: themePatchSchema.optional(),
  density: densityPatchSchema.optional(),
});

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
/** What reaches the write path: the patch minus the org-only keys. */
export type PreferencesWrite = Omit<PreferencesPatch, "sidebar"> & {
  sidebar?: Omit<NonNullable<PreferencesPatch["sidebar"]>, "apps">;
};

/** Keys a personal PATCH may carry but never writes (org-level). */
export function stripOrgOnlyKeys(patch: PreferencesPatch): PreferencesWrite {
  if (!patch.sidebar) return patch as PreferencesWrite;
  const { apps: _apps, ...sidebar } = patch.sidebar;
  return { ...patch, sidebar };
}

/**
 * The 400 body: every issue names the key it rejects. zod reports an
 * unknown key as one `unrecognized_keys` issue on the PARENT with the key
 * names in `keys`, so those are expanded to one row per key.
 */
export function describeIssues(issues: { path: PropertyKey[]; message: string; code?: string; keys?: string[] }[]): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  for (const i of issues) {
    const base = i.path.map(String);
    if (i.code === "unrecognized_keys" && Array.isArray(i.keys) && i.keys.length > 0) {
      for (const k of i.keys) out.push({ path: [...base, k].join("."), message: `Unknown key "${k}"` });
    } else {
      out.push({ path: base.join(".") || "(root)", message: i.message });
    }
  }
  return out;
}

// ── Deep merge ────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * Merge a patch into what is stored: plain objects recurse, arrays and
 * scalars replace, `undefined` in the patch leaves the stored value alone,
 * `null` is stored as null (the explicit "clear" for nullable keys such as
 * `notifications.mutedUntil`). Never mutates either input.
 */
export function deepMergePatch<T extends object>(existing: T | null | undefined, patch: object | null | undefined): T {
  const out: Record<string, unknown> = { ...((existing ?? {}) as Record<string, unknown>) };
  if (!patch) return out as T;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (isPlainObject(value) && isPlainObject(prev)) {
      out[key] = deepMergePatch(prev, value);
    } else if (isPlainObject(value)) {
      out[key] = deepMergePatch({}, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
