// What actually changed on a task, pure.
//
// These three helpers exist so `updateBoardItem` can write an activity row a
// person can read. Before Phase 2, EVERY metadata patch logged one
// `FIELDS_UPDATED` row with empty meta, so a description that autosaves would
// fill the Activity tab with identical, unreadable rows (spec-task-detail
// section 4 step 1, and the audit's FIELDS_UPDATED note).
//
// Pure module: no imports, so vitest loads it in the node environment.

/**
 * Bookkeeping keys the product writes into `Item.metadata` that are never a
 * user-visible field edit: the recurrence engine's spawn ledger, and the two
 * watcher lists (subscribing to a task is not "someone changed a field", and
 * before this a Watch click filed a row reading "updated fields: unwatchers,
 * watchers").
 */
export const INTERNAL_METADATA_KEYS: readonly string[] = [
  "lastSpawnedKey",
  "skippedOccurrences",
  "recurrenceSourceId",
  "recurrenceKey",
  "watchers",
  "unwatchers",
  "followers",
];

/** Two assignee lists, order-insensitive (order carries the DRI, not identity). */
export function sameIdList(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

/** Two nullable instants. A Date and its own ISO string are the same instant. */
export function sameTime(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  const ta = a == null ? null : new Date(a).getTime();
  const tb = b == null ? null : new Date(b).getTime();
  if (ta === null || tb === null) return ta === tb;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) && Number.isNaN(tb);
  return ta === tb;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * JSON with object keys sorted at every depth.
 *
 * Postgres `jsonb` does not preserve key order, so the blob that comes back
 * from a read is not key-for-key the blob that was written. A plain
 * `JSON.stringify` comparison therefore reported EVERY nested object and every
 * object-array as changed on every save, including a byte-identical re-save,
 * which is exactly the unreadable FIELDS_UPDATED stream this module exists to
 * remove. Arrays keep their order, because in an array order is meaning.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = src[k];
      return out;
    }
    return v;
  });
}

/** Deep equality for two stored JSON values, insensitive to jsonb key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    // A value that cannot be serialised (a cycle) is treated as changed, which
    // over-reports rather than swallowing a real edit.
    return false;
  }
}

/**
 * The metadata keys a wholesale `PATCH { metadata }` actually moved.
 *
 * `PATCH /api/items/[id]` replaces `metadata` whole, so "what changed" is the
 * symmetric difference of the two blobs, minus the recurrence bookkeeping.
 * Sorted so an activity row is stable and a test can assert it.
 */
export function changedMetadataKeys(before: unknown, after: unknown): string[] {
  const a = asRecord(before);
  const b = asRecord(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const key of keys) {
    if (INTERNAL_METADATA_KEYS.includes(key)) continue;
    if (!sameValue(a[key], b[key])) out.push(key);
  }
  return out.sort();
}
