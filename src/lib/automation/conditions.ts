/**
 * Condition evaluation — `definition.conditions` vs the trigger payload.
 *
 * Shape (authored by the workflow builder):
 *   ConditionGroup = { logic: "AND" | "OR", rules: (ConditionRule | ConditionGroup)[] }
 *   ConditionRule  = { field: string, operator: Operator, value?: unknown }
 *
 * Groups nest arbitrarily. `field` is a dot-path into the flat trigger
 * payload ("status", "previousStatus", "metadata.city").
 *
 * Guarantees (per the plan's edge cases):
 *   - A missing/renamed field never throws — the rule evaluates false
 *     and the miss is reported in the evaluation trace.
 *   - An unknown operator evaluates false (trace notes it).
 *   - No conditions at all = match (trigger-only workflows run).
 */

export type ConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "before"
  | "after"
  | "within_next_days"
  | "older_than";

export interface ConditionRule {
  field: string;
  operator: ConditionOperator | string;
  value?: unknown;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  rules: Array<ConditionRule | ConditionGroup>;
}

export interface ConditionEvalResult {
  matched: boolean;
  /** Human-readable trace of each leaf rule for the run-step log. */
  trace: Array<{ field: string; operator: string; value?: unknown; actual?: unknown; result: boolean; note?: string }>;
}

export const CONDITION_OPERATORS: Array<{ key: ConditionOperator; label: string; needsValue: boolean }> = [
  { key: "eq", label: "equals", needsValue: true },
  { key: "neq", label: "does not equal", needsValue: true },
  { key: "contains", label: "contains", needsValue: true },
  { key: "gt", label: "greater than", needsValue: true },
  { key: "lt", label: "less than", needsValue: true },
  { key: "gte", label: "at least", needsValue: true },
  { key: "lte", label: "at most", needsValue: true },
  { key: "is_empty", label: "is empty", needsValue: false },
  { key: "is_not_empty", label: "is not empty", needsValue: false },
  { key: "before", label: "is before (date)", needsValue: true },
  { key: "after", label: "is after (date)", needsValue: true },
  { key: "within_next_days", label: "is within the next N days", needsValue: true },
  { key: "older_than", label: "is older than N days", needsValue: true },
];

function isGroup(node: ConditionRule | ConditionGroup): node is ConditionGroup {
  return typeof node === "object" && node !== null && Array.isArray((node as ConditionGroup).rules);
}

/** Resolve a dot-path against the payload. Returns undefined on any miss. */
export function resolveField(payload: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = payload;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function evalRule(rule: ConditionRule, payload: Record<string, unknown>): { result: boolean; actual: unknown; note?: string } {
  const actual = resolveField(payload, rule.field);
  const op = rule.operator;

  if (op === "is_empty") return { result: isEmptyValue(actual), actual };
  if (op === "is_not_empty") return { result: !isEmptyValue(actual), actual };

  // Every other operator needs a real field value — missing field = false.
  if (actual === undefined) {
    return { result: false, actual, note: "field missing from payload" };
  }

  switch (op) {
    case "eq": {
      if (typeof actual === "string" && typeof rule.value === "string") {
        return { result: actual.toLowerCase() === rule.value.toLowerCase(), actual };
      }
      const an = asNumber(actual);
      const bn = asNumber(rule.value);
      if (an !== null && bn !== null) return { result: an === bn, actual };
      return { result: actual === rule.value, actual };
    }
    case "neq": {
      const inner = evalRule({ ...rule, operator: "eq" }, payload);
      return { result: !inner.result, actual };
    }
    case "contains": {
      if (Array.isArray(actual)) {
        return { result: actual.some((v) => String(v).toLowerCase() === String(rule.value ?? "").toLowerCase()), actual };
      }
      return {
        result: String(actual).toLowerCase().includes(String(rule.value ?? "").toLowerCase()),
        actual,
      };
    }
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const a = asNumber(actual);
      const b = asNumber(rule.value);
      if (a === null || b === null) return { result: false, actual, note: "not comparable as numbers" };
      if (op === "gt") return { result: a > b, actual };
      if (op === "lt") return { result: a < b, actual };
      if (op === "gte") return { result: a >= b, actual };
      return { result: a <= b, actual };
    }
    case "before":
    case "after": {
      const a = asDate(actual);
      const b = asDate(rule.value);
      if (!a || !b) return { result: false, actual, note: "not comparable as dates" };
      return { result: op === "before" ? a.getTime() < b.getTime() : a.getTime() > b.getTime(), actual };
    }
    case "within_next_days": {
      const a = asDate(actual);
      const days = asNumber(rule.value);
      if (!a || days === null) return { result: false, actual, note: "needs a date field + numeric days" };
      const now = Date.now();
      return { result: a.getTime() >= now && a.getTime() <= now + days * 86_400_000, actual };
    }
    case "older_than": {
      const a = asDate(actual);
      const days = asNumber(rule.value);
      if (!a || days === null) return { result: false, actual, note: "needs a date field + numeric days" };
      return { result: a.getTime() < Date.now() - days * 86_400_000, actual };
    }
    default:
      return { result: false, actual, note: `unknown operator: ${String(op)}` };
  }
}

function evalGroup(group: ConditionGroup, payload: Record<string, unknown>, trace: ConditionEvalResult["trace"]): boolean {
  const logic = group.logic === "OR" ? "OR" : "AND";
  const rules = Array.isArray(group.rules) ? group.rules : [];
  if (rules.length === 0) return true;

  let matched = logic === "AND";
  for (const node of rules) {
    let result: boolean;
    if (isGroup(node)) {
      result = evalGroup(node, payload, trace);
    } else {
      const r = evalRule(node, payload);
      trace.push({
        field: node.field,
        operator: String(node.operator),
        value: node.value,
        actual: r.actual,
        result: r.result,
        ...(r.note ? { note: r.note } : {}),
      });
      result = r.result;
    }
    if (logic === "AND" && !result) matched = false;
    if (logic === "OR" && result) matched = true;
  }
  return matched;
}

/**
 * Evaluate a workflow's condition tree against the trigger payload.
 * Null/undefined/empty conditions = match. Never throws.
 */
export function evaluateConditions(
  conditions: unknown,
  payload: Record<string, unknown>,
): ConditionEvalResult {
  const trace: ConditionEvalResult["trace"] = [];
  try {
    if (!conditions || typeof conditions !== "object") return { matched: true, trace };
    const group = conditions as ConditionGroup;
    if (!Array.isArray(group.rules) || group.rules.length === 0) return { matched: true, trace };
    return { matched: evalGroup(group, payload, trace), trace };
  } catch {
    // A malformed condition tree must never break the engine — treat as no-match.
    return { matched: false, trace: [{ field: "*", operator: "*", result: false, note: "condition tree failed to evaluate" }] };
  }
}
