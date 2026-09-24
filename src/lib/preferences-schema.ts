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
import { isAccentKey } from "@/lib/accents";

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
  // 9.2 personal Spaces-tree state (spec-spaces-lists section 4). Today the
  // tree keeps both in module-level Maps that a reload throws away, so an
  // expanded Space collapses on every navigation. `expanded` holds the ids of
  // open Space and Folder rows; `hiddenSpaceIds` holds the Spaces the viewer
  // chose to hide from their own tree (never a grant, the Space stays
  // reachable from /spaces, which is what "Show hidden Spaces" reopens).
  expanded: stringList.optional(),
  hiddenSpaceIds: stringList.optional(),
  // Docs hub tree state (spec-docs-knowledge section 4, change request G22a).
  // `docsTreeOpen` holds the ids of expanded rows in the DOCS section's doc
  // tree; `docsFoldersOpen` the expanded drive folders under the Files row.
  // Both were localStorage ("workwrk:docs:pages-open"), which is why an
  // expanded branch collapsed on another device. They are rendered sidebar
  // state, so sidebar-map section 0 puts them here.
  docsTreeOpen: stringList.optional(),
  docsFoldersOpen: stringList.optional(),
  // Whether the Files ROW itself is expanded, as opposed to which folders
  // inside it are (`docsFoldersOpen`, above). It was React state, so the row
  // closed on every load and the folder ids that WERE persisted stayed
  // invisible until somebody clicked the chevron again. A boolean and not a
  // member of `collapsedSections`, because that list is keyed
  // `{hub}.{section}` and holds SECTIONS, and because this row starts
  // collapsed: "absent means collapsed" and "absent means expanded" cannot
  // both be true of one list.
  docsFilesOpen: z.boolean().optional(),
  // ORG-ONLY: the rail config lives on OrgPreference.sidebarDefault.apps and
  // getEffectivePreferences re-stamps it from the org row. Accepted here so
  // a typed client body that carries it is not a 400, then DROPPED by the
  // route before the write (`stripOrgOnlyKeys`), exactly as before.
  apps: z.unknown().optional(),
});

// ── home ──────────────────────────────────────────────────────────

/**
 * Inbox display prefs (was a stripped top-level `inbox` key; spec 7.3).
 *
 * Every switch in the Inbox's "…" > Inbox options writes here, and this is a
 * `strictObject`, so a key the Inbox writes and this schema does not name is a
 * 400 and a preference that silently never persists. That is exactly what used
 * to happen: the page PATCHed a top-level `{ inbox }` that the schema stripped,
 * so not one of its display switches survived a reload.
 */
export const inboxViewSchema = z.strictObject({
  /** "Show everything in Other": Other also lists the Primary rows. */
  showAll: z.boolean().optional(),
  groupByDate: z.boolean().optional(),
  sortNewest: z.boolean().optional(),
  /**
   * Days after which READ rows are swept by the daily auto-clear cron
   * (scripts/CRON-SETUP.md). `null` is "Never", which is the default: nothing
   * deletes a person's notifications unless they asked for it.
   */
  autoClearDays: z.number().int().min(1).max(365).nullable().optional(),
  /** Which tab the Inbox opens on. Only the three a person reads. */
  defaultTab: z.enum(["primary", "other", "mentions"]).optional(),
  /**
   * Legacy: "Fullscreen vs Inline", two modes that rendered the same list.
   * Accepted and ignored for one release (spec 9.3), then removed.
   */
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
  /**
   * "Ring for incoming calls" (spec-talk.md section 4 step 10).
   *
   * A SIBLING of `desktop`, not a child of it, and deliberately so:
   * settings-architecture section 4.3 defines `desktop` as a plain boolean
   * for "Browser notifications", and .strict() would reject a child key
   * under a boolean anyway. The row on My settings > Notifications >
   * Desktop greys out with the caption "Turn on browser notifications
   * first" when the parent is off; it does not disappear, because the
   * preference is still the person's and still remembered.
   */
  desktopRingCalls: z.boolean().optional(),
  reminderEmail: z.boolean().optional(),
  /**
   * The state the reminder panel's "Also email me" switch opens in
   * (spec-planner.md section 2 Reminders, open question 1: recommendation
   * "off, with the last choice remembered per user").
   *
   * A SEPARATE key from `reminderEmail`, which is the Notifications page's
   * "email me about reminders at all" row: this one is only the default
   * position of a switch inside one panel, and a person who turns it on
   * once for one reminder has not asked to be emailed about every future
   * one.
   */
  reminderEmailDefault: z.boolean().optional(),
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
  /**
   * The SOP page's Details strip, collapsed or not (spec-process section 2,
   * `/sops/[id]`). A remembered panel state, not a setting shown in a door,
   * so it takes no settings-registry entry.
   */
  sopDetailsCollapsed: z.boolean().optional(),
  /** The Policies and Contracts lists' view-type switcher (spec-process section 2). */
  policiesViewType: z.enum(["list", "cards"]).optional(),
  contractsViewType: z.enum(["list", "cards"]).optional(),
});

// ── Docs hub per-surface options (change request G22a) ────────────
//
// Four small namespaces under `home`, one per Docs-hub list surface. Every
// one of them is a remembered display option with a control behind it, and an
// option with no key here is a 400.
//
// THEY ARE REGISTERED AHEAD OF THEIR SURFACES, ON PURPOSE. The readers live
// in src/lib/docs-prefs.ts with a default per field and are unit-tested there;
// the controls that WRITE them land with the list pages (spec-docs-knowledge
// section 4 step 4), which is a later stage than the sidebar. Registering the
// key first is safe (a key nobody writes is simply never stored) and it is
// what keeps the list-page stage from being blocked on a schema change.

/** Which optional columns a list shows. Keyed by column id, value = shown. */
const columnToggles = boolRecord;

/** Card grid or table, on the two surfaces that offer both. */
const viewType = z.enum(["grid", "list"]);

export const docsSurfaceSchema = z.strictObject({
  columns: columnToggles.optional(),
  /** The doc editor's heading outline gutter, on or off. */
  outline: z.boolean().optional(),
});

export const canvasSurfaceSchema = z.strictObject({
  viewType: viewType.optional(),
  columns: columnToggles.optional(),
});

export const filesSurfaceSchema = z.strictObject({
  viewType: viewType.optional(),
  columns: columnToggles.optional(),
});

/**
 * The SOP library's Display options (spec-process section 2 `/sops`: Show
 * folder path, Show tags, Show owner, Show assigned count) and the Run
 * history's remembered drawer width rides `home.work.drawerWidth`.
 */
export const sopsSurfaceSchema = z.strictObject({
  columns: columnToggles.optional(),
});

export const notetakerSurfaceSchema = z.strictObject({
  /**
   * The List a saved meeting note's action items go to, remembered so the
   * picker opens on last time's answer. `null` clears it.
   */
  lastListId: z.string().max(64).nullable().optional(),
});

/**
 * `home.work.surface` is keyed by view id AND by a small set of reserved
 * surface names (spec-work-home and spec-spaces-lists both write per-surface
 * view options). Two writers share one namespace, so the reserved names are
 * listed here and nowhere else; a view id can never collide with one because
 * ids are cuids and every reserved name is a lowercase word.
 */
export const RESERVED_SURFACE_KEYS: readonly string[] = [
  "home",
  "my-work",
  "everything",
  "favorites",
  "inbox",
  "activity",
  "spaces",
  "space",
  "folder",
  "templates",
  "trash",
];

export const workPatchSchema = z.strictObject({
  savedFilters: z.array(z.unknown()).optional(),
  /**
   * /everything's saved views, same shape as `savedFilters` (SavedWorkFilter).
   *
   * A separate key, not a shared one: /my-work is "tasks assigned to me" and
   * /everything is "every task I can see", so a view saved on one describes a
   * set the other does not have. spec-work-home section 2 (/everything) names
   * `home.work.everythingFilters[]` for exactly that reason.
   */
  everythingFilters: z.array(z.unknown()).optional(),
  pinnedViews: stringList.optional(),
  /**
   * Per-surface and per-view options, keyed by view id or by one of
   * RESERVED_SURFACE_KEYS. Loose values: each surface owns its own shape.
   */
  surface: z.record(z.string(), z.unknown()).optional(),
  /**
   * Per-viewer overrides of a shared saved view (sort, group, columns) so one
   * person re-sorting a shared view never re-sorts it for the team. Keyed by
   * view id.
   */
  viewOverrides: z.record(z.string(), z.unknown()).optional(),
  /**
   * Which task-detail fields the viewer keeps visible, per List
   * (spec-task-detail section 2, the "+ Add field" door). Keyed by List id;
   * the value is the checked field keys. A field that HAS a value is shown
   * whether or not it is checked, that rule lives in the reader, not here.
   */
  itemFields: z.record(z.string(), stringList).optional(),
  /** Task drawer width in pixels; the design system clamps it to 480..720. */
  drawerWidth: z.number().int().min(480).max(720).optional(),
});

// ── Planner and Timesheets display options (Phase 4) ──────────────
//
// spec-planner.md section 2 names every one of these and its default. They
// are personal preferences (settings section 9.2 storage class), written by
// the Calendar's Display menu, its filter panel and the Timesheets Display
// menu, and read per field with an explicit default.
//
// THEY HAD TO LAND FIRST. `homePatchSchema` is a z.strictObject, so before
// this block ANY patch carrying home.planner.* or home.timesheets.* was a
// 400 naming the key, which would have made every switch on those two
// toolbars cosmetic: it would appear to work and reset on the next load.
//
// READ THEM PER FIELD, NEVER BY SPREADING THE NAMESPACE.
// getEffectivePreferences merges `home` with a SHALLOW spread
// (src/lib/preferences.ts), so an org-level `home.planner` object is
// REPLACED WHOLE by any user-level one rather than merged into it. A reader
// that spreads the namespace silently loses org defaults for every key the
// user never set. `plannerPrefs()` and `timesheetPrefs()` in
// src/lib/planner-prefs.ts are the readers, and they take one field at a
// time with the default written beside it.

export const plannerSurfaceSchema = z.strictObject({
  /** Last used Calendar view. Week on a first load. */
  view: z.enum(["week", "month", "people"]).optional(),
  /** Which kinds render. Default: all five on. */
  sources: stringList.optional(),
  showWeekends: z.boolean().optional(),
  /** Google events the viewer declined. Default off. */
  showDeclined: z.boolean().optional(),
  showReminders: z.boolean().optional(),
  highlightWorkHours: z.boolean().optional(),
  /** The right-hand Unscheduled tasks panel. Default off. */
  showUnscheduled: z.boolean().optional(),
});

export const timesheetsSurfaceSchema = z.strictObject({
  /** The note under an entry title. Default ON. */
  showNotes: z.boolean().optional(),
  /** "From timer" / "Clocked" / "Manual" / "Imported". Default ON. */
  showSource: z.boolean().optional(),
});

// ── Tables hub surfaces (spec-tables-forms section 2, Phase 5) ──────
//
// Personal preferences, read per field with the default written beside the
// reader in src/lib/tables-prefs.ts (never by spreading the namespace, the
// shallow-merge rule above). The pivot CONFIGURATION is not here: it lives in
// home.work.surface["table:{id}"].pivot, the per-surface key settings 7.3
// names for it, which the loose record already accepts.

export const tablesSurfaceSchema = z.strictObject({
  /** /tables Display: Location, Rows, Owner, Last updated. Default all on. */
  columns: boolRecord.optional(),
  /** The sheet's View > Gridlines. Default on. */
  gridlines: z.boolean().optional(),
  /** The sheet's View > Formula bar. Default on. */
  formulaBar: z.boolean().optional(),
});

export const formsSurfaceSchema = z.strictObject({
  /** /forms Display: Goes to, Responses, Status, Owner, Last updated. Default all on. */
  columns: boolRecord.optional(),
  /** The builder's Display: Show help text. Default on. */
  showHelpText: z.boolean().optional(),
  /** The builder's Display: Show field numbers. Default off. */
  showFieldNumbers: z.boolean().optional(),
});

export const homePatchSchema = z.strictObject({
  cards: stringList.optional(),
  order: stringList.optional(),
  favoriteBoardIds: stringList.optional(),
  favoriteSpaceIds: stringList.optional(),
  favoriteDocIds: stringList.optional(),
  favoriteFolderIds: stringList.optional(),
  favoriteTableIds: stringList.optional(),
  favoriteFormIds: stringList.optional(),
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
  // Docs hub surfaces (spec-docs-knowledge section 4, change request G22a).
  docs: docsSurfaceSchema.optional(),
  canvas: canvasSurfaceSchema.optional(),
  files: filesSurfaceSchema.optional(),
  notetaker: notetakerSurfaceSchema.optional(),
  // The SOP library's Display options (spec-process section 2 `/sops`).
  sops: sopsSurfaceSchema.optional(),
  // Planner hub surfaces (spec-planner.md section 2, Phase 4).
  planner: plannerSurfaceSchema.optional(),
  timesheets: timesheetsSurfaceSchema.optional(),
  // Tables hub surfaces (spec-tables-forms section 2, Phase 5).
  tables: tablesSurfaceSchema.optional(),
  forms: formsSurfaceSchema.optional(),
});

// ── theme, density ────────────────────────────────────────────────

export const themePatchSchema = z.strictObject({
  appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
  /**
   * One of the Customize panel's swatches (src/lib/accents.ts), or "" to
   * clear. The domain used to be any string, so a stray value stamped
   * itself verbatim on <html data-accent> and silently fell back to blue;
   * every live writer (Customize, Account > Appearance) offers only these
   * keys, so nothing a client sends today is refused.
   */
  accent: z.string().max(40).refine((v) => v === "" || isAccentKey(v), { message: "Unknown accent" }).optional(),
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
