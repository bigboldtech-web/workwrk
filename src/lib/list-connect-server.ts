// Connect columns: the server half. Which tasks a writer may connect, and the
// value a connect write stores.
//
// A connect value may name a task only when it is LIVE, is in one of the
// field's target Lists (its home, or a List it is linked into) that the WRITER
// can read, and the writer can read the task itself. That is decided here,
// once, for the create route, the update route and the candidates picker, so
// a picker can never offer a task a save would refuse.
//
// Server-only: prisma.

import { prisma } from "@/lib/prisma";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { NOT_SYSTEM_ITEMS } from "@/lib/system-items";
import { connectTargets, isConnectField, mergeConnectValue, validateConnectWrite } from "@/lib/list-connect";
import { connectIdsOf } from "@/lib/list-metadata";
import {
  isLinkTarget,
  listReader,
  readableItemsVia,
  topLevelAncestor,
  withListLinks,
  type LinkViewer,
  type ListReader,
} from "@/lib/list-links-server";

/** The target Lists of a connect field that this viewer can read and that are live. */
export async function readableTargets(field: Pick<FieldDef, "type" | "options">, reader: ListReader): Promise<string[]> {
  const out: string[] = [];
  for (const id of connectTargets(field as FieldDef)) if (await reader.row(id)) out.push(id);
  return out;
}

/**
 * Of these ids, the ones this writer may connect through a field targeting
 * `targets` (already reduced to the readable ones): live, not a system item,
 * in a target List (home or linked) and readable by the writer.
 */
export async function resolveConnectIds(
  viewer: LinkViewer,
  targets: readonly string[],
  ids: readonly string[],
  reader: ListReader = listReader(viewer),
): Promise<Set<string>> {
  const wanted = Array.from(new Set(ids));
  if (targets.length === 0 || wanted.length === 0) return new Set();
  const items = await prisma.item.findMany({
    where: { id: { in: wanted }, organizationId: viewer.organizationId, archivedAt: null, ...NOT_SYSTEM_ITEMS },
    select: { id: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true },
  });
  const targetSet = new Set(targets);
  const inScope = new Set<string>();
  const viaLink: typeof items = [];
  for (const it of items) {
    if (targetSet.has(it.boardId)) inScope.add(it.id);
    else viaLink.push(it);
  }
  if (viaLink.length) {
    const rootOf = new Map<string, string>();
    for (const it of viaLink) rootOf.set(it.id, it.parentItemId ? (await topLevelAncestor(it)).id : it.id);
    const links = await withListLinks(
      () => prisma.itemListLink.findMany({ where: { itemId: { in: Array.from(new Set(rootOf.values())) }, boardId: { in: [...targetSet] } }, select: { itemId: true } }),
      [] as Array<{ itemId: string }>,
    );
    const linkedRoots = new Set(links.map((l) => l.itemId));
    for (const it of viaLink) if (linkedRoots.has(rootOf.get(it.id) ?? it.id)) inScope.add(it.id);
  }
  const candidates = items.filter((i) => inScope.has(i.id));
  const access = await readableItemsVia(viewer, candidates, reader);
  return new Set(candidates.filter((i) => access.get(i.id)?.readable).map((i) => i.id));
}

/** Of stored connected ids, which the writer can read and which still exist. */
export async function connectReadability(
  viewer: LinkViewer,
  ids: readonly string[],
  reader: ListReader = listReader(viewer),
): Promise<{ readable: Set<string>; live: Set<string> }> {
  const wanted = Array.from(new Set(ids));
  if (wanted.length === 0) return { readable: new Set(), live: new Set() };
  const items = await prisma.item.findMany({
    where: { id: { in: wanted } },
    select: { id: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true },
  });
  const live = new Set(items.map((i) => i.id));
  const access = await readableItemsVia(viewer, items, reader);
  return { readable: new Set(items.filter((i) => access.get(i.id)?.readable).map((i) => i.id)), live };
}

export type ConnectWriteResult =
  | { ok: true; values: Record<string, string[]>; keys: string[] }
  | { ok: false; error: "invalid_connection" | "too_many_connections"; key: string };

/**
 * Validate every connect key a write carries and compute what to store.
 *
 * `stored` is the value already on the task in the same context (absent on a
 * create). A NEW id must be resolvable for the writer; ids already stored are
 * merged by mergeConnectValue, so connections the writer cannot see survive
 * and the cap counts live tasks only.
 */
export async function validateConnectWrites(
  viewer: LinkViewer,
  fields: readonly FieldDef[],
  submitted: Record<string, unknown>,
  opts: { stored?: Record<string, unknown>; selfId?: string | null } = {},
): Promise<ConnectWriteResult> {
  const reader = listReader(viewer);
  const values: Record<string, string[]> = {};
  const keys: string[] = [];
  for (const f of fields) {
    if (!isConnectField(f) || !(f.key in submitted)) continue;
    const raw = submitted[f.key];
    const storedIds = opts.stored ? connectIdsOf(opts.stored[f.key]) : [];
    // A wrong shape needs no database to answer.
    if (raw !== null && (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !v.trim() || v.length > 64))) {
      return { ok: false, error: "invalid_connection", key: f.key };
    }
    const ids = raw === null ? [] : connectIdsOf(raw);
    const fresh = ids.filter((id) => !storedIds.includes(id));
    const targets = await readableTargets(f, reader);
    const resolvable = await resolveConnectIds(viewer, targets, fresh, reader);
    const checked = validateConnectWrite(raw, { resolvable, alreadyStored: opts.stored ? new Set(storedIds) : undefined, selfId: opts.selfId ?? null });
    if (!checked.ok) return { ok: false, error: checked.error, key: f.key };
    if (opts.stored) {
      const { readable, live } = await connectReadability(viewer, [...storedIds, ...checked.ids], reader);
      const merged = mergeConnectValue(storedIds, raw === null ? null : checked.ids, { readable, live });
      if (!merged.ok) return { ok: false, error: merged.error, key: f.key };
      values[f.key] = merged.ids;
    } else {
      values[f.key] = checked.ids;
    }
    keys.push(f.key);
  }
  return { ok: true, values, keys };
}

/**
 * The connect targets a caller may name on a field: every one a live task
 * List in this org, not system, not personal, and readable by the caller.
 * One answer for any failure, so the refusal names no List.
 */
export async function checkConnectTargets(thisBoardId: string, ids: readonly string[], reader: ListReader): Promise<boolean> {
  for (const id of ids) {
    if (id === thisBoardId) continue;
    const b = await reader.row(id);
    if (!b || !isLinkTarget(b)) return false;
  }
  return true;
}

/** The fields of each readable List, for a mirror's lookups. */
export async function targetFieldMap(ids: readonly string[], reader: ListReader): Promise<Map<string, FieldDef[]>> {
  const out = new Map<string, FieldDef[]>();
  for (const id of ids) {
    const b = await reader.row(id);
    if (b) out.set(id, parseBoardSchema(b.schema).fields);
  }
  return out;
}
