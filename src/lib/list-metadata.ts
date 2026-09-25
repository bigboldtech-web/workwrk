// A task's field values when it lives in more than one List.
//
// THE STORAGE RULE. The HOME List's field values stay at metadata[key]
// exactly as today, so every existing reader and writer of Item.metadata is
// untouched. A List the task is LINKED into keeps ITS field values at
// metadata.$lists[boardId][key], with its own $connectKeys marker. A field
// key is a slug of [a-z0-9_] (src/lib/field-catalog.ts slugifyFieldKey), so no
// field can ever be named "$lists" or "$connectKeys", and two Lists whose
// fields share a slug can never overwrite or relabel each other: each List
// reads and writes only its own namespace.
//
// THE MARKER. `$connectKeys` names the keys (at the top level for the home,
// inside a namespace for a linked List) whose values are CONNECT values:
// arrays of task ids. It exists so a projection can find every stored id
// array even after its field is deleted, and reduce it or drop it, rather
// than send ids of tasks the viewer cannot read.
//
// NOTHING RESERVED IS EVER SENT. Every key starting with "$" is stripped by
// every projection, and a write naming one is refused by the routes.
//
// Pure: no imports. Every function takes the stored value and returns a new
// one; nothing here reads the database or mutates its input.

export const LISTS_NS = "$lists";
export const CONNECT_KEYS_META = "$connectKeys";

/**
 * The keys that belong to the TASK, not to any List's fields: the task body
 * (board-item-detail.tsx, create-task-modal.tsx) and the watcher lists
 * (item-watchers.ts). They travel with the task into every List it appears
 * in, because sharing a task shares its body.
 */
export const TASK_LEVEL_METADATA_KEYS = [
  "description",
  "checklist",
  "timeEstimate",
  "kraId",
  "kpiId",
  "watchers",
  "unwatchers",
  "followers",
] as const;

const TASK_LEVEL: ReadonlySet<string> = new Set(TASK_LEVEL_METADATA_KEYS);

export type Json = Record<string, unknown>;

/** Reserved for the storage rule above; never a field, never sent. */
export function isReservedMetadataKey(k: string): boolean {
  return typeof k === "string" && k.startsWith("$");
}

export function isTaskLevelMetadataKey(k: string): boolean {
  return TASK_LEVEL.has(k);
}

function asObject(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

/** The keys a marker names, or none. */
export function readConnectMarker(obj: unknown): string[] {
  const raw = asObject(obj)[CONNECT_KEYS_META];
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((k): k is string => typeof k === "string" && k.length > 0 && !isReservedMetadataKey(k))));
}

function writeMarker(obj: Json, keys: Iterable<string>): void {
  const list = Array.from(new Set(keys)).filter((k) => !isReservedMetadataKey(k)).sort();
  if (list.length) obj[CONNECT_KEYS_META] = list;
  else delete obj[CONNECT_KEYS_META];
}

/** Every List namespace on the task, keyed by board id. */
export function readNamespaces(stored: unknown): Record<string, Json> {
  const raw = asObject(asObject(stored)[LISTS_NS]);
  const out: Record<string, Json> = {};
  for (const [id, ns] of Object.entries(raw)) {
    if (ns && typeof ns === "object" && !Array.isArray(ns)) out[id] = ns as Json;
  }
  return out;
}

/** One List's namespace, or an empty object. */
export function readNamespace(stored: unknown, listId: string): Json {
  return readNamespaces(stored)[listId] ?? {};
}

/** A stored connect value as a clean id list. Anything else is no ids. */
export function connectIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)));
}

export type ReadableIds = ReadonlySet<string> | ((id: string) => boolean);

function isReadable(readable: ReadableIds, id: string): boolean {
  return typeof readable === "function" ? readable(id) : readable.has(id);
}

export type ProjectionContext =
  | {
      kind: "home";
      /** Every STORED field key the home List defines (mirrors are computed, not stored). */
      contextStoredKeys: ReadonlySet<string>;
      /** The home List's connect-mode relationship keys. */
      contextConnectKeys: ReadonlySet<string>;
      /** The task ids the viewer can read. */
      readable: ReadableIds;
    }
  | {
      kind: "linked";
      listId: string;
      /** Can the viewer read the task's HOME List? */
      homeReadable: boolean;
      contextStoredKeys: ReadonlySet<string>;
      contextConnectKeys: ReadonlySet<string>;
      readable: ReadableIds;
    };

/**
 * The metadata one viewer receives for one task in one List context.
 *
 * HOME: the stored blob minus every "$" key; the context's connect values
 * reduced to the tasks the viewer can read; any other key the marker names
 * (a connect field that was deleted) dropped, because nothing can reduce it
 * any more.
 *
 * LINKED (List B): the task-level keys; when the viewer can read the home
 * List, the home's other values too (still minus connect values); then EVERY
 * key B defines replaced by B's namespaced value, or deleted when B has none.
 * A linked-only viewer therefore never receives a home-only field value, a
 * "$" key, or a connected id they cannot read (not even as an array length),
 * and a home value under the same slug as one of B's fields never stands in
 * for B's own.
 *
 * `connected` is the reduced id list per connect key, for the connections and
 * mirrors the read builds next.
 */
export function projectRowMetadata(
  stored: unknown,
  ctx: ProjectionContext,
): { metadata: Json; connected: Record<string, string[]> } {
  const src = asObject(stored);
  const connected: Record<string, string[]> = {};
  const reduce = (v: unknown) => connectIdsOf(v).filter((id) => isReadable(ctx.readable, id));

  if (ctx.kind === "home") {
    const md: Json = {};
    for (const [k, v] of Object.entries(src)) if (!isReservedMetadataKey(k)) md[k] = v;
    for (const key of new Set([...ctx.contextConnectKeys, ...readConnectMarker(src)])) {
      if (ctx.contextConnectKeys.has(key)) {
        const ids = key in md ? reduce(md[key]) : [];
        if (key in md) md[key] = ids;
        connected[key] = ids;
      } else {
        delete md[key];
      }
    }
    return { metadata: md, connected };
  }

  const ns = readNamespace(src, ctx.listId);
  const homeMarker = new Set(readConnectMarker(src));
  const md: Json = {};
  for (const k of TASK_LEVEL_METADATA_KEYS) if (k in src) md[k] = src[k];
  if (ctx.homeReadable) {
    for (const [k, v] of Object.entries(src)) {
      if (isReservedMetadataKey(k) || TASK_LEVEL.has(k) || homeMarker.has(k)) continue;
      md[k] = v;
    }
  }
  for (const key of ctx.contextStoredKeys) {
    if (!isReservedMetadataKey(key) && key in ns) md[key] = ns[key];
    else delete md[key];
  }
  for (const key of ctx.contextConnectKeys) {
    const ids = key in md ? reduce(md[key]) : [];
    if (key in md) md[key] = ids;
    connected[key] = ids;
  }
  return { metadata: md, connected };
}

/**
 * The keys a HOME projection hid from its viewer, so a wholesale write from
 * that viewer can keep them: a client can only send back what it was given,
 * and must never delete what it never saw.
 */
export function hiddenFromHomeProjection(stored: unknown, contextConnectKeys: ReadonlySet<string>): string[] {
  return readConnectMarker(stored).filter((k) => !contextConnectKeys.has(k));
}

/** The no-viewer fallback: every "$" key and every marker-named value dropped. */
export function stripForUnknownViewer(stored: unknown): Json {
  const src = asObject(stored);
  const marker = new Set(readConnectMarker(src));
  const md: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (isReservedMetadataKey(k) || marker.has(k)) continue;
    md[k] = v;
  }
  return md;
}

// ── Writes ───────────────────────────────────────────────────────────

export type PatchRefusal =
  | { ok: false; error: "reserved_key"; key: string }
  | { ok: false; error: "read_only_field"; key: string }
  | { ok: false; error: "unknown_field"; key: string };

/**
 * Where each key of a metadataPatch sent in a LINKED context goes.
 *
 * A key List B defines goes to B's namespace, a task-level key to the top
 * level, a mirror key is read only, and anything else is refused: in B's
 * context the caller may change B's fields and the task body, and nothing
 * that belongs to the home. B's fields are checked first, so a B field that
 * happens to share a task-level slug is B's, which is the same order the
 * projection uses to read it back.
 */
export function routeMetadataPatch(
  patch: Json,
  ctx: { definedKeys: ReadonlySet<string>; mirrorKeys: ReadonlySet<string> },
): { ok: true; top: Json; ns: Json } | PatchRefusal {
  const top: Json = {};
  const ns: Json = {};
  for (const [k, v] of Object.entries(patch)) {
    if (isReservedMetadataKey(k)) return { ok: false, error: "reserved_key", key: k };
    if (ctx.mirrorKeys.has(k)) return { ok: false, error: "read_only_field", key: k };
    if (ctx.definedKeys.has(k)) ns[k] = v;
    else if (TASK_LEVEL.has(k)) top[k] = v;
    else return { ok: false, error: "unknown_field", key: k };
  }
  return { ok: true, top, ns };
}

/** The HOME context's refusals: a reserved key or a mirror key. */
export function checkHomeMetadataKeys(
  keys: Iterable<string>,
  mirrorKeys: ReadonlySet<string>,
): PatchRefusal | null {
  for (const k of keys) {
    if (isReservedMetadataKey(k)) return { ok: false, error: "reserved_key", key: k };
    if (mirrorKeys.has(k)) return { ok: false, error: "read_only_field", key: k };
  }
  return null;
}

/**
 * Apply a routed patch to the STORED value: a key set to null is deleted,
 * every other stored key is kept, and the connect markers follow the writes.
 */
export function applyMetadataPatch(
  stored: unknown,
  patch: {
    top?: Json;
    ns?: Json;
    listId?: string | null;
    topConnectKeys?: ReadonlySet<string>;
    nsConnectKeys?: ReadonlySet<string>;
  },
): Json {
  const next: Json = { ...asObject(stored) };
  const topMarker = new Set(readConnectMarker(next));
  for (const [k, v] of Object.entries(patch.top ?? {})) {
    if (isReservedMetadataKey(k)) continue;
    if (v === null) {
      delete next[k];
      topMarker.delete(k);
    } else {
      next[k] = v;
      if (patch.topConnectKeys?.has(k)) topMarker.add(k);
    }
  }
  writeMarker(next, topMarker);

  const nsPatch = patch.ns ?? {};
  if (patch.listId && Object.keys(nsPatch).length > 0) {
    const lists: Record<string, Json> = { ...readNamespaces(next) };
    const cur: Json = { ...(lists[patch.listId] ?? {}) };
    const marker = new Set(readConnectMarker(cur));
    for (const [k, v] of Object.entries(nsPatch)) {
      if (isReservedMetadataKey(k)) continue;
      if (v === null) {
        delete cur[k];
        marker.delete(k);
      } else {
        cur[k] = v;
        if (patch.nsConnectKeys?.has(k)) marker.add(k);
      }
    }
    writeMarker(cur, marker);
    if (Object.keys(cur).length > 0) lists[patch.listId] = cur;
    else delete lists[patch.listId];
    if (Object.keys(lists).length > 0) next[LISTS_NS] = lists;
    else delete next[LISTS_NS];
  }
  return next;
}

/**
 * A wholesale metadata write from the HOME context, merged with what is
 * stored: the submitted blob wins for every key the writer could see, while
 * the "$" keys and every key the writer's projection hid (`keepKeys`) are
 * carried over from the stored value, so a whole-blob save can never erase
 * another List's values or a connection the writer was not shown.
 */
export function mergeWholesaleMetadata(
  stored: unknown,
  submitted: Json,
  opts: { keepKeys?: Iterable<string>; topConnectKeys?: ReadonlySet<string> } = {},
): Json {
  const src = asObject(stored);
  const next: Json = {};
  for (const [k, v] of Object.entries(submitted)) if (!isReservedMetadataKey(k)) next[k] = v;
  for (const k of opts.keepKeys ?? []) {
    if (k in src && !(k in next)) next[k] = src[k];
  }
  if (LISTS_NS in src) next[LISTS_NS] = src[LISTS_NS];
  const marker = new Set(readConnectMarker(src).filter((k) => k in next));
  for (const k of opts.topConnectKeys ?? []) if (k in next) marker.add(k);
  writeMarker(next, marker);
  return next;
}

/**
 * The metadata of a task whose HOME moves from List A to List B.
 *
 * When the task was LINKED into B, B's namespaced values are the ones B has
 * been showing, so they become the top level, and A's own values (the keys A
 * defines) move into A's namespace instead of being overwritten: nothing is
 * lost, and linking the task back into A shows A's values again. When the
 * task was NOT in B, this is today's move exactly: the blob is unchanged.
 * Task-level keys never move.
 */
export function swapNamespacesOnMove(
  stored: unknown,
  args: { fromBoardId: string; toBoardId: string; fromKeys: Iterable<string> },
): Json {
  const src = asObject(stored);
  const lists: Record<string, Json> = { ...readNamespaces(src) };
  const incoming = lists[args.toBoardId];
  if (!incoming) return { ...src };
  delete lists[args.toBoardId];

  const next: Json = { ...src };
  const oldMarker = new Set(readConnectMarker(src));
  const outgoing: Json = {};
  const outgoingMarker = new Set<string>();
  for (const k of new Set(args.fromKeys)) {
    if (isReservedMetadataKey(k) || TASK_LEVEL.has(k) || !(k in next)) continue;
    outgoing[k] = next[k];
    delete next[k];
    if (oldMarker.has(k)) {
      outgoingMarker.add(k);
      oldMarker.delete(k);
    }
  }
  const incomingMarker = readConnectMarker(incoming);
  for (const [k, v] of Object.entries(incoming)) {
    if (isReservedMetadataKey(k)) continue;
    next[k] = v;
  }
  // A key the old marker named that is still at the top level keeps its
  // marker, so a projection keeps reducing it rather than sending raw ids.
  writeMarker(next, [...incomingMarker, ...[...oldMarker].filter((k) => k in next)]);

  if (Object.keys(outgoing).length > 0) {
    const prior = lists[args.fromBoardId] ?? {};
    const merged: Json = { ...prior, ...outgoing };
    writeMarker(merged, [...readConnectMarker(prior), ...outgoingMarker]);
    lists[args.fromBoardId] = merged;
  }
  if (Object.keys(lists).length > 0) next[LISTS_NS] = lists;
  else delete next[LISTS_NS];
  return next;
}

/**
 * The blob a NEW task stores, from what its creator handed createBoardItem.
 *
 * TRUSTED (a server-side copy of a stored task, whose "$" keys were written
 * by this code: a duplicate, a recurring occurrence): verbatim.
 *
 * Anything else loses every "$" key, so no caller can plant another List's
 * namespace, EXCEPT the connect marker, which is kept for the keys the blob
 * still holds. A marker can only ever make a projection reduce a value to
 * the ids its viewer can read, or drop it, never show more, so carrying it
 * can widen nothing. Dropping it is what let a template or any other copy
 * that carried connect ids store them unmarked: once their field was
 * deleted, no projection recognised them as ids any more and they went out
 * raw, naming tasks the viewer cannot read. `validatedConnectKeys` (the
 * keys a route just validated) are marked too.
 */
export function metadataForCreate(
  input: unknown,
  opts: { trusted?: boolean; validatedConnectKeys?: readonly string[] } = {},
): Json {
  const src = asObject(input);
  const out: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (opts.trusted || !isReservedMetadataKey(k)) out[k] = v;
  }
  const carried = opts.trusted ? readConnectMarker(out) : readConnectMarker(src).filter((k) => k in out);
  const marker = new Set([...carried, ...(opts.validatedConnectKeys ?? []).filter((k) => k in out)]);
  if (marker.size) out[CONNECT_KEYS_META] = [...marker].filter((k) => !isReservedMetadataKey(k)).sort();
  else if (!opts.trusted) delete out[CONNECT_KEYS_META];
  return out;
}

/** Keep only the namespaces of these Lists (a duplicate keeps those it is linked into). */
export function keepNamespacesFor(stored: unknown, boardIds: Iterable<string>): Json {
  const src = asObject(stored);
  const next: Json = { ...src };
  const keep = new Set(boardIds);
  const lists = readNamespaces(src);
  const kept: Record<string, Json> = {};
  for (const [id, ns] of Object.entries(lists)) if (keep.has(id)) kept[id] = ns;
  if (Object.keys(kept).length > 0) next[LISTS_NS] = kept;
  else delete next[LISTS_NS];
  return next;
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

/** Top-level keys whose value moved, minus the reserved ones. */
export function changedTopLevelKeys(before: unknown, after: unknown): string[] {
  const a = asObject(before);
  const b = asObject(after);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !isReservedMetadataKey(k) && !sameJson(a[k], b[k])).sort();
}

/** Per List, the namespaced keys whose value moved. */
export function changedListFieldKeys(before: unknown, after: unknown): Record<string, string[]> {
  const a = readNamespaces(before);
  const b = readNamespaces(after);
  const out: Record<string, string[]> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const changed = changedTopLevelKeys(a[id] ?? {}, b[id] ?? {});
    if (changed.length) out[id] = changed;
  }
  return out;
}

/**
 * The activity rows a LINKED-only reader receives.
 *
 * A home field's key is a slug of its label, so listing it would name the
 * home List's fields to someone who cannot read that List. FIELDS_UPDATED
 * keeps only task-level keys and the reader's own List's entry; a MOVED row
 * keeps its statuses and loses both List ids.
 */
export function redactActivityForLinkedReader<T extends { action: string; meta: Json }>(rows: readonly T[], listId: string): T[] {
  return rows.map((r) => {
    if (r.action === "FIELDS_UPDATED") {
      const fields = Array.isArray(r.meta.fields)
        ? r.meta.fields.filter((k): k is string => typeof k === "string" && TASK_LEVEL.has(k))
        : [];
      const lf = asObject(r.meta.listFields);
      const own = Array.isArray(lf[listId]) ? { [listId]: lf[listId] } : {};
      return { ...r, meta: { ...r.meta, fields, listFields: own } };
    }
    if (r.action === "MOVED") {
      return { ...r, meta: { ...r.meta, fromBoardId: null, toBoardId: null } };
    }
    return r;
  });
}

/** Every List id a set of activity rows names under meta.listFields. */
export function activityListFieldIds(rows: ReadonlyArray<{ action: string; meta: Json }>): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.action !== "FIELDS_UPDATED") continue;
    for (const id of Object.keys(asObject(r.meta?.listFields))) ids.add(id);
  }
  return [...ids];
}

/**
 * The activity rows ANY reader receives: meta.listFields keeps only the Lists
 * that reader can read. That map is keyed by List id and lists the field
 * keys changed there (slugs of their labels), so an entry for a List the
 * reader cannot see would tell them the task is shared into it, which List,
 * and what its columns are called. GET /api/items/[id]/lists already leaves
 * such a List out; the activity log now agrees with it. An empty map is
 * dropped, so a row reads exactly as it did before Phase 5b.
 */
export function keepReadableListFields<T extends { action: string; meta: Json }>(rows: readonly T[], readable: ReadonlySet<string>): T[] {
  return rows.map((r) => {
    if (r.action !== "FIELDS_UPDATED" || !r.meta || !("listFields" in r.meta)) return r;
    const lf = asObject(r.meta.listFields);
    const kept: Json = {};
    for (const [id, keys] of Object.entries(lf)) if (readable.has(id)) kept[id] = keys;
    const meta: Json = { ...r.meta };
    if (Object.keys(kept).length > 0) meta.listFields = kept;
    else delete meta.listFields;
    return { ...r, meta };
  });
}
