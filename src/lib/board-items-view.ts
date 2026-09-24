// A task row as ONE viewer may see it, in ONE List.
//
// Every row an item read route answers passes through `viewRows`:
//   * "$lists" and "$connectKeys" are never sent (list-metadata.ts);
//   * a connect value is reduced to the tasks the viewer can read, and a List
//     with connect columns also gets `connections[key]`, the readable tasks
//     themselves; a List with mirror columns gets `mirrors[key]`, computed now
//     from those readable tasks only;
//   * a row shown in a List THROUGH A LINK is projected for that List (its
//     own namespace, never a home-only value to someone who cannot read the
//     home), and carries `listLink` so a client can show the home status
//     indicator and order it by its link position.
// With no viewer (a server page's first paint) the row is stripped of every
// reserved key and every connect value, which is safe for anyone and loses
// nothing that existed before Phase 5b.
//
// Server-only: prisma.

import { prisma } from "@/lib/prisma";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { getBoardStatuses, isDoneStatus, makeStatusLookup, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import {
  buildConnections,
  computeMirror,
  connectTargets,
  fieldKeySets,
  mirrorOptionsOf,
  redactFieldForViewer,
  type ConnectionRef,
  type MirrorOptions,
} from "@/lib/list-connect";
import { connectIdsOf, projectRowMetadata, readNamespace, stripForUnknownViewer, type ProjectionContext } from "@/lib/list-metadata";
import { listLinksAvailable, listReader, readableItemsVia, withListLinks, type LinkViewer, type ListReader } from "@/lib/list-links-server";

export interface LinkedRowInfo {
  rootId: string;
  /** The link's position for a linked ROOT; null for a subtask shown through it. */
  position: number | null;
}

export interface ViewContextBoard {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
  schema: unknown;
}

interface BoardFacts {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
  statuses: StatusOption[];
  fields: FieldDef[];
}

function keysOf(fields: readonly FieldDef[]) {
  const k = fieldKeySets(fields);
  const mirrors: Array<{ key: string; options: MirrorOptions }> = [];
  for (const f of fields) {
    const m = mirrorOptionsOf(f);
    if (m) mirrors.push({ key: f.key, options: m });
  }
  return { ...k, mirrors };
}

function builtinValue(it: ConnectedItem, key: string, statusLabel: (it: ConnectedItem) => string | null): unknown {
  switch (key) {
    case "__builtin_status": return statusLabel(it);
    case "__builtin_priority": return it.priority;
    case "__builtin_due": return it.dueAt ? it.dueAt.toISOString() : null;
    case "__builtin_start": return it.startAt ? it.startAt.toISOString() : null;
    case "__builtin_owner": return it.ownerId;
    default: return undefined;
  }
}

interface ConnectedItem {
  id: string;
  boardId: string;
  organizationId: string;
  ownerId: string | null;
  assigneeIds: string[];
  parentItemId: string | null;
  itemType: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueAt: Date | null;
  startAt: Date | null;
  metadata: unknown;
}

/**
 * Project enriched rows for a viewer.
 *
 * `context` is the List the rows are shown in (null: each row's own home);
 * `linked` names the rows shown there through a link.
 */
export async function viewRows(
  rows: BoardItemRow[],
  opts: {
    viewer: LinkViewer | null;
    context: ViewContextBoard | null;
    linked?: ReadonlyMap<string, LinkedRowInfo>;
    reader?: ListReader;
  },
): Promise<BoardItemRow[]> {
  if (rows.length === 0) return rows;
  if (!opts.viewer) {
    return rows.map((r) => ({ ...r, metadata: stripForUnknownViewer(r.metadata) }));
  }
  const viewer = opts.viewer;
  const reader = opts.reader ?? listReader(viewer);
  const linked = opts.linked ?? new Map<string, LinkedRowInfo>();

  const boardIds = new Set<string>();
  for (const r of rows) if (r.boardId) boardIds.add(r.boardId);
  if (opts.context) boardIds.add(opts.context.id);
  const boards = await prisma.board.findMany({
    where: { id: { in: [...boardIds] } },
    select: { id: true, slug: true, name: true, spaceId: true, statuses: true, schema: true },
  });
  const facts = new Map<string, BoardFacts>(
    boards.map((b) => [b.id, { id: b.id, slug: b.slug, name: b.name, spaceId: b.spaceId, statuses: getBoardStatuses(b), fields: parseBoardSchema(b.schema).fields }]),
  );
  if (opts.context && !facts.has(opts.context.id)) {
    facts.set(opts.context.id, { id: opts.context.id, slug: opts.context.slug, name: opts.context.name, spaceId: opts.context.spaceId, statuses: getBoardStatuses(null), fields: parseBoardSchema(opts.context.schema).fields });
  }

  // Which projection each row gets.
  type Plan = { row: BoardItemRow; linked: LinkedRowInfo | null; ctxBoard: BoardFacts | null; homeReadable: boolean; keys: ReturnType<typeof keysOf> };
  const plans: Plan[] = [];
  for (const row of rows) {
    const li = opts.context ? linked.get(row.id) ?? null : null;
    const ctxBoard = li && opts.context ? facts.get(opts.context.id) ?? null : row.boardId ? facts.get(row.boardId) ?? null : null;
    const homeReadable = li && row.boardId ? await reader.canRead(row.boardId) : true;
    plans.push({ row, linked: li, ctxBoard, homeReadable, keys: keysOf(ctxBoard?.fields ?? []) });
  }

  // Every connected id any row names, read once, then checked once.
  const connectIds = new Set<string>();
  for (const p of plans) {
    if (p.keys.connect.size === 0) continue;
    const source = p.linked && opts.context ? readNamespace(p.row.metadata, opts.context.id) : p.row.metadata;
    for (const key of p.keys.connect) for (const id of connectIdsOf(source[key])) connectIds.add(id);
  }
  const itemsById = new Map<string, ConnectedItem>();
  let readable = new Set<string>();
  // How each connected task was readable. "linked-list" means ONLY through a
  // List it is shared into: its home List is not the viewer's to read.
  const viaById = new Map<string, string | null>();
  const connectedHomeStatuses = new Map<string, StatusOption[]>();
  const mirrorLinks = new Map<string, Set<string>>();
  // The mirror target Lists THIS viewer can read, for this request only.
  const readableMirrorTargets = new Set<string>();
  if (connectIds.size > 0) {
    const items = await prisma.item.findMany({
      where: { id: { in: [...connectIds] }, organizationId: viewer.organizationId },
      select: { id: true, boardId: true, organizationId: true, ownerId: true, assigneeIds: true, parentItemId: true, itemType: true, title: true, status: true, priority: true, dueAt: true, startAt: true, metadata: true },
    });
    for (const it of items) itemsById.set(it.id, it);
    const access = await readableItemsVia(viewer, items, reader);
    readable = new Set([...access.entries()].filter(([, v]) => v.readable).map(([id]) => id));
    for (const [id, v] of access) viaById.set(id, v.via);
    const homeIds = Array.from(new Set(items.map((i) => i.boardId)));
    const homes = homeIds.length ? await prisma.board.findMany({ where: { id: { in: homeIds } }, select: { id: true, statuses: true } }) : [];
    for (const h of homes) connectedHomeStatuses.set(h.id, getBoardStatuses(h));
    const mirrorTargets = new Set<string>();
    for (const p of plans) for (const m of p.keys.mirrors) for (const t of Object.keys(m.options.lookupFieldKeys)) mirrorTargets.add(t);
    for (const t of mirrorTargets) if (await reader.row(t)) readableMirrorTargets.add(t);
    if (mirrorTargets.size && (await listLinksAvailable())) {
      const links = await withListLinks(
        () => prisma.itemListLink.findMany({ where: { itemId: { in: [...readable] }, boardId: { in: [...mirrorTargets] } }, select: { itemId: true, boardId: true } }),
        [] as Array<{ itemId: string; boardId: string }>,
      );
      for (const l of links) {
        const set = mirrorLinks.get(l.itemId) ?? new Set<string>();
        set.add(l.boardId);
        mirrorLinks.set(l.itemId, set);
      }
    }
  }
  const statusLabel = (it: ConnectedItem): string | null => {
    if (!it.status) return null;
    return makeStatusLookup(connectedHomeStatuses.get(it.boardId) ?? getBoardStatuses(null))[it.status]?.label ?? it.status;
  };
  const info = new Map<string, ConnectionRef>();
  for (const id of readable) {
    const it = itemsById.get(id);
    if (!it) continue;
    const statuses = connectedHomeStatuses.get(it.boardId) ?? getBoardStatuses(null);
    info.set(id, {
      id,
      title: it.title,
      statusLabel: statusLabel(it),
      statusColor: it.status ? makeStatusLookup(statuses)[it.status]?.color ?? null : null,
      done: isDoneStatus(statuses, it.status),
    });
  }

  const out: BoardItemRow[] = [];
  for (const p of plans) {
    const ctx: ProjectionContext = p.linked && opts.context
      ? { kind: "linked", listId: opts.context.id, homeReadable: p.homeReadable, contextStoredKeys: p.keys.stored, contextConnectKeys: p.keys.connect, readable }
      : { kind: "home", contextStoredKeys: p.keys.stored, contextConnectKeys: p.keys.connect, readable };
    const { metadata, connected } = projectRowMetadata(p.row.metadata, ctx);
    const next: BoardItemRow = { ...p.row, metadata };
    if (p.keys.connect.size > 0) {
      const connections: NonNullable<BoardItemRow["connections"]> = {};
      for (const key of p.keys.connect) connections[key] = buildConnections(connected[key] ?? [], info);
      next.connections = connections;
    }
    if (p.keys.mirrors.length > 0) {
      const mirrors: NonNullable<BoardItemRow["mirrors"]> = {};
      for (const m of p.keys.mirrors) {
        const ids = connected[m.options.linkFieldKey] ?? [];
        mirrors[m.key] = computeMirror(ids, m.options, (itemId) => {
          const it = itemsById.get(itemId);
          if (!it || !readable.has(itemId)) return null;
          const targets = Object.keys(m.options.lookupFieldKeys);
          const read = (source: Record<string, unknown>) => (key: string) => {
            const b = builtinValue(it, key, statusLabel);
            return b !== undefined ? b : source[key] ?? null;
          };
          // The task's HOME values only when the viewer may read them: the
          // home List is readable to them, or they hold the task itself (org
          // admin, owner, assignee, creator), exactly who is shown those
          // values on the task page. A task readable only through a List it
          // is shared into lends its home values to nobody who cannot read
          // that home; projectRowMetadata holds them back the same way.
          const homeValuesReadable = readableMirrorTargets.has(it.boardId) || (viaById.get(itemId) ?? null) !== "linked-list";
          if (targets.includes(it.boardId) && homeValuesReadable) return { listId: it.boardId, read: read((it.metadata ?? {}) as Record<string, unknown>) };
          // Through a link only when the viewer can read that List: its values
          // are part of that List, not of the task.
          for (const t of targets) {
            if (mirrorLinks.get(itemId)?.has(t) && readableMirrorTargets.has(t)) return { listId: t, read: read(readNamespace(it.metadata, t)) };
          }
          return null;
        });
      }
      next.mirrors = mirrors;
    }
    if (p.linked && opts.context) {
      const home = p.row.boardId ? facts.get(p.row.boardId) ?? null : null;
      const homeStatus = p.row.status && home ? makeStatusLookup(home.statuses)[p.row.status] ?? { value: p.row.status, label: p.row.status, color: "#98A2B3", group: "ACTIVE" as const } : null;
      next.spaceId = opts.context.spaceId;
      // The home List's id is part of what a linked-only reader is never
      // told: their row belongs to the List they are reading.
      if (!p.homeReadable) next.boardId = opts.context.id;
      if (p.linked.position !== null) {
        next.position = p.linked.position;
        next.groupKey = null;
      }
      next.listLink = {
        boardId: opts.context.id,
        position: p.linked.position,
        rootId: p.linked.rootId,
        ...(p.linked.position !== null
          ? {
              homeList: p.homeReadable && home ? { id: home.id, slug: home.slug, name: home.name } : null,
              homeStatus,
              ...(p.homeReadable && home ? { homeStatuses: home.statuses } : {}),
            }
          : {}),
      };
    }
    out.push(next);
  }
  return out;
}

/**
 * One task's metadata, connections and mirrors as one viewer may see them,
 * without the row enrichment (the task page reads counts elsewhere).
 */
export async function projectItemForViewer(
  item: {
    id: string;
    boardId: string;
    title: string;
    status: string | null;
    ownerId: string | null;
    assigneeIds: string[];
    groupKey: string | null;
    position: number;
    metadata: unknown;
    parentItemId: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  opts: { viewer: LinkViewer; context: ViewContextBoard | null; linked?: LinkedRowInfo | null; reader?: ListReader },
): Promise<Pick<BoardItemRow, "metadata" | "connections" | "mirrors" | "listLink" | "position" | "groupKey" | "boardId">> {
  const row: BoardItemRow = {
    id: item.id,
    boardId: item.boardId,
    title: item.title,
    status: item.status,
    ownerId: item.ownerId,
    assigneeIds: item.assigneeIds,
    groupKey: item.groupKey,
    position: item.position,
    metadata: (item.metadata ?? {}) as Record<string, unknown>,
    parentItemId: item.parentItemId,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  const linked = opts.linked ? new Map([[item.id, opts.linked]]) : undefined;
  const [v] = await viewRows([row], { viewer: opts.viewer, context: opts.context, linked, reader: opts.reader });
  return {
    metadata: v.metadata,
    ...(v.connections ? { connections: v.connections } : {}),
    ...(v.mirrors ? { mirrors: v.mirrors } : {}),
    ...(v.listLink ? { listLink: v.listLink } : {}),
    position: v.position,
    groupKey: v.groupKey,
    boardId: v.boardId,
  };
}

/**
 * A List's fields as one viewer may see them: a connect field names only the
 * target Lists they can read, a mirror only its lookups into them.
 */
export async function redactFieldsForViewer(fields: readonly FieldDef[], reader: ListReader): Promise<FieldDef[]> {
  const referenced = new Set<string>();
  for (const f of fields) {
    for (const t of connectTargets(f)) referenced.add(t);
    const m = mirrorOptionsOf(f);
    if (m) for (const t of Object.keys(m.lookupFieldKeys)) referenced.add(t);
  }
  const readableLists = new Set<string>();
  for (const t of referenced) if (await reader.canRead(t)) readableLists.add(t);
  return fields.map((f) => redactFieldForViewer(f, readableLists));
}
