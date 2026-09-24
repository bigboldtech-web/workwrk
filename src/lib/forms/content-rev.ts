// The builder's concurrency guard (Phase 5 Stage D). The builder autosaves the
// WHOLE draft on every change, so without a precondition a second tab or a
// co-editor holding an older copy overwrote fields and settings added
// elsewhere with its first keystroke, and neither side was told.
//
// The guard is a revision of the builder's own content: the seven columns the
// builder writes (name, description, fields, targetBoardId, targetTableId,
// fieldMappings, settings). GET /api/forms/[id] and every PATCH answer
// `contentRev`; the builder sends it back as `expectRev`. A PATCH whose
// expectRev no longer names the stored content is refused with 409
// { error: "form_changed", contentRev } and writes nothing.
//
// A revision of the CONTENT, not updatedAt, on purpose: the Share dialog's
// public-link switch, a response or a rename that the builder reloads after
// all touch the row without touching what the builder edits, and none of
// them may make the builder's next save look stale.
//
// Keys are sorted before hashing because Postgres jsonb does not keep the key
// order it was given, so the stored copy of the same object reads back in a
// different order.
//
// Pure (node:crypto only), unit-tested in content-rev.test.ts.

import { createHash } from "node:crypto";

export const FORM_CONTENT_KEYS = [
  "name", "description", "fields", "targetBoardId", "targetTableId", "fieldMappings", "settings",
] as const;

export type FormContentKey = (typeof FORM_CONTENT_KEYS)[number];

/** JSON with every object's keys sorted; undefined members are dropped the
 *  way JSON.stringify drops them. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** The revision of a form's builder content. A missing key (a database
 *  without the settings column) reads as null, the same on every read. */
export function formContentRev(form: Partial<Record<FormContentKey, unknown>>): string {
  const picked: Record<string, unknown> = {};
  for (const k of FORM_CONTENT_KEYS) picked[k] = form[k] ?? null;
  return createHash("sha256").update(stableStringify(picked)).digest("hex").slice(0, 20);
}

/** Whether a PATCH may write. `expectRev` absent: an older client or another
 *  caller (the Share dialog), which writes as before. Present: it must name
 *  the stored content, OR the write must already be what is stored (a retry
 *  whose first attempt landed but whose answer was lost). */
export function patchAllowed(opts: { expectRev: string | null; storedRev: string; nextRev: string }): boolean {
  if (!opts.expectRev) return true;
  return opts.expectRev === opts.storedRev || opts.nextRev === opts.storedRev;
}
