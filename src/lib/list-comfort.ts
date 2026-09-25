// List comfort (gap 14), as config: List-wide rules in Board.settings and
// per-view display in View.config. No schema.
//
//   Board.settings.defaults       values a NEW task gets at creation, only for
//                                 the keys the creator did not send, never
//                                 applied retroactively to existing tasks.
//   Board.settings.rowColorRules  conditional row colouring: field, operator,
//                                 value, and a colour from the product palette.
//   View.config.pinnedColumns     frozen columns, per view.
//   View.config.rowHeight         row height, per view.
//
// The task type default is NOT here: it already lives at
// settings.defaultItemTypeId, written by the "Default task type" submenu, and
// one value has one home. ListDefaults reads it back as `itemTypeId`.
//
// Pure: zod and two pure modules.

import { z } from "zod";
import { PRIORITY_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

/** The product palette a row colour may use, by name, so a theme can map it. */
export const ROW_COLORS = ["red", "orange", "yellow", "green", "blue", "grey"] as const;
export type RowColor = (typeof ROW_COLORS)[number];

/**
 * The eight filter operators, the SAME vocabulary the board filter bar speaks
 * (board-filter-bar.tsx ALL_OPERATORS; list-comfort.test.ts reads that file
 * and fails if the two ever drift), so a colour rule and a filter rule mean
 * the same thing.
 */
export const FILTER_OPERATORS = ["is", "isNot", "isSet", "isNotSet", "before", "after", "on", "contains"] as const;
export type FilterOperatorName = (typeof FILTER_OPERATORS)[number];

export const ROW_HEIGHTS = ["compact", "default", "tall"] as const;
export type RowHeight = (typeof ROW_HEIGHTS)[number];

export const MAX_ROW_COLOR_RULES = 20;
export const MAX_PINNED_COLUMNS = 10;

const PRIORITY_VALUES = PRIORITY_OPTIONS.map((p) => p.value) as [string, ...string[]];

export const listDefaultsSchema = z
  .object({
    status: z.string().min(1).max(40).optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    assigneeIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    tagIds: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    fields: z.record(z.string().min(1).max(64), z.unknown()).optional(),
  })
  .strict();

export type ListDefaultsInput = z.infer<typeof listDefaultsSchema>;

export interface ListDefaults extends ListDefaultsInput {
  /** Read from settings.defaultItemTypeId, the value's one home. */
  itemTypeId?: string | null;
}

export const rowColorRuleSchema = z
  .object({
    id: z.string().min(1).max(64),
    field: z.string().min(1).max(64),
    operator: z.enum(FILTER_OPERATORS),
    value: z.string().max(200),
    color: z.enum(ROW_COLORS),
  })
  .strict();

export type RowColorRule = z.infer<typeof rowColorRuleSchema>;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ── JSON merge ───────────────────────────────────────────────────────

/**
 * A shallow merge of `patch` over what is STORED: a key set to null is
 * deleted, every other stored key is kept. Every settings and config writer
 * goes through this on the row it locked, so two writers saving different
 * keys can never erase each other's.
 */
export function mergeJsonObject(stored: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...asObject(stored) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

// ── Defaults ─────────────────────────────────────────────────────────

const TEXTUAL = new Set(["TEXT", "LONG_TEXT", "URL", "EMAIL", "PHONE", "CUSTOM_TEXT", "LOCATION"]);
const NUMERIC = new Set(["NUMBER", "MONEY", "PERCENT", "RATING", "PROGRESS_MANUAL"]);
const SINGLE_CHOICE = new Set(["DROPDOWN", "CUSTOM_DROPDOWN", "TSHIRT_SIZE"]);
const MULTI_CHOICE = new Set(["MULTI_SELECT", "LABELS"]);

function choiceValues(field: FieldDef): Set<string> {
  return new Set((field.options?.choices ?? []).map((c) => c.value));
}

/**
 * Is this a value a field of this type can default to? Types whose value
 * points at another object (files, links, connections) or is computed
 * cannot: a default must be a plain value that is still true when the task
 * is created.
 */
export function isValidDefaultFieldValue(field: FieldDef, value: unknown): boolean {
  const t = field.type as string;
  if (TEXTUAL.has(t)) return typeof value === "string" && value.length <= 5000;
  if (NUMERIC.has(t)) return typeof value === "number" && Number.isFinite(value);
  if (t === "CHECKBOX") return typeof value === "boolean";
  if (SINGLE_CHOICE.has(t)) return typeof value === "string" && choiceValues(field).has(value);
  if (MULTI_CHOICE.has(t)) {
    const allowed = choiceValues(field);
    return Array.isArray(value) && value.length <= 50 && value.every((v) => typeof v === "string" && allowed.has(v));
  }
  if (t === "DATE" || t === "DATETIME") return typeof value === "string" && !Number.isNaN(Date.parse(value));
  if (t === "USER") return typeof value === "string" && value.trim().length > 0 && value.length <= 64;
  if (t === "PEOPLE") return Array.isArray(value) && value.length <= 50 && value.every((v) => typeof v === "string" && v.trim().length > 0 && v.length <= 64);
  return false;
}

/** The user ids a set of defaults names, for the server's existence check. */
export function userIdsInDefaults(defaults: ListDefaultsInput, fields: readonly FieldDef[]): string[] {
  const ids = new Set<string>(defaults.assigneeIds ?? []);
  const byKey = new Map(fields.map((f) => [f.key, f] as const));
  for (const [key, value] of Object.entries(defaults.fields ?? {})) {
    const f = byKey.get(key);
    if (!f) continue;
    if (f.type === "USER" && typeof value === "string") ids.add(value);
    if (f.type === "PEOPLE" && Array.isArray(value)) for (const v of value) if (typeof v === "string") ids.add(v);
  }
  return [...ids];
}

/**
 * The problems with a set of defaults for THIS List, as short machine
 * strings. The server adds the existence checks (people, tags) it alone can
 * make. An empty result means the defaults may be stored.
 */
export function validateListDefaults(
  defaults: ListDefaultsInput,
  ctx: { statuses: readonly StatusOption[]; fields: readonly FieldDef[] },
): string[] {
  const issues: string[] = [];
  if (defaults.status !== undefined && !ctx.statuses.some((s) => s.value === defaults.status)) issues.push("status_not_in_list");
  if (defaults.assigneeIds && new Set(defaults.assigneeIds).size !== defaults.assigneeIds.length) issues.push("duplicate_assignee");
  if (defaults.tagIds && new Set(defaults.tagIds).size !== defaults.tagIds.length) issues.push("duplicate_tag");
  const byKey = new Map(ctx.fields.map((f) => [f.key, f] as const));
  for (const [key, value] of Object.entries(defaults.fields ?? {})) {
    const f = byKey.get(key);
    if (!f) {
      issues.push(`unknown_field:${key}`);
      continue;
    }
    if (!isValidDefaultFieldValue(f, value)) issues.push(`invalid_value:${key}`);
  }
  return issues;
}

/** The defaults stored on a List, read defensively, with the task type from its one home. */
export function readListDefaults(settings: unknown): ListDefaults {
  const s = asObject(settings);
  const parsed = listDefaultsSchema.safeParse(asObject(s.defaults));
  const base: ListDefaults = parsed.success ? parsed.data : {};
  const typeId = typeof s.defaultItemTypeId === "string" && s.defaultItemTypeId ? s.defaultItemTypeId : null;
  return { ...base, itemTypeId: typeId };
}

export interface DefaultsApplication {
  status?: string;
  priority?: string;
  assigneeIds?: string[];
  tagIds?: string[];
  itemTypeId?: string;
  /** Field values to add to metadata, for keys the creator did not send. */
  fields?: Record<string, unknown>;
}

/**
 * What a create gets from its List's defaults.
 *
 * ONLY for keys ABSENT from the raw request body: a key the client sent,
 * including an explicit null, is the client's answer and is never replaced.
 * Assignees count as sent when either assigneeIds or ownerId was. Every
 * default is re-checked at the moment it is applied and SKIPPED, never an
 * error, when it has stopped being true: a person deactivated or gone, a tag
 * archived, a status the List no longer declares, a field that no longer
 * exists with a type that takes the value.
 */
export function planCreateDefaults(
  defaults: ListDefaults,
  ctx: {
    sentKeys: ReadonlySet<string>;
    sentMetadataKeys: ReadonlySet<string>;
    statuses: readonly StatusOption[];
    fields: readonly FieldDef[];
    liveUserIds: ReadonlySet<string>;
    liveTagIds: ReadonlySet<string>;
    liveItemTypeIds: ReadonlySet<string>;
  },
): DefaultsApplication {
  const out: DefaultsApplication = {};
  if (!ctx.sentKeys.has("status") && defaults.status && ctx.statuses.some((s) => s.value === defaults.status)) {
    out.status = defaults.status;
  }
  if (!ctx.sentKeys.has("priority") && defaults.priority && PRIORITY_VALUES.includes(defaults.priority)) {
    out.priority = defaults.priority;
  }
  if (!ctx.sentKeys.has("assigneeIds") && !ctx.sentKeys.has("ownerId") && defaults.assigneeIds?.length) {
    const live = defaults.assigneeIds.filter((id) => ctx.liveUserIds.has(id));
    if (live.length) out.assigneeIds = live;
  }
  if (!ctx.sentKeys.has("tagIds") && defaults.tagIds?.length) {
    const live = defaults.tagIds.filter((id) => ctx.liveTagIds.has(id));
    if (live.length) out.tagIds = live;
  }
  if (!ctx.sentKeys.has("itemTypeId") && defaults.itemTypeId && ctx.liveItemTypeIds.has(defaults.itemTypeId)) {
    out.itemTypeId = defaults.itemTypeId;
  }
  const byKey = new Map(ctx.fields.map((f) => [f.key, f] as const));
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults.fields ?? {})) {
    if (ctx.sentMetadataKeys.has(key)) continue;
    const f = byKey.get(key);
    if (!f || !isValidDefaultFieldValue(f, value)) continue;
    if (f.type === "USER" && !(typeof value === "string" && ctx.liveUserIds.has(value))) continue;
    if (f.type === "PEOPLE") {
      const live = (value as string[]).filter((id) => ctx.liveUserIds.has(id));
      if (!live.length) continue;
      fields[key] = live;
      continue;
    }
    fields[key] = value;
  }
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}

// ── Row colour rules ─────────────────────────────────────────────────

/** The stored rules, read defensively: a malformed entry is dropped, the rest kept. */
export function parseRowColorRules(raw: unknown): RowColorRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RowColorRule[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const r = rowColorRuleSchema.safeParse(entry);
    if (!r.success || seen.has(r.data.id)) continue;
    seen.add(r.data.id);
    out.push(r.data);
    if (out.length >= MAX_ROW_COLOR_RULES) break;
  }
  return out;
}

// ── View comfort ─────────────────────────────────────────────────────

export interface ViewComfort {
  pinnedColumns?: string[];
  rowHeight?: RowHeight;
}

/**
 * The two per-view comfort keys in a View config (or a config patch),
 * normalised. A key that is present and wrong is refused by name; a null
 * clears it; an absent key says nothing.
 */
export function parseViewComfort(
  config: Record<string, unknown>,
): { ok: true; value: { pinnedColumns?: string[] | null; rowHeight?: RowHeight | null } } | { ok: false; key: "pinnedColumns" | "rowHeight" } {
  const value: { pinnedColumns?: string[] | null; rowHeight?: RowHeight | null } = {};
  if ("pinnedColumns" in config) {
    const p = config.pinnedColumns;
    if (p === null) value.pinnedColumns = null;
    else if (
      Array.isArray(p) &&
      p.length <= MAX_PINNED_COLUMNS &&
      p.every((k) => typeof k === "string" && k.length > 0 && k.length <= 64) &&
      new Set(p).size === p.length
    ) {
      value.pinnedColumns = [...(p as string[])];
    } else return { ok: false, key: "pinnedColumns" };
  }
  if ("rowHeight" in config) {
    const h = config.rowHeight;
    if (h === null) value.rowHeight = null;
    else if (typeof h === "string" && (ROW_HEIGHTS as readonly string[]).includes(h)) value.rowHeight = h as RowHeight;
    else return { ok: false, key: "rowHeight" };
  }
  return { ok: true, value };
}
