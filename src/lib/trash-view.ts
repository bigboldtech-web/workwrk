// The Trash vocabulary: one type table, one id scheme, one retention sum.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// WHY THIS FILE EXISTS. Four surfaces called something Trash and none of them
// agreed: /trash knew twelve entity strings in its own TYPE_META map, /docs
// had its own trash page, /docs?view=archived was a third list of the same
// rows, and /agreements?view=trash a fourth. They are one page now, and the
// words on it are decided here so the page, the route, the CSV and the tests
// read the same table.
//
// Pure: no prisma, no React. Every rule below is unit-tested.

/** Everything the one Trash can hold. */
export type TrashTypeKey =
  | "space" | "folder" | "list" | "task"
  | "doc" | "canvas" | "table" | "form" | "file"
  | "sop" | "policy" | "contract" | "template";

export interface TrashTypeDef {
  key: TrashTypeKey;
  label: string;
  /** The `TrashItem.entityType` strings that mean this type. */
  entityTypes: readonly string[];
}

/**
 * The Filter panel's Type list, in the spec's order. Form is here because
 * forms become deletable for the first time; Contract is here because the
 * Contracts trash view merges in.
 */
export const TRASH_TYPES: readonly TrashTypeDef[] = [
  { key: "space", label: "Space", entityTypes: ["space"] },
  { key: "folder", label: "Folder", entityTypes: ["folder"] },
  { key: "list", label: "List", entityTypes: ["board"] },
  { key: "task", label: "Task", entityTypes: ["item"] },
  // "note" is what the Doc registry entry has always been called on disk.
  { key: "doc", label: "Doc", entityTypes: ["note", "doc"] },
  { key: "canvas", label: "Canvas", entityTypes: ["whiteboard"] },
  { key: "table", label: "Table", entityTypes: ["table"] },
  { key: "form", label: "Form", entityTypes: ["form"] },
  { key: "file", label: "File", entityTypes: ["file"] },
  { key: "sop", label: "SOP", entityTypes: ["sop"] },
  { key: "policy", label: "Policy", entityTypes: ["policy"] },
  { key: "contract", label: "Contract", entityTypes: ["contract"] },
  { key: "template", label: "Template", entityTypes: ["template"] },
] as const;

export const TRASH_TYPE_BY_KEY: Readonly<Record<TrashTypeKey, TrashTypeDef>> =
  Object.fromEntries(TRASH_TYPES.map((t) => [t.key, t])) as Record<TrashTypeKey, TrashTypeDef>;

const ENTITY_TO_KEY: Readonly<Record<string, TrashTypeKey>> = Object.fromEntries(
  TRASH_TYPES.flatMap((t) => t.entityTypes.map((e) => [e, t.key])),
);

/**
 * The type key for a stored `TrashItem.entityType`. Returns null for a string
 * no type claims, and the page renders such a row under its raw word rather
 * than hiding it: a row nobody can name is still a row somebody deleted.
 */
export function typeKeyFor(entityType: string): TrashTypeKey | null {
  return ENTITY_TO_KEY[entityType] ?? null;
}

/** `?type=` accepts the key and the stored entity word, so old links land. */
export function typeFromParam(raw: string | null | undefined): TrashTypeKey | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === "all") return null;
  if (v in TRASH_TYPE_BY_KEY) return v as TrashTypeKey;
  return ENTITY_TO_KEY[v] ?? null;
}

/**
 * A comma list of ids from one query parameter (`?deletedBy=`, `?spaceId=`).
 *
 * The Filter panel's People and Location groups are checkboxes, so they narrow
 * the whole set the same way `?type=` does. Blank entries are dropped, and an
 * absent parameter means "every one of them", never "none".
 */
export function idsFromParam(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * `?type=` as a LIST.
 *
 * The parameter has always been single-valued in the links that write it
 * (`/trash?type=doc`), and the page's Filter panel is a set of checkboxes, so
 * the client used to send one type and filter any extra ones over the 40 rows
 * it happened to be holding. That made the footer's "Total records" the
 * unfiltered number, the range wrong, and every matching row on a later page
 * invisible. A comma list keeps every old single-value link working and moves
 * the whole filter back to the server.
 */
export function typesFromParam(raw: string | null | undefined): TrashTypeKey[] {
  if (!raw) return [];
  const out: TrashTypeKey[] = [];
  for (const part of raw.split(",")) {
    const key = typeFromParam(part);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

export type TrashTab = "deleted" | "archived";

export function tabFromParam(raw: string | null | undefined): TrashTab {
  return raw === "archived" ? "archived" : "deleted";
}

export const TRASH_SORTS = [
  { value: "recent", label: "Deleted (newest)" },
  { value: "name", label: "Name" },
  { value: "expiry", label: "Time left" },
] as const;
export type TrashSort = (typeof TRASH_SORTS)[number]["value"];

export function sortFromParam(raw: string | null | undefined): TrashSort {
  return raw === "name" || raw === "expiry" ? raw : "recent";
}

/** The org default when `settings.retention.trashDays` is unset (settings G19). */
export const DEFAULT_TRASH_DAYS = 60;

export function retentionDays(stored: unknown): number {
  const n = typeof stored === "number" ? stored : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_TRASH_DAYS;
  // A zero or negative retention would purge on the same day it deleted, which
  // is not a setting anybody means; the floor is one day.
  return Math.max(1, Math.min(3650, Math.round(n)));
}

/**
 * Whole days left before the purge, never below zero.
 *
 * An archived row returns null: archives never expire, which is the whole
 * difference between the two tabs.
 */
export function daysLeft(deletedAt: Date | string, days: number, now: Date = new Date()): number {
  const t = typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt.getTime();
  if (!Number.isFinite(t)) return days;
  const elapsed = (now.getTime() - t) / 86_400_000;
  return Math.max(0, Math.ceil(days - elapsed));
}

/** Under a week left is the one place this page uses a danger colour. */
export function isExpiringSoon(left: number | null): boolean {
  return left !== null && left < 7;
}

/* ─────────────────────────── the row id scheme ─────────────────────────── */

/**
 * A Trash row is either a `TrashItem` snapshot (a hard delete that was
 * captured) or a live row carrying `archivedAt`. The two live in different
 * tables, so the id says which: a bare cuid is a snapshot, and a prefixed id
 * is an archived row of that type.
 *
 * The three legacy prefixes (`doc:`, `wb:`, `agr:`) are kept exactly as they
 * were so a link or a queued action from the old page still resolves.
 */
export const ARCHIVE_PREFIX: Readonly<Record<string, TrashTypeKey>> = {
  doc: "doc",
  wb: "canvas",
  agr: "contract",
  space: "space",
  folder: "folder",
  board: "list",
  item: "task",
};

export interface ParsedRowId {
  /** null when the id names a TrashItem snapshot. */
  archive: { prefix: string; type: TrashTypeKey; id: string } | null;
  snapshotId: string | null;
}

export function parseRowId(rowId: string): ParsedRowId {
  const at = rowId.indexOf(":");
  if (at > 0) {
    const prefix = rowId.slice(0, at);
    const type = ARCHIVE_PREFIX[prefix];
    if (type) return { archive: { prefix, type, id: rowId.slice(at + 1) }, snapshotId: null };
  }
  return { archive: null, snapshotId: rowId };
}

export function archiveRowId(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

/* ────────────────────────────── the CSV ────────────────────────────── */

export interface TrashCsvRow {
  name: string;
  type: string;
  location: string;
  deletedByName: string;
  deletedAt: string;
  timeLeft: string;
}

/** RFC 4180: quote everything, double the quotes inside. */
export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function trashCsv(rows: readonly TrashCsvRow[], tab: TrashTab): string {
  const head = tab === "archived"
    ? ["Name", "Type", "Location", "Archived by", "Archived"]
    : ["Name", "Type", "Location", "Deleted by", "Deleted", "Time left"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const cells = tab === "archived"
      ? [r.name, r.type, r.location, r.deletedByName, r.deletedAt]
      : [r.name, r.type, r.location, r.deletedByName, r.deletedAt, r.timeLeft];
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
