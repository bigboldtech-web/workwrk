// A List field's key, and the built-in ids it must never be mistaken for.
//
// A custom field's key is a slug of its label ([a-z0-9_]). Every List surface
// puts custom fields in the SAME id space as its own built-ins: the table's
// columns, sort, group, widths and pins ("owner" is the Assignee column), the
// filter and colour rules ("assignee", "title"), the chart and pivot axes, the
// task page's field strip ("tags", "watchers"), and the task's own metadata
// ("description" is the task body, "checklist" its checklist). A field
// labelled "Owner" used to get the key "owner", and the table then drew the
// Assignee cell under the Owner header: an edit meant for the field changed
// who the task was assigned to, and the field's own values were never shown.
//
// Two rules, both here so one test file holds them:
//
//   A NEW KEY IS NEVER RESERVED. freeFieldKey skips every built-in id of every
//   surface and every key the task itself keeps in metadata, exactly the way
//   it skips a key the List already has ("Owner" becomes owner_2).
//
//   AN OLD KEY IS READ BY SOURCE. A List made before this rule may already
//   have a field keyed "owner". Its stored key is never renamed: its values
//   live under that key on every task, and in view settings, templates and
//   form mappings. Instead each surface gives such a field an id that cannot
//   be one of its built-ins ("field:owner"; a slug never holds ":") and turns
//   that id back into the stored key for every read and write. A field whose
//   key clashes with nothing on a surface keeps its bare key there, so every
//   width, pin, sort, group and rule already saved against it still applies.
//
// Pure: its one import is pure too, so vitest loads it in the node environment.

import { CONNECT_KEYS_META, LISTS_NS, TASK_LEVEL_METADATA_KEYS } from "@/lib/list-metadata";

// ── The built-in ids, surface by surface ─────────────────────────────

/**
 * The List table's built-in columns (board-table-view.tsx): the column ids
 * its sort, group, widths and pins are keyed by. Name and Status plus every
 * `__builtin_*` column of field-catalog.ts BUILTIN_COLUMNS, without the prefix.
 */
export const TABLE_COLUMN_IDS = [
  "name", "status", "owner", "due", "priority", "type", "tags", "created",
  "start", "updated", "taskid", "comments", "timeline", "time", "createdby",
  "docs", "linked", "sops",
] as const;

/**
 * The built-in fields a filter rule may name: the filter bar, a List's
 * Conditional colors (both through work/filter-rules.ts) and a dashboard
 * card's filter (dashboards/widgets.ts BUILTIN_FILTER_FIELDS).
 */
export const RULE_FIELD_IDS = ["status", "assignee", "priority", "due", "tags", "title", "type"] as const;

/** The built-in axes of the Chart and Pivot views. */
export const AXIS_IDS = ["status", "owner", "priority"] as const;

/**
 * The task page's built-in field strip (item-fields.ts ITEM_FIELD_ORDER). A
 * List's custom fields are stored in the same preference set beside them.
 */
export const TASK_STRIP_IDS = [
  "status", "assignees", "dueDate", "priority", "startDate", "estimate",
  "timeTracked", "tags", "alignment", "watchers",
] as const;

/**
 * Keys the TASK keeps in Item.metadata, which a List field would share a slot
 * with: the body and its markers (list-metadata.ts TASK_LEVEL_METADATA_KEYS),
 * the recurring series (recurring-tasks.ts), the personal-task migration's
 * bag (work/personal-task.ts), and the two "$" storage keys.
 */
export const TASK_METADATA_KEYS: readonly string[] = [
  ...TASK_LEVEL_METADATA_KEYS,
  "recurrence", "recurrenceKey", "recurrenceSourceId", "lastSpawnedKey", "skippedOccurrences",
  "legacyTask", "legacyTaskId",
  LISTS_NS, CONNECT_KEYS_META,
];

/**
 * Every exact key a new field may not take. "constructor" is here because
 * metadata is a plain object: `metadata["constructor"]` on a task that never
 * set the field answers Object's own constructor, not undefined.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set<string>([
  ...TABLE_COLUMN_IDS,
  ...RULE_FIELD_IDS,
  ...AXIS_IDS,
  ...TASK_STRIP_IDS,
  ...TASK_METADATA_KEYS,
  "constructor",
]);

/**
 * True for a key no new field may take: an exact reserved key, anything the
 * app keeps under a "$" or "_" prefix (the storage keys, `__builtin_*`,
 * `__none__`), and anything holding ":" (the field id prefix below).
 */
export function isReservedFieldKey(key: string): boolean {
  return RESERVED_FIELD_KEYS.has(key) || key.startsWith("$") || key.startsWith("_") || key.includes(":");
}

// ── The key rule ──────────────────────────────────────────────────────

/** The slug a label makes, before any clash is resolved. */
export function slugifyFieldLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field"
  );
}

/**
 * The key a new field labelled `label` gets on a List whose fields already
 * hold `existing`: the label's slug, or the first of slug_2, slug_3 ... that
 * is neither taken nor reserved. A reserved slug is resolved exactly like a
 * duplicate label, so "Owner" on an empty List is owner_2, the key a second
 * "Owner" would have had.
 */
export function freeFieldKey(label: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const free = (k: string) => !taken.has(k) && !isReservedFieldKey(k);
  const base = slugifyFieldLabel(label);
  if (free(base)) return base;
  for (let i = 2; i < 200; i++) {
    const candidate = `${base}_${i}`;
    if (free(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

// ── Reading an old key safely ────────────────────────────────────────

/** Marks an id as a custom field's. Never in a slug, so never a built-in. */
export const FIELD_ID_PREFIX = "field:";

const TABLE_SPACE: ReadonlySet<string> = new Set(TABLE_COLUMN_IDS);
const RULE_SPACE: ReadonlySet<string> = new Set(RULE_FIELD_IDS);
const AXIS_SPACE: ReadonlySet<string> = new Set(AXIS_IDS);
const STRIP_SPACE: ReadonlySet<string> = new Set(TASK_STRIP_IDS);

// A key that already starts with the prefix is prefixed again, so decoding
// always gives back exactly the stored key and no two fields share an id.
function idIn(space: ReadonlySet<string>, key: string): string {
  return space.has(key) || key.startsWith(FIELD_ID_PREFIX) ? `${FIELD_ID_PREFIX}${key}` : key;
}

/** A custom field's column id in the List table: its sort, group, width and pin. */
export function tableColumnIdOf(key: string): string {
  return idIn(TABLE_SPACE, key);
}

/** A custom field's id in a filter or colour rule, and in a dashboard card's filter. */
export function ruleFieldIdOf(key: string): string {
  return idIn(RULE_SPACE, key);
}

/** A custom field's axis id in the Chart and Pivot views. */
export function axisIdOf(key: string): string {
  return idIn(AXIS_SPACE, key);
}

/** A custom field's id in the task page's stored field strip. */
export function stripFieldIdOf(key: string): string {
  return idIn(STRIP_SPACE, key);
}

/**
 * The stored field key an id names. A surface calls it only once its own
 * built-ins are handled, so a bare id is a field key already.
 */
export function fieldKeyOfId(id: string): string {
  return id.startsWith(FIELD_ID_PREFIX) ? id.slice(FIELD_ID_PREFIX.length) : id;
}
