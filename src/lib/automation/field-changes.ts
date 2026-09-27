// "When a task field changes" (registry-triggers task.field_changed): which
// fields one task save changed, as the event payloads the trigger fires with.
// One event per changed field, so an automation watching "Priority" runs once
// for a priority change and not for a title edit in the same save.
//
//   built-in fields  title, priority, dueAt, startAt
//   List fields      the keys of the task's metadata that are fields of its
//                    List (the caller passes that key set), so a watcher,
//                    link or internal key never fires the trigger
//
// Status and assignee changes have their own triggers and are not repeated
// here. Pure, so the route and the tests agree.

export const BUILT_IN_FIELD_KEYS = ["title", "priority", "dueAt", "startAt"] as const;

export interface FieldChange {
  field: string;
  value: unknown;
  previousValue: unknown;
}

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === "") return null;
  return v;
}

function same(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (x && y && typeof x === "object" && typeof y === "object") {
    try {
      return JSON.stringify(x) === JSON.stringify(y);
    } catch {
      return false;
    }
  }
  // "2026-09-26T00:00:00.000Z" against a Date parsed from the same instant.
  if (typeof x === "string" && typeof y === "string") {
    const tx = Date.parse(x);
    const ty = Date.parse(y);
    if (Number.isFinite(tx) && Number.isFinite(ty) && /\d{4}-\d{2}-\d{2}T/.test(x) && /\d{4}-\d{2}-\d{2}T/.test(y)) return tx === ty;
  }
  return false;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function fieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  listFieldKeys: Iterable<string> = [],
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const key of BUILT_IN_FIELD_KEYS) {
    if (!(key in after)) continue;
    if (!same(before[key], after[key])) out.push({ field: key, value: norm(after[key]), previousValue: norm(before[key]) });
  }
  const bm = asRecord(before.metadata);
  const am = asRecord(after.metadata);
  for (const key of new Set(listFieldKeys)) {
    if (!(key in am) && !(key in bm)) continue;
    if (!same(bm[key], am[key])) out.push({ field: key, value: norm(am[key]), previousValue: norm(bm[key]) });
  }
  return out;
}
