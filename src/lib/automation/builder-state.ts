// The automation builder's editable state, as a pure module
// (spec-ai-automation /automation/workflows/[id]). The page reads a
// workflow into a Draft, edits it, and writes it back with toSaveBody; the
// dirty flag is "the draft's snapshot differs from the one it loaded", so
// undoing an edit by hand clears it. Nothing here does I/O.
//
// Conditions: the builder edits ONE flat AND / OR group. A nested group
// authored through the API is kept verbatim as an opaque row and written
// back exactly as it came, never dropped.

import { CONDITION_OPERATORS } from "./conditions";
import { stableJson } from "./definition";
import { AUTOMATION_TEAMMATE_COPY } from "@/lib/agents/teammate-copy";

export interface CondRow {
  id: string;
  /** A nested group authored through the API, kept verbatim. */
  opaque?: unknown;
  field: string;
  operator: string;
  value: string;
}

export interface ActionRow {
  id: string;
  key: string | null;
  params: Record<string, string>;
}

export interface DraftScope {
  listIds: string[];
  folderIds: string[];
  spaceIds: string[];
}

export interface Draft {
  name: string;
  description: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  trigger: string | null;
  when: Record<string, unknown>;
  logic: "AND" | "OR";
  conditions: CondRow[];
  actions: ActionRow[];
  /** The places the editor can open (the server keeps the rest). */
  scope: DraftScope;
  /**
   * The editor's choice, stated on every save: Everywhere, or only the chosen
   * places (with the ones they cannot open kept on the server). It is not
   * read off an empty scope: a scope whose places are all hidden from this
   * editor arrives empty and is still "only in chosen places".
   */
  everywhere: boolean;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

let seq = 0;
export function rowId(): string {
  seq += 1;
  return `r${seq}`;
}

export function readDraft(wf: { name: string; description: string | null; severity: string; triggerEvent: string | null; definition: unknown; scopeHidden?: boolean }): Draft {
  const def = asRecord(wf.definition);
  const cond = asRecord(def.conditions);
  const conditions: CondRow[] = [];
  if (Array.isArray(cond.rules)) {
    for (const node of cond.rules) {
      const n = asRecord(node);
      if (typeof n.field === "string" && typeof n.operator === "string" && !Array.isArray(n.rules)) {
        conditions.push({ id: rowId(), field: n.field, operator: n.operator, value: n.value === undefined || n.value === null ? "" : String(n.value) });
      } else if (node && typeof node === "object") {
        conditions.push({ id: rowId(), opaque: node, field: "", operator: "", value: "" });
      }
    }
  }
  const actions: ActionRow[] = [];
  if (Array.isArray(def.actions)) {
    for (const raw of def.actions) {
      const a = asRecord(raw);
      const key = typeof a.key === "string" ? a.key : typeof a.action === "string" ? a.action : typeof a.type === "string" ? a.type : null;
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(asRecord(a.params ?? a.config))) {
        if (v === null || v === undefined) continue;
        params[k] = typeof v === "string" ? v : String(v);
      }
      actions.push({ id: rowId(), key, params });
    }
  }
  const scope = asRecord(def.scope);
  const sev = wf.severity === "CRITICAL" || wf.severity === "MAJOR" ? wf.severity : "MINOR";
  return {
    name: wf.name,
    description: wf.description ?? "",
    severity: sev,
    trigger: wf.triggerEvent,
    when: asRecord(def.when),
    logic: cond.logic === "OR" ? "OR" : "AND",
    conditions,
    actions,
    scope: { listIds: ids(scope.listIds), folderIds: ids(scope.folderIds), spaceIds: ids(scope.spaceIds) },
    everywhere: ids(scope.listIds).length + ids(scope.folderIds).length + ids(scope.spaceIds).length === 0 && !wf.scopeHidden,
  };
}

const NEEDS_VALUE = new Set(CONDITION_OPERATORS.filter((o) => o.needsValue).map((o) => String(o.key)));

/** The `when` keys each trigger keeps; anything else is dropped on save. */
export function whenFor(trigger: string | null, when: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (trigger === "task.field_changed") {
    if (typeof when.field === "string" && when.field) out.field = when.field;
  } else if (trigger === "task.date_arrives") {
    out.dateField = when.dateField === "startAt" ? "startAt" : "dueAt";
    const n = Number(when.offsetDays);
    out.offsetDays = Number.isInteger(n) ? Math.max(-30, Math.min(30, n)) : 0;
  } else if (trigger === "schedule.every") {
    const every = when.every === "weekday" || when.every === "week" || when.every === "month" ? when.every : "day";
    out.every = every;
    out.at = typeof when.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(when.at) ? when.at : "09:00";
    if (every === "week") out.weekday = Number.isInteger(Number(when.weekday)) ? Math.max(0, Math.min(6, Number(when.weekday))) : 1;
    if (every === "month") out.monthDay = Number.isInteger(Number(when.monthDay)) ? Math.max(1, Math.min(28, Number(when.monthDay))) : 1;
  }
  return out;
}

/** The PUT body the draft saves as. `numericParams` names each action's number params. */
export function toSaveBody(d: Draft, numericParams: (actionKey: string) => Set<string> = () => new Set()): Record<string, unknown> {
  const rules = d.conditions
    .map((row) => {
      if (row.opaque !== undefined) return row.opaque;
      if (!row.field || !row.operator) return null;
      const rule: Record<string, unknown> = { field: row.field, operator: row.operator };
      if (NEEDS_VALUE.has(row.operator)) rule.value = row.value;
      return rule;
    })
    .filter((r) => r !== null);
  const actions = d.actions
    .filter((a) => a.key)
    .map((a) => {
      const nums = numericParams(a.key as string);
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.params)) {
        if (v === "") continue;
        if (nums.has(k)) {
          const n = Number(v);
          if (Number.isFinite(n)) params[k] = n;
        } else params[k] = v;
      }
      return { key: a.key, params };
    });
  const scope = d.scope.listIds.length + d.scope.folderIds.length + d.scope.spaceIds.length > 0 ? d.scope : undefined;
  const when = whenFor(d.trigger, d.when);
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    severity: d.severity,
    triggerEvent: d.trigger,
    definition: {
      conditions: rules.length > 0 ? { logic: d.logic, rules } : null,
      actions,
      trigger: d.trigger,
      ...(Object.keys(when).length ? { when } : {}),
      ...(scope ? { scope } : {}),
      everywhere: d.everywhere,
    },
  };
}

/** One string per meaningful state: two drafts that save the same compare equal. */
export function draftSnapshot(d: Draft): string {
  return stableJson(toSaveBody(d));
}

export type ValueKind = "none" | "user" | "date" | "number" | "status" | "priority" | "list" | "boolean" | "text";

/** Which value control a condition row gets: typed to its field and operator. */
export function valueKindFor(fieldType: string | undefined, operator: string): ValueKind {
  if (!NEEDS_VALUE.has(operator)) return "none";
  if (operator === "within_next_days" || operator === "older_than" || operator === "gt" || operator === "lt" || operator === "gte" || operator === "lte") {
    return fieldType === "date" && (operator === "within_next_days" || operator === "older_than") ? "number" : fieldType === "date" ? "date" : "number";
  }
  if (operator === "before" || operator === "after") return "date";
  if (operator === "contains") return "text";
  switch (fieldType) {
    case "user": return "user";
    case "date": return "date";
    case "number": return "number";
    case "status": return "status";
    case "priority": return "priority";
    case "list": return "list";
    case "boolean": return "boolean";
    default: return "text";
  }
}

/** The operators that make sense for a field type (the rest are hidden, never an error). */
export function operatorsFor(fieldType: string | undefined): string[] {
  const all = CONDITION_OPERATORS.map((o) => String(o.key));
  switch (fieldType) {
    case "date": return ["before", "after", "within_next_days", "older_than", "is_empty", "is_not_empty"];
    case "number": return ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"];
    case "user":
    case "status":
    case "priority":
    case "list":
    case "boolean": return ["eq", "neq", "is_empty", "is_not_empty"];
    case "string": return ["eq", "neq", "contains", "is_empty", "is_not_empty"];
    default: return all;
  }
}

export interface PublishProblems {
  when?: string;
  then?: string;
  /** A save the server refused for where it runs (too many places, a place the editor cannot open). */
  where?: string;
  /** Keyed by CondRow id: a condition whose operator needs a value and has none. */
  conditions: Record<string, string>;
  actions: Record<string, string>;
}

export const EMPTY_CONDITION_MESSAGE = "Pick a value, or remove this condition.";

/**
 * The index of the first flat rule in a saved `definition.conditions` whose
 * operator needs a value and carries none (undefined, null or blank), or
 * null when every rule is complete. Nested groups are API-authored and the
 * builder shows them verbatim, so they are not judged here. The publish
 * route uses this so the API path refuses what the builder refuses.
 */
export function firstConditionMissingValue(conditions: unknown): number | null {
  const group = asRecord(conditions);
  if (!Array.isArray(group.rules)) return null;
  for (const [index, node] of group.rules.entries()) {
    const rule = asRecord(node);
    if (Array.isArray(rule.rules)) continue;
    if (typeof rule.operator !== "string" || !NEEDS_VALUE.has(rule.operator)) continue;
    const v = rule.value;
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return index;
  }
  return null;
}

/** {{teammate.answer}} or {{teammate.name}} in a step's words. */
export const TEAMMATE_TOKEN = /\{\{\s*teammate\.(?:answer|name)\s*\}\}/;

/** A step that uses a teammate's answer with nothing before it to ask one (review round 4). */
export const ANSWER_WITHOUT_TEAMMATE = 'This step uses the AI teammate\'s answer, so put an "Ask an AI teammate" step before it.';

/**
 * The index of the first step that uses a teammate's answer with no "Ask an
 * AI teammate" step before it, so it could never have an answer to use, or
 * null. The builder and the publish route both refuse it.
 */
export function firstAnswerWithoutTeammate(actions: ReadonlyArray<{ key: unknown; params?: unknown }>): number | null {
  for (const [index, a] of actions.entries()) {
    if (a.key === "ask_teammate") return null;
    if (Object.values(asRecord(a.params)).some((v) => typeof v === "string" && TEAMMATE_TOKEN.test(v))) return index;
  }
  return null;
}

/** What stops a publish, said under the section it belongs to (never a toast alone). */
export function publishProblems(
  d: Draft,
  catalog: { triggers: Array<{ key: string }>; actions: Array<{ key: string; name: string; available: boolean; unavailableReason?: "ai_off" | null; params: Array<{ key: string; label: string; required: boolean }> }> },
): PublishProblems {
  const out: PublishProblems = { conditions: {}, actions: {} };
  if (!d.trigger) out.when = "Choose what starts this automation.";
  else if (catalog.triggers.length && !catalog.triggers.some((t) => t.key === d.trigger)) out.when = "That trigger no longer exists. Choose another.";
  const real = d.actions.filter((a) => a.key);
  if (real.length === 0) out.then = "Add at least one action.";
  for (const a of d.actions) {
    if (!a.key) {
      out.actions[a.id] = "Choose what this step does, or remove it.";
      continue;
    }
    const impl = catalog.actions.find((x) => x.key === a.key);
    if (!impl) {
      if (catalog.actions.length) out.actions[a.id] = "This action no longer exists. Remove it.";
      continue;
    }
    if (!impl.available) {
      out.actions[a.id] = impl.unavailableReason === "ai_off" ? AUTOMATION_TEAMMATE_COPY.aiOff : `"${impl.name}" is not available yet. Remove it or choose another action.`;
      continue;
    }
    const missing = impl.params.filter((p) => p.required && !(a.params[p.key] ?? "").trim());
    if (missing.length) out.actions[a.id] = `Fill in ${missing.map((p) => p.label.toLowerCase()).join(" and ")}.`;
  }
  const early = firstAnswerWithoutTeammate(d.actions);
  if (early !== null && !out.actions[d.actions[early].id]) out.actions[d.actions[early].id] = ANSWER_WITHOUT_TEAMMATE;
  // A condition with an operator that needs a value and no value would go
  // live comparing against "" and never match, so the automation silently
  // never runs. Opaque rows are API-authored groups the builder cannot edit,
  // and a row with no field or operator never reaches the definition
  // (toSaveBody drops it), so neither is a blocker here.
  for (const c of d.conditions) {
    if (c.opaque !== undefined || !c.field || !c.operator) continue;
    if (NEEDS_VALUE.has(c.operator) && !(c.value ?? "").trim()) out.conditions[c.id] = EMPTY_CONDITION_MESSAGE;
  }
  if (d.trigger === "task.field_changed" && typeof d.when.field !== "string") {
    // Not a blocker: no field means "any field". Nothing to report.
  }
  return out;
}

export function hasProblems(p: PublishProblems): boolean {
  return Boolean(p.when || p.then || Object.keys(p.conditions).length || Object.keys(p.actions).length);
}

/** Move one item in a list (drag to reorder). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
