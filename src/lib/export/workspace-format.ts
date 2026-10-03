// What the whole-workspace export writes (GET /api/export/all), as pure
// functions the route and the tests share: the file names, which Docs are
// notes, a task's row with its description, checklist, tags and field
// values, and a comment's row. Text people wrote goes out exactly as stored
// (Markdown today, HTML for older rows): an export is a copy.
//
// WHAT IS IN IT is what an org Owner or Admin can open in the app, because
// only they may run it (settingsWriteGate "data"): everything in the
// workspace except personal notes, a Doc anchored NOTEPAD and every page
// under one, which node-rules R6a keeps their owner's alone, admins
// included.
//
// Pure: no database, no network.

import { CSV_BOM, csvLine, type CsvCell } from "@/lib/csv";
import type { FieldDef } from "@/lib/field-catalog";

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

// ── File names ───────────────────────────────────────────────────────

/** A file-name piece from a title: ASCII letters and digits, dashes between, at most 60 characters. */
export function asciiSlug(title: string, fallback: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || fallback;
}

/** `folder/<slug>-<id>.<ext>`: the id keeps two pages with one title apart, and the name is the same on every export. */
export function contentFileName(folder: string, title: string, id: string, ext: string, fallback: string): string {
  return `${folder}/${asciiSlug(title, fallback)}-${id}.${ext}`;
}

// ── Notes ────────────────────────────────────────────────────────────

export interface DocTreeRow {
  id: string;
  parentId: string | null;
  entityType: string | null;
  entityId: string | null;
}

/** How far up a page's parents the note rule looks: node-rules DOC_HOPS. */
const DOC_HOPS = 8;

/**
 * Is this Doc a personal note, or a page under one? The same walk as
 * node-rules notepadOwnerOf (R6a), to the same depth, so the export leaves
 * out exactly what the app keeps from an admin. `docs` holds the workspace's
 * own Docs; a parent outside it ends the walk, as it does there.
 */
export function isNoteDoc(docs: ReadonlyMap<string, DocTreeRow>, doc: DocTreeRow): boolean {
  const seen = new Set<string>();
  let cursor: DocTreeRow | undefined = doc;
  for (let hops = 0; cursor && hops <= DOC_HOPS; hops += 1) {
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    if (cursor.entityType === "NOTEPAD" && cursor.entityId) return true;
    if (!cursor.parentId) return false;
    cursor = docs.get(cursor.parentId);
  }
  return false;
}

// ── Field values ─────────────────────────────────────────────────────

/** Types that hold no value of their own: the app works them out when it shows them. */
const COMPUTED: ReadonlySet<string> = new Set(["FORMULA", "ROLLUP", "MIRROR", "PROGRESS_AUTO", "BUTTON"]);
const ONE_CHOICE: ReadonlySet<string> = new Set(["DROPDOWN", "TSHIRT_SIZE", "CUSTOM_DROPDOWN"]);
const MANY_CHOICES: ReadonlySet<string> = new Set(["MULTI_SELECT", "LABELS"]);

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function fieldName(f: FieldDef): string {
  return (typeof f.label === "string" && f.label.trim()) || f.key;
}

/**
 * A task's values for one List's fields, keyed by each field's name: a
 * choice as its label, everything else as stored (a person or a connected
 * task as its id, which people.csv and list-tasks.csv resolve). Two fields
 * sharing a name are told apart by their key. Empty fields and computed ones
 * are left out.
 */
export function fieldValues(fields: readonly FieldDef[], values: Obj): Obj {
  const uses = new Map<string, number>();
  for (const f of fields) uses.set(fieldName(f), (uses.get(fieldName(f)) ?? 0) + 1);
  const out: Obj = {};
  for (const f of [...fields].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (!f || typeof f.key !== "string" || COMPUTED.has(f.type) || f.key.startsWith("$")) continue;
    // Own keys only: metadata is a plain object, and "constructor" is not a value.
    const raw = Object.prototype.hasOwnProperty.call(values, f.key) ? values[f.key] : undefined;
    if (isEmpty(raw)) continue;
    const name = (uses.get(fieldName(f)) ?? 0) > 1 ? `${fieldName(f)} (${f.key})` : fieldName(f);
    const choices = Array.isArray(f.options?.choices) ? f.options!.choices! : [];
    const label = (v: unknown) => (typeof v === "string" ? choices.find((c) => c?.value === v)?.label ?? v : v);
    out[name] = ONE_CHOICE.has(f.type) ? label(raw) : MANY_CHOICES.has(f.type) && Array.isArray(raw) ? raw.map(label) : raw;
  }
  return out;
}

function json(values: Obj): string {
  return Object.keys(values).length ? JSON.stringify(values) : "";
}

/** A task's checklist, one item a line: "[x] done" or "[ ] to do". */
export function checklistText(metadata: unknown): string {
  const raw = obj(metadata)?.checklist;
  if (!Array.isArray(raw)) return "";
  return raw
    .map(obj)
    .filter((x): x is Obj => !!x && typeof x.text === "string")
    .map((x) => `[${x.done ? "x" : " "}] ${x.text as string}`)
    .join("\n");
}

// ── list-tasks.csv ───────────────────────────────────────────────────

/**
 * The first eleven columns are the file's columns before content was added,
 * in their order, so anything reading it by position keeps working.
 */
export const TASK_COLUMNS = [
  "id", "listId", "title", "status", "priority", "ownerId", "assigneeIds", "startAt", "dueAt", "archivedAt", "createdAt",
  "parentId", "statusLabel", "tags", "description", "checklist", "fields", "updatedAt",
] as const;

export interface TaskForExport {
  id: string;
  boardId: string;
  parentItemId: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  ownerId: string | null;
  assigneeIds: string[];
  startAt: Date | null;
  dueAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: unknown;
}

export function taskCsvHeader(): string {
  return CSV_BOM + csvLine([...TASK_COLUMNS]);
}

/** Stored text exactly as stored: an export is a copy, and a copy loses nothing. */
function asStored(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * One task's line: its description exactly as stored (Markdown, or HTML for
 * an older one), its home List's field values as one JSON object.
 */
export function taskCsvLine(t: TaskForExport, ctx: { statusLabel: string; tags: readonly string[]; fields: readonly FieldDef[] }): string {
  const meta = obj(t.metadata) ?? {};
  const cells: CsvCell[] = [
    t.id, t.boardId, t.title, t.status ?? "", t.priority ?? "", t.ownerId ?? "", t.assigneeIds.join(" "),
    iso(t.startAt), iso(t.dueAt), iso(t.archivedAt), iso(t.createdAt),
    t.parentItemId ?? "", ctx.statusLabel, ctx.tags.join("; "), asStored(meta.description), checklistText(meta),
    json(fieldValues(ctx.fields, meta)), iso(t.updatedAt),
  ];
  return csvLine(cells);
}

// ── list-tasks.jsonl ─────────────────────────────────────────────────

/**
 * One task exactly as stored, one JSON object a line: the columns, its tags,
 * the other Lists it is in, and its whole metadata (the description and
 * checklist as written, every List's field values by key). The CSV is for a
 * spreadsheet; this is the copy that loses nothing.
 */
export function taskJsonLine(
  t: TaskForExport & { position?: number; itemTypeId?: string | null },
  ctx: { statusLabel: string; tags: readonly string[]; otherLists: ReadonlyArray<{ listId: string; position: number; addedAt: string }> },
): string {
  return (
    JSON.stringify({
      id: t.id,
      listId: t.boardId,
      parentId: t.parentItemId,
      title: t.title,
      status: t.status,
      statusLabel: ctx.statusLabel || null,
      priority: t.priority,
      ownerId: t.ownerId,
      assigneeIds: t.assigneeIds,
      startAt: t.startAt ? t.startAt.toISOString() : null,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      position: t.position ?? null,
      itemTypeId: t.itemTypeId ?? null,
      tags: ctx.tags,
      otherLists: ctx.otherLists,
      metadata: t.metadata ?? {},
    }) + "\n"
  );
}

/** One comment exactly as stored, with its files by id and name. */
export function commentJsonLine(
  c: { id: string; entityId: string; authorId: string | null; body: string; createdAt: Date; updatedAt: Date },
  author: string,
  fileIds: readonly string[],
  files: readonly string[],
): string {
  return (
    JSON.stringify({
      id: c.id,
      taskId: c.entityId,
      authorId: c.authorId,
      author: author || null,
      body: c.body,
      fileIds,
      files,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }) + "\n"
  );
}

// ── list-links.csv ───────────────────────────────────────────────────

export const LINK_COLUMNS = ["taskId", "listId", "position", "fields", "addedAt"] as const;

/**
 * A task shown in a List other than its home, with that List's own field
 * values (kept at metadata.$lists[listId], src/lib/list-metadata.ts).
 */
export function linkCsvLine(
  link: { itemId: string; boardId: string; position: number; createdAt: Date },
  metadata: unknown,
  fields: readonly FieldDef[],
): string {
  const ns = obj(obj(obj(metadata)?.$lists)?.[link.boardId]) ?? {};
  return csvLine([link.itemId, link.boardId, link.position, json(fieldValues(fields, ns)), iso(link.createdAt)]);
}

// ── list-fields.csv ──────────────────────────────────────────────────

export const FIELD_COLUMNS = ["listId", "key", "name", "type", "choices", "stored"] as const;

/** Is this field's value kept on the task (yes), or worked out when it is shown (no)? */
export function fieldIsStored(f: Pick<FieldDef, "type">): boolean {
  return !COMPUTED.has(f.type);
}

export function fieldCsvLine(listId: string, f: FieldDef): string {
  const choices = Array.isArray(f.options?.choices) ? f.options!.choices!.map((c) => c?.label).filter((l): l is string => typeof l === "string") : [];
  return csvLine([listId, f.key, fieldName(f), f.type, choices.join("; "), fieldIsStored(f) ? "yes" : "no"]);
}

// ── task-comments.csv ────────────────────────────────────────────────

export const COMMENT_COLUMNS = ["id", "taskId", "authorId", "author", "body", "files", "createdAt", "updatedAt"] as const;

export function commentCsvLine(
  c: { id: string; entityId: string; authorId: string | null; body: string; createdAt: Date; updatedAt: Date },
  author: string,
  files: readonly string[],
): string {
  return csvLine([c.id, c.entityId, c.authorId ?? "", author, asStored(c.body), files.join("; "), iso(c.createdAt), iso(c.updatedAt)]);
}
