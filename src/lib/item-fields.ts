// The task field strip: which fields a task shows, and in what order.
//
// spec-task-detail.md section 2 (Body layout, item 2) settles the shape:
//
//   "Visible by default: Status, Assignees, Due date, Priority." Then the
//   "+ Add field" row opens a Picker listing every hidden field with a check:
//   Start date, Estimate, Time tracked, Tags, KRA / KPI, Watchers, then a
//   section "List fields" with every custom field of the List.
//
// Two rules make this honest rather than merely tidy, and both live here so a
// test can hold them:
//
//   A VALUE IS NEVER HIDDEN. "A field with a value is always shown whether or
//   not it is checked". A stored preference that hides a field somebody has
//   since filled in must not make that value invisible, that is how a person
//   loses a due date without anybody deleting it.
//
//   A MODULE THAT IS OFF HIDES ITS FIELD, even when it carries a value and
//   even when the stored set names it. The Space's module toggles are the
//   workspace's decision and outrank a personal preference.
//
// The order is fixed, not the order the viewer checked things in, so two
// people looking at the same task see the same screen.
//
// Pure module: its one import (field-keys.ts) is pure too, so vitest loads it
// in the node environment.

import { stripFieldIdOf } from "@/lib/field-keys";

/** Every field the strip can render, in the one order it renders them. */
export const ITEM_FIELD_ORDER = [
  "status",
  "assignees",
  "dueDate",
  "priority",
  "startDate",
  "estimate",
  "timeTracked",
  "tags",
  "alignment",
  "watchers",
] as const;

export type ItemFieldKey = (typeof ITEM_FIELD_ORDER)[number];

/** The four the spec shows on a task nobody has configured. */
export const DEFAULT_ITEM_FIELDS: readonly ItemFieldKey[] = ["status", "assignees", "dueDate", "priority"];

/** The four defaults are never offered in "+ Add field": they cannot be hidden. */
export const PINNED_ITEM_FIELDS: readonly ItemFieldKey[] = DEFAULT_ITEM_FIELDS;

/** Human labels, in one place, so the strip and the picker cannot disagree. */
export const ITEM_FIELD_LABELS: Record<ItemFieldKey, string> = {
  status: "Status",
  assignees: "Assignees",
  dueDate: "Due date",
  priority: "Priority",
  startDate: "Start date",
  estimate: "Estimate",
  timeTracked: "Time tracked",
  tags: "Tags",
  alignment: "KRA / KPI",
  watchers: "Watchers",
};

export function isItemFieldKey(value: unknown): value is ItemFieldKey {
  return typeof value === "string" && (ITEM_FIELD_ORDER as readonly string[]).includes(value);
}

/**
 * Which Space module, if any, owns a field. A module that is off removes the
 * field from the strip and from the picker entirely.
 */
export type ItemFieldModule = "priority" | "tags" | "timeTracking" | "customFields";

const FIELD_MODULE: Partial<Record<ItemFieldKey, ItemFieldModule>> = {
  priority: "priority",
  tags: "tags",
  timeTracked: "timeTracking",
};

export interface ItemFieldGating {
  priority: boolean;
  tags: boolean;
  timeTracking: boolean;
  customFields: boolean;
}

const ALL_ON: ItemFieldGating = { priority: true, tags: true, timeTracking: true, customFields: true };

/** Is this field available at all on this Space? */
export function fieldAllowed(key: ItemFieldKey, gating: ItemFieldGating | null | undefined): boolean {
  const mod = FIELD_MODULE[key];
  if (!mod) return true;
  return (gating ?? ALL_ON)[mod];
}

export interface ResolveFieldsArgs {
  /** `home.work.itemFields[listId]`, or null when nothing is stored yet. */
  stored?: readonly string[] | null;
  /** Does this field carry a value on this task right now? */
  hasValue: (key: ItemFieldKey) => boolean;
  /** The Space's module toggles; absent means every module is on. */
  gating?: ItemFieldGating | null;
  /** A Guest never sees KRA / KPI (access section 3.3). */
  hideAlignment?: boolean;
}

/**
 * The ordered list of fields the strip renders.
 *
 * `stored` is a preference, not an instruction: a field with a value is added
 * back, and a field whose module is off is dropped however it got in.
 */
export function resolveVisibleFields(args: ResolveFieldsArgs): ItemFieldKey[] {
  const stored = new Set((args.stored ?? DEFAULT_ITEM_FIELDS).filter(isItemFieldKey));
  // The four defaults are structural: a stored set that predates a field, or
  // one written by a broken client, still shows them.
  for (const key of PINNED_ITEM_FIELDS) stored.add(key);

  return ITEM_FIELD_ORDER.filter((key) => {
    if (!fieldAllowed(key, args.gating)) return false;
    if (key === "alignment" && args.hideAlignment) return false;
    if (stored.has(key)) return true;
    // The value-is-never-hidden rule.
    return args.hasValue(key);
  });
}

export interface AddFieldRow {
  key: ItemFieldKey;
  label: string;
  checked: boolean;
  /** True when the row is checked only because the field carries a value. */
  lockedByValue: boolean;
}

/**
 * The rows of the "+ Add field" picker: every field that is not one of the
 * four pinned defaults, with its check state.
 *
 * A field that is shown only because it has a value is still rendered checked
 *, unchecking it would be a lie, because the strip will keep showing it.
 */
export function addFieldRows(args: ResolveFieldsArgs): AddFieldRow[] {
  const stored = new Set((args.stored ?? DEFAULT_ITEM_FIELDS).filter(isItemFieldKey));
  const rows: AddFieldRow[] = [];
  for (const key of ITEM_FIELD_ORDER) {
    if (PINNED_ITEM_FIELDS.includes(key)) continue;
    if (!fieldAllowed(key, args.gating)) continue;
    if (key === "alignment" && args.hideAlignment) continue;
    const checked = stored.has(key);
    rows.push({
      key,
      label: ITEM_FIELD_LABELS[key],
      checked: checked || args.hasValue(key),
      lockedByValue: !checked && args.hasValue(key),
    });
  }
  return rows;
}

/**
 * Toggle one field in a stored set, returning the set to persist.
 *
 * Pinned fields are never written (they cannot be turned off), and the result
 * is always in `ITEM_FIELD_ORDER` order so two writes of the same selection
 * produce the same array and the preference PATCH is idempotent.
 */
export function toggleStoredField(stored: readonly string[] | null | undefined, key: ItemFieldKey): ItemFieldKey[] {
  const set = new Set((stored ?? DEFAULT_ITEM_FIELDS).filter(isItemFieldKey));
  for (const pinned of PINNED_ITEM_FIELDS) set.add(pinned);
  if (PINNED_ITEM_FIELDS.includes(key)) return ITEM_FIELD_ORDER.filter((k) => set.has(k));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return ITEM_FIELD_ORDER.filter((k) => set.has(k));
}

/** One of the List's own custom fields, as the "+ Add field" picker shows it. */
export interface ListFieldRow {
  key: string;
  label: string;
  checked: boolean;
  lockedByValue: boolean;
}

/**
 * The "List fields" section of the "+ Add field" picker: every custom field
 * the List defines, with its check state.
 *
 * Without this section a List's custom fields had exactly one door, the
 * reveal row that appeared only while at least one of them carried a value,
 * so a List whose custom fields were all empty had no way to show them at
 * all. The visibility set is the same `home.work.itemFields[listId]` the
 * built-ins use: a custom field's key is stored beside them. A field whose key
 * a built-in also uses (an older List's "tags" field) is stored as
 * "field:tags" (field-keys.ts stripFieldIdOf), so checking the built-in Tags
 * never shows that field and checking the field never shows Tags.
 */
export function listFieldRows(args: {
  fields: readonly { key: string; label: string }[];
  stored?: readonly string[] | null;
  hasValue: (key: string) => boolean;
  gating?: ItemFieldGating | null;
}): ListFieldRow[] {
  if (!(args.gating ?? ALL_ON).customFields) return [];
  const stored = new Set(args.stored ?? []);
  return args.fields.map((f) => {
    const checked = stored.has(stripFieldIdOf(f.key));
    return {
      key: f.key,
      label: f.label,
      checked: checked || args.hasValue(f.key),
      lockedByValue: !checked && args.hasValue(f.key),
    };
  });
}

/**
 * Which of the List's custom fields the strip renders.
 *
 * The same two rules as the built-ins: a value is never hidden, and a module
 * that is off drops the whole set.
 */
export function resolveVisibleListFields(args: {
  fields: readonly { key: string; label: string }[];
  stored?: readonly string[] | null;
  hasValue: (key: string) => boolean;
  gating?: ItemFieldGating | null;
}): string[] {
  return listFieldRows(args).filter((r) => r.checked).map((r) => r.key);
}

/** Toggle one custom field (by its stored key) in a stored set, returning the set to persist. */
export function toggleStoredListField(stored: readonly string[] | null | undefined, key: string): string[] {
  const set = new Set(stored ?? []);
  const id = stripFieldIdOf(key);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}
