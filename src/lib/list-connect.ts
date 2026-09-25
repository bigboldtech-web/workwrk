// Connected and mirror columns between Lists, monday.com's model, as FIELD
// CONFIG in Board.schema (no new table).
//
//   CONNECT: a RELATIONSHIP field whose options carry `targetBoardIds` (1 to
//   10 Lists). Its value is an array of task ids from those Lists. A
//   RELATIONSHIP WITHOUT targetBoardIds keeps today's single { kind, id }
//   doc-link mode, untouched, and a field's mode never changes (see
//   connect_mode_immutable in the fields route), so no stored value ever
//   changes shape under a reader.
//   MIRROR: a field whose options name a connect field on the SAME List
//   (`linkFieldKey`) and, per target List, the field it shows
//   (`lookupFieldKeys`), optionally rolled up. It is computed at READ time and
//   never stored, so it can never disagree with its source.
//
// The Tables module's link, lookup and rollup (relation-config-modal.tsx and
// the sheet engine) are the idea; none of their code paths are shared,
// because a task is not a table row: it has an access ladder of its own, and
// a mirror may only ever show values the VIEWER can read on the target task.
// An unreadable task contributes nothing and is never named, and that rule is
// applied by the caller before these functions see a single id.
//
// Pure: type-only imports.

import type { FieldDef } from "@/lib/field-catalog";

/** A connect value may name at most this many LIVE tasks. */
export const MAX_CONNECTIONS = 50;
/** A connect field may target at most this many Lists. */
export const MAX_CONNECT_TARGETS = 10;

export const MIRROR_ROLLUP_FNS = ["SUM", "AVG", "MIN", "MAX", "COUNT", "CONCAT"] as const;
export type MirrorRollupFn = (typeof MIRROR_ROLLUP_FNS)[number];
const NUMERIC_ROLLUPS: ReadonlySet<string> = new Set(["SUM", "AVG", "MIN", "MAX"]);

/** The field types a SUM, AVG, MIN or MAX may read. */
export const NUMERIC_FIELD_TYPES: ReadonlySet<string> = new Set(["NUMBER", "MONEY", "PERCENT", "RATING", "PROGRESS_MANUAL"]);

/**
 * The task's own columns a mirror may show, named with the same keys the
 * table already uses for them (field-catalog BUILTIN_COLUMNS).
 */
export const MIRROR_BUILTIN_KEYS = [
  "__builtin_status",
  "__builtin_priority",
  "__builtin_due",
  "__builtin_start",
  "__builtin_owner",
] as const;
const BUILTIN: ReadonlySet<string> = new Set(MIRROR_BUILTIN_KEYS);

/**
 * Field types a mirror may NOT look up. A mirror of a mirror or of a connect
 * value would chain ids across Lists; a link to a Doc, SOP or Canvas, or a
 * file, points at an object with an access rule of its own that the mirror
 * cannot check; the rest carry no value yet.
 */
const NOT_LOOKUPABLE: ReadonlySet<string> = new Set([
  "MIRROR", "RELATIONSHIP", "FILES", "LINKED_DOC", "LINKED_SOP", "LINKED_CANVAS",
  "BUTTON", "SIGNATURE", "FORMULA", "ROLLUP", "PROGRESS_AUTO", "ACTION_ITEMS",
  "SUMMARY", "SENTIMENT", "CATEGORIZE", "TRANSLATION",
]);

type FieldLike = Pick<FieldDef, "key" | "type"> & { options?: unknown };

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)));
}

// ── Reading field config ─────────────────────────────────────────────

/** A connect-mode RELATIONSHIP: one that names target Lists. */
export function isConnectField(f: FieldLike): boolean {
  return f.type === "RELATIONSHIP" && Array.isArray(asObject(f.options).targetBoardIds);
}

export function isMirrorField(f: FieldLike): boolean {
  return (f.type as string) === "MIRROR";
}

export function connectTargets(f: FieldLike): string[] {
  return isConnectField(f) ? cleanIds(asObject(f.options).targetBoardIds) : [];
}

export interface MirrorOptions {
  linkFieldKey: string;
  /** Target List id to the field key (or builtin key) the mirror shows. */
  lookupFieldKeys: Record<string, string>;
  rollupFn?: MirrorRollupFn;
}

export function mirrorOptionsOf(f: FieldLike): MirrorOptions | null {
  if (!isMirrorField(f)) return null;
  const o = asObject(f.options);
  if (typeof o.linkFieldKey !== "string" || !o.linkFieldKey) return null;
  const lookups: Record<string, string> = {};
  for (const [list, key] of Object.entries(asObject(o.lookupFieldKeys))) {
    if (typeof key === "string" && key) lookups[list] = key;
  }
  const fn = typeof o.rollupFn === "string" && (MIRROR_ROLLUP_FNS as readonly string[]).includes(o.rollupFn)
    ? (o.rollupFn as MirrorRollupFn)
    : undefined;
  return { linkFieldKey: o.linkFieldKey, lookupFieldKeys: lookups, ...(fn ? { rollupFn: fn } : {}) };
}

/** The key sets every read and write of a List needs, from its schema. */
export function fieldKeySets(fields: readonly FieldLike[]): {
  stored: Set<string>;
  connect: Set<string>;
  mirror: Set<string>;
} {
  const stored = new Set<string>();
  const connect = new Set<string>();
  const mirror = new Set<string>();
  for (const f of fields) {
    if (isMirrorField(f)) {
      mirror.add(f.key);
      continue;
    }
    stored.add(f.key);
    if (isConnectField(f)) connect.add(f.key);
  }
  return { stored, connect, mirror };
}

// ── Validating config ────────────────────────────────────────────────

/** The shape half of a connect field's options; the route checks each List. */
export function validateConnectOptionsShape(options: unknown): { ok: true; targetBoardIds: string[] } | { ok: false; issue: "invalid_targets" } {
  const raw = asObject(options).targetBoardIds;
  if (!Array.isArray(raw)) return { ok: false, issue: "invalid_targets" };
  if (raw.some((v) => typeof v !== "string" || !v.trim() || v.length > 64)) return { ok: false, issue: "invalid_targets" };
  const ids = cleanIds(raw);
  if (ids.length !== raw.length || ids.length < 1 || ids.length > MAX_CONNECT_TARGETS) return { ok: false, issue: "invalid_targets" };
  return { ok: true, targetBoardIds: ids };
}

/** Can a mirror show this field of the target List? */
export function isLookupableField(f: FieldLike): boolean {
  return !NOT_LOOKUPABLE.has(f.type as string);
}

export type MirrorIssue = "link_field_not_connect" | "no_lookups" | "unknown_lookup" | "rollup_not_numeric" | "invalid_rollup";

/**
 * A mirror's options, checked against THIS List's schema and the target
 * Lists the caller can read. Every lookup must name one of the connect
 * field's targets that the caller can read, and a field of that List a mirror
 * may show (or a builtin key); a numeric rollup only reads numeric fields.
 * Returns the options normalised, with anything unrecognised stripped.
 */
export function validateMirrorOptions(
  options: unknown,
  ctx: {
    fields: readonly FieldLike[];
    targetFields: ReadonlyMap<string, readonly FieldLike[]>;
    readableTargets: ReadonlySet<string>;
  },
): { ok: true; options: MirrorOptions } | { ok: false; issue: MirrorIssue } {
  const o = asObject(options);
  const linkKey = typeof o.linkFieldKey === "string" ? o.linkFieldKey : "";
  const link = ctx.fields.find((f) => f.key === linkKey);
  if (!link || !isConnectField(link)) return { ok: false, issue: "link_field_not_connect" };
  const targets = new Set(connectTargets(link));
  const lookupsRaw = asObject(o.lookupFieldKeys);
  const entries = Object.entries(lookupsRaw);
  if (entries.length === 0) return { ok: false, issue: "no_lookups" };
  let fn: MirrorRollupFn | undefined;
  if (o.rollupFn !== undefined && o.rollupFn !== null) {
    if (typeof o.rollupFn !== "string" || !(MIRROR_ROLLUP_FNS as readonly string[]).includes(o.rollupFn)) return { ok: false, issue: "invalid_rollup" };
    fn = o.rollupFn as MirrorRollupFn;
  }
  const lookups: Record<string, string> = {};
  for (const [listId, key] of entries) {
    if (typeof key !== "string" || !key) return { ok: false, issue: "unknown_lookup" };
    if (!targets.has(listId) || !ctx.readableTargets.has(listId)) return { ok: false, issue: "unknown_lookup" };
    if (BUILTIN.has(key)) {
      if (fn && NUMERIC_ROLLUPS.has(fn)) return { ok: false, issue: "rollup_not_numeric" };
      lookups[listId] = key;
      continue;
    }
    const target = (ctx.targetFields.get(listId) ?? []).find((f) => f.key === key);
    if (!target || !isLookupableField(target)) return { ok: false, issue: "unknown_lookup" };
    if (fn && NUMERIC_ROLLUPS.has(fn) && !NUMERIC_FIELD_TYPES.has(target.type as string)) return { ok: false, issue: "rollup_not_numeric" };
    lookups[listId] = key;
  }
  return { ok: true, options: { linkFieldKey: linkKey, lookupFieldKeys: lookups, ...(fn ? { rollupFn: fn } : {}) } };
}

/**
 * A field as one viewer may see it. A connect field names only the target
 * Lists the viewer can read, a mirror only the lookups into them, and nothing
 * says how many were removed.
 */
export function redactFieldForViewer<F extends FieldLike>(field: F, readableLists: ReadonlySet<string>): F {
  if (isConnectField(field)) {
    const o = asObject(field.options);
    return { ...field, options: { ...o, targetBoardIds: connectTargets(field).filter((id) => readableLists.has(id)) } };
  }
  if (isMirrorField(field)) {
    const o = asObject(field.options);
    const kept: Record<string, unknown> = {};
    for (const [listId, key] of Object.entries(asObject(o.lookupFieldKeys))) {
      if (readableLists.has(listId)) kept[listId] = key;
    }
    return { ...field, options: { ...o, lookupFieldKeys: kept } };
  }
  return field;
}

/**
 * An edit to a connect or mirror field from an editor who cannot read every
 * target. What they submit replaces what they could see; every entry for a
 * List they cannot read is kept exactly as stored, because an editor must
 * never silently drop a target they were not shown.
 */
export function mergeHiddenTargets(
  stored: FieldLike,
  submittedOptions: Record<string, unknown>,
  readableLists: ReadonlySet<string>,
): Record<string, unknown> {
  if (isConnectField(stored)) {
    const hidden = connectTargets(stored).filter((id) => !readableLists.has(id));
    const mine = cleanIds(submittedOptions.targetBoardIds).filter((id) => readableLists.has(id));
    return { ...submittedOptions, targetBoardIds: Array.from(new Set([...mine, ...hidden])) };
  }
  if (isMirrorField(stored)) {
    const storedLookups = asObject(asObject(stored.options).lookupFieldKeys);
    const merged: Record<string, unknown> = {};
    for (const [listId, key] of Object.entries(storedLookups)) if (!readableLists.has(listId)) merged[listId] = key;
    for (const [listId, key] of Object.entries(asObject(submittedOptions.lookupFieldKeys))) {
      if (readableLists.has(listId)) merged[listId] = key;
    }
    return { ...submittedOptions, lookupFieldKeys: merged };
  }
  return submittedOptions;
}

// ── Writing a connect value ──────────────────────────────────────────

export type ConnectWriteError = "invalid_connection" | "too_many_connections";

/**
 * A submitted connect value. Null clears it. Otherwise an array of task ids,
 * each either already stored or RESOLVABLE for the writer (it exists, is live,
 * is in one of the field's target Lists and the writer can read it), and
 * never the task itself. This is the shape and membership half; the cap on a
 * merged value is `mergeConnectValue`'s.
 */
export function validateConnectWrite(
  value: unknown,
  ctx: { resolvable: ReadonlySet<string>; alreadyStored?: ReadonlySet<string>; selfId?: string | null },
): { ok: true; ids: string[] } | { ok: false; error: ConnectWriteError } {
  if (value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim() || v.length > 64)) {
    return { ok: false, error: "invalid_connection" };
  }
  const ids = cleanIds(value);
  if (ctx.selfId && ids.includes(ctx.selfId)) return { ok: false, error: "invalid_connection" };
  for (const id of ids) {
    if (ctx.alreadyStored?.has(id)) continue;
    if (!ctx.resolvable.has(id)) return { ok: false, error: "invalid_connection" };
  }
  if (!ctx.alreadyStored && ids.length > MAX_CONNECTIONS) return { ok: false, error: "too_many_connections" };
  return { ok: true, ids };
}

/**
 * The value to store when a writer submits a connect value over a stored one.
 *
 * Connections the writer cannot see SURVIVE: they were never shown, so their
 * absence from the submission says nothing. A deleted task never counts
 * toward the cap. More than MAX_CONNECTIONS live ids is refused, never
 * truncated, because a truncation would silently drop somebody's work.
 */
export function mergeConnectValue(
  stored: unknown,
  submitted: readonly string[] | null,
  ctx: { readable: ReadonlySet<string>; live: ReadonlySet<string> },
): { ok: true; ids: string[] } | { ok: false; error: "too_many_connections" } {
  const hidden = cleanIds(stored).filter((id) => !ctx.readable.has(id));
  const ids = Array.from(new Set([...(submitted ?? []), ...hidden]));
  const liveCount = ids.filter((id) => ctx.live.has(id)).length;
  if (liveCount > MAX_CONNECTIONS) return { ok: false, error: "too_many_connections" };
  return { ok: true, ids };
}

// ── Reading: connections and mirrors ─────────────────────────────────

export interface ConnectionRef {
  id: string;
  title: string;
  statusLabel: string | null;
  statusColor: string | null;
  done: boolean;
}

/** The readable connected tasks, in stored order. Unknown ids contribute nothing. */
export function buildConnections(ids: readonly string[], info: ReadonlyMap<string, ConnectionRef>): ConnectionRef[] {
  const out: ConnectionRef[] = [];
  for (const id of ids) {
    const ref = info.get(id);
    if (ref) out.push(ref);
  }
  return out;
}

export interface MirrorValue {
  values: unknown[];
  rollup?: number | string | null;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** The rollup of a mirror's values. Numeric functions ignore anything that is not a finite number. */
export function rollupValues(fn: MirrorRollupFn, values: readonly unknown[]): number | string | null {
  const present = values.filter((v) => !isEmptyValue(v));
  if (fn === "COUNT") return present.length;
  if (fn === "CONCAT") {
    const parts = present.flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => (typeof v === "string" ? v : String(v)));
    return parts.join(", ");
  }
  const nums = present.map((v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN)).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  switch (fn) {
    case "SUM": return nums.reduce((a, b) => a + b, 0);
    case "AVG": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "MIN": return Math.min(...nums);
    case "MAX": return Math.max(...nums);
  }
  return null;
}

/**
 * One row's mirror value. `lookup` answers, for a connected task the viewer
 * can read, which of the mirror's target Lists the task is in and its value
 * there, or null; a task with no answer contributes nothing, so a mirror can
 * only ever be built from what the viewer can read.
 */
export function computeMirror(
  connectedIds: readonly string[],
  mirror: MirrorOptions,
  lookup: (itemId: string) => { listId: string; read: (key: string) => unknown } | null,
): MirrorValue {
  const values: unknown[] = [];
  for (const id of connectedIds) {
    const hit = lookup(id);
    if (!hit) continue;
    const key = mirror.lookupFieldKeys[hit.listId];
    if (!key) continue;
    values.push(hit.read(key));
  }
  if (!mirror.rollupFn) return { values };
  return { values, rollup: rollupValues(mirror.rollupFn, values) };
}
