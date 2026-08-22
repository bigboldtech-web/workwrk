// Cross-client conflict detection for Tables (Phase 5c concurrency guard).
//
// The two row-update routes shallow-merge incoming cells into FRESH server
// values, so concurrent edits to DIFFERENT cells of one row already compose
// correctly without any of this. The only silent loss is two clients writing
// the SAME cell: last write wins and the loser never learns. There is no
// realtime channel yet (SSE is gated), so this module's job is to SURFACE
// that case, not to sync: a client may attach `expect` (the stored value each
// edited cell started from) and the server refuses the write when the store
// has since moved.
//
// Values are Prisma Json: null / number / string / boolean / arrays
// (multi_select), plain objects ({"=": src} formula cells). Never undefined,
// never NaN, never Date/Map/class instances, so the equality below only has
// to be right for that closed set.

const hasOwn = Object.prototype.hasOwnProperty;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep equality over the Json value set, tuned to avoid FALSE conflicts:
 *
 *  - null and undefined are mutually equal ("nullish collapse"): an empty
 *    cell reads null client-side but is often simply ABSENT from the stored
 *    row object, and absence-vs-null must never 409 an edit of a blank cell.
 *    Applied uniformly (a null-valued key inside a nested object equals a
 *    missing key) so the rule has no depth-dependent surprises.
 *  - objects compare key-order-insensitively: JSON round-trips through
 *    Postgres/serialization may reorder keys and that is not a data change.
 *  - arrays compare order-SENSITIVELY: multi_select values are arrays whose
 *    order the user arranged, so a reorder is a real edit.
 *  - primitives compare with ===: types matter, 1 and "1" are DIFFERENT
 *    (a type change is exactly the kind of concurrent edit to surface).
 *    NaN !== NaN would misfire here but NaN cannot occur in Json.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    // Union of keys, then per-key recursion: a key present on one side with
    // value null and absent on the other falls into the nullish collapse
    // above and matches. hasOwn guards keep inherited names (constructor,
    // toString, a JSON.parse'd __proto__) from leaking prototype values
    // into the comparison.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const av = hasOwn.call(a, k) ? a[k] : undefined;
      const bv = hasOwn.call(b, k) ? b[k] : undefined;
      if (!jsonEqual(av, bv)) return false;
    }
    return true;
  }
  // Mixed shapes (number vs string, object vs primitive, ...): a real change.
  return false;
}

/** Compare a client's `expect` map against the row's CURRENT stored values.
 *  Returns the colIds whose stored value no longer matches; [] means the
 *  write is clean. Only keys named in `expect` are checked: the client
 *  vouches for the cells it edited, nothing else, which is what lets
 *  cross-client edits to different cells keep composing merge-free. */
export function expectConflicts(
  current: Record<string, unknown>,
  expect: Record<string, unknown>,
): string[] {
  const conflicts: string[] = [];
  for (const colId of Object.keys(expect)) {
    // hasOwn, not bare indexing: current is parsed JSON, and a colId like
    // "toString" must read as ABSENT (undefined), not as the prototype's
    // function, or a null expect on such a column would false-conflict.
    const cur = hasOwn.call(current, colId) ? current[colId] : undefined;
    if (!jsonEqual(cur, expect[colId])) conflicts.push(colId);
  }
  return conflicts;
}
