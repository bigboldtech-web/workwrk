// docs-prefs.ts — the Docs hub's preference readers, defaulting PER FIELD.
//
// Spec: docs/plans/ui-refresh/spec-docs-knowledge.md section 4 (change request
// G22a) and docs/plans/ui-refresh/sidebar-map.md section 0 (Persistence).
//
// WHY PER FIELD, AND NOT A DEFAULT OBJECT. `getEffectivePreferences`
// (src/lib/preferences.ts) merges each namespace with a SHALLOW spread:
// `{ ...DEFAULT_HOME, ...orgHome, ...userHome }`. Put `docs: { columns, outline }`
// into DEFAULT_HOME and the first user row that stores `home.docs = { outline:
// true }` replaces the whole object, so `columns` silently becomes undefined
// and every column toggle reads as off. So the defaults live here, one per
// field, and a stored namespace that carries only some of its keys still reads
// correctly. Nothing here writes: callers PATCH /api/preferences themselves.
//
// Pure: no prisma, no React, no imports. Every rule below is unit-tested.

// ── Column toggles ────────────────────────────────────────────────

/**
 * The optional columns of the `/docs` table (spec section 2, `/docs`).
 * `contributors` is the column the old table had (every DocVersion author,
 * real avatars): it stays available behind Display, off by default, because
 * the spec's Owner column replaces it in the default view but a person who
 * could see who edited a doc yesterday can still turn it on.
 */
export type DocsColumnKey = "location" | "updated" | "viewed" | "owner" | "contributors";

export const DOCS_COLUMNS: readonly DocsColumnKey[] = ["location", "updated", "viewed", "owner", "contributors"];

/** Shown unless the viewer turned it off. The spec's four start on. */
export const DOCS_COLUMN_DEFAULTS: Readonly<Record<DocsColumnKey, boolean>> = {
  location: true,
  updated: true,
  viewed: true,
  owner: true,
  contributors: false,
};

/** The optional columns of the `/canvas` list view. */
export type CanvasColumnKey = "location" | "updated" | "owner";

export const CANVAS_COLUMNS: readonly CanvasColumnKey[] = ["location", "updated", "owner"];

export const CANVAS_COLUMN_DEFAULTS: Readonly<Record<CanvasColumnKey, boolean>> = {
  location: true,
  updated: true,
  owner: true,
};

/**
 * The optional columns of the `/files` list view, plus the Display toggle
 * "Show AI summaries" (`summary`), which is a row option rather than a column
 * and rides in the same map so it has one home and one writer.
 */
export type FilesColumnKey = "type" | "size" | "uploaded" | "owner" | "location" | "summary";

export const FILES_COLUMNS: readonly FilesColumnKey[] = ["type", "size", "uploaded", "owner", "location", "summary"];

export const FILES_COLUMN_DEFAULTS: Readonly<Record<FilesColumnKey, boolean>> = {
  type: true,
  size: true,
  uploaded: true,
  owner: true,
  location: true,
  summary: true,
};

// ── The readers ───────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merge a stored `{ [column]: boolean }` map over a default map. A key the
 * defaults do not name is DROPPED: a column that no longer exists must not
 * keep a stored `true` alive in the returned shape, or a renderer that loops
 * the returned keys draws a column with no data behind it.
 */
function readColumns<K extends string>(
  stored: unknown,
  defaults: Readonly<Record<K, boolean>>,
): Record<K, boolean> {
  const out: Record<K, boolean> = { ...defaults };
  if (!isRecord(stored)) return out;
  for (const key of Object.keys(defaults) as K[]) {
    const v = stored[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export function readDocsColumns(home: unknown): Record<DocsColumnKey, boolean> {
  const docs = isRecord(home) ? home.docs : undefined;
  return readColumns(isRecord(docs) ? docs.columns : undefined, DOCS_COLUMN_DEFAULTS);
}

/** The doc editor's heading-outline gutter. Off until the viewer asks for it. */
export function readDocsOutline(home: unknown): boolean {
  const docs = isRecord(home) ? home.docs : undefined;
  const v = isRecord(docs) ? docs.outline : undefined;
  return typeof v === "boolean" ? v : false;
}

/** Card grid or table. `grid` on Canvases (a visual list), `list` on Files (a drive). */
export type SurfaceViewType = "grid" | "list";

function readViewType(stored: unknown, fallback: SurfaceViewType): SurfaceViewType {
  return stored === "grid" || stored === "list" ? stored : fallback;
}

export function readCanvasViewType(home: unknown): SurfaceViewType {
  const canvas = isRecord(home) ? home.canvas : undefined;
  return readViewType(isRecord(canvas) ? canvas.viewType : undefined, "grid");
}

export function readCanvasColumns(home: unknown): Record<CanvasColumnKey, boolean> {
  const canvas = isRecord(home) ? home.canvas : undefined;
  return readColumns(isRecord(canvas) ? canvas.columns : undefined, CANVAS_COLUMN_DEFAULTS);
}

/** The drive opens as a list (spec-docs-knowledge section 2, /files: "list default"). */
export function readFilesViewType(home: unknown): SurfaceViewType {
  const files = isRecord(home) ? home.files : undefined;
  return readViewType(isRecord(files) ? files.viewType : undefined, "list");
}

export function readFilesColumns(home: unknown): Record<FilesColumnKey, boolean> {
  const files = isRecord(home) ? home.files : undefined;
  return readColumns(isRecord(files) ? files.columns : undefined, FILES_COLUMN_DEFAULTS);
}

/**
 * The List the Notetaker last sent action items to. `null` when the viewer has
 * not saved a meeting note yet, so the picker opens unset rather than on a
 * List they never chose.
 */
export function readNotetakerLastList(home: unknown): string | null {
  const nt = isRecord(home) ? home.notetaker : undefined;
  const v = isRecord(nt) ? nt.lastListId : undefined;
  return typeof v === "string" && v ? v : null;
}

/** The SOP page's Details strip. Expanded by default (spec-process section 2). */
export function readSopDetailsCollapsed(home: unknown): boolean {
  const ui = isRecord(home) ? home.ui : undefined;
  const v = isRecord(ui) ? ui.sopDetailsCollapsed : undefined;
  return typeof v === "boolean" ? v : false;
}

// ── Sidebar tree state ────────────────────────────────────────────

function readIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

/** Expanded rows of the DOCS tree. Empty = every root doc collapsed. */
export function readDocsTreeOpen(sidebar: unknown): string[] {
  return readIdList(isRecord(sidebar) ? sidebar.docsTreeOpen : undefined);
}

/** Expanded drive folders under the Files row. */
export function readDocsFoldersOpen(sidebar: unknown): string[] {
  return readIdList(isRecord(sidebar) ? sidebar.docsFoldersOpen : undefined);
}

/**
 * Whether the Files ROW is expanded. Closed until the viewer opens it, so a
 * person who never uses the drive does not pay for the folder request.
 */
export function readDocsFilesOpen(sidebar: unknown): boolean {
  const v = isRecord(sidebar) ? sidebar.docsFilesOpen : undefined;
  return typeof v === "boolean" ? v : false;
}

/**
 * Section collapse, from `sidebar.collapsedSections[]` keyed `{hub}.{section}`
 * (sidebar-map section 0, Persistence). PRESENT means collapsed, so a section
 * the viewer has never touched renders expanded, which is the default every
 * hub wants.
 */
export function isSectionCollapsed(sidebar: unknown, key: string): boolean {
  return readIdList(isRecord(sidebar) ? sidebar.collapsedSections : undefined).includes(key);
}

/** The list to PATCH after toggling one section's collapse. */
export function toggleSectionCollapsed(sidebar: unknown, key: string): string[] {
  const list = readIdList(isRecord(sidebar) ? sidebar.collapsedSections : undefined);
  return toggleExpanded(list, key);
}

/**
 * Toggle one id in a stored expansion list and return the new list.
 *
 * The list is the stored shape, so the caller PATCHes what this returns
 * verbatim. Order is preserved on removal, and an id is appended on open, so
 * the stored array never churns for a viewer who only ever opens rows.
 */
export function toggleExpanded(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
