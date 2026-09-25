// Tasks in more than one List: the server half.
//
// Every reader of ItemListLink goes through this file, and every one of them
// degrades to TODAY'S home-only read while the table is absent: a deploy can
// land before prisma/sql/2026-09-24-phase5b-data.sql, and a List page that
// errors because a feature nobody has used yet is missing its table would be
// the "could not load" incident again. `listLinksAvailable` asks Postgres
// once (to_regclass) and asks again every five minutes while the answer is
// no; a query that meets the missing table anyway (42P01) degrades the same
// way. The write routes answer a named 503 instead (linksUnavailableResponse).
//
// The pure rules (where clauses, gates, positions, count merges) are
// src/lib/list-links.ts, and the value rules are src/lib/list-metadata.ts.
//
// Server-only: prisma.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { canContributeBoard, canEditBoard, getBoardForReader, getBoardForReaderOrFolderGrantee } from "@/lib/board";
import { canContributeSpace, canEditSpace, getSpaceForReader, isOrgAdminAccessLevel, visibleSpaceIds } from "@/lib/space";
import { orgRoleOf } from "@/lib/access/org-role";
import { namedRecipientFor } from "@/lib/reports/schedule";
import {
  buildListScopeWhere,
  decideAddLink,
  isMissingListLinkTableError,
  nextListPosition,
  LINK_POSITION_STEP,
  LIST_LINK_SCOPE_MAX,
  SUBTREE_DEPTH,
  type AddLinkRefusal,
} from "@/lib/list-links";

export const PHASE5B_SQL_FILE = "prisma/sql/2026-09-24-phase5b-data.sql";

export interface LinkViewer {
  userId: string;
  accessLevel: string;
  organizationId: string;
}

export interface LinkRow {
  itemId: string;
  boardId: string;
  position: number;
  addedById: string | null;
  createdAt: Date;
}

type Db = typeof prisma | Prisma.TransactionClient;

// ── Is the table there? ──────────────────────────────────────────────

const RECHECK_MS = 5 * 60 * 1000;
let availability: { value: boolean; at: number } | null = null;

/**
 * True once ItemListLink exists. A table that appeared is never re-checked.
 *
 * NEVER CALL THIS INSIDE A TRANSACTION. On a cold process (every pm2 restart,
 * every deploy) and again every five minutes while the table is absent it
 * runs a query on the GLOBAL pool. Called from inside prisma.$transaction it
 * needs a second connection while the transaction holds its first; ten such
 * transactions at once (the pool's size) each wait for a connection none of
 * them will release, every one times out, and every other request in the
 * process starves with them. Ask before the transaction opens and pass the
 * answer in (nextPositionInList takes it as an argument for exactly this).
 */
export async function listLinksAvailable(): Promise<boolean> {
  if (availability?.value) return true;
  if (availability && Date.now() - availability.at < RECHECK_MS) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"ItemListLink"')::text AS t`;
    availability = { value: !!rows[0]?.t, at: Date.now() };
  } catch {
    availability = { value: false, at: Date.now() };
  }
  return availability.value;
}

/** A query just met the missing table: stop asking for five minutes. */
export function markListLinksMissing(): void {
  availability = { value: false, at: Date.now() };
}

/** Test hook: forget what was learnt about the table. */
export function resetListLinksAvailability(): void {
  availability = null;
}

/**
 * Run a link read, or answer `fallback` (today's behaviour) when the table is
 * absent. Any other failure still throws.
 */
export async function withListLinks<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!(await listLinksAvailable())) return fallback;
  try {
    return await fn();
  } catch (err) {
    if (isMissingListLinkTableError(err)) {
      markListLinksMissing();
      return fallback;
    }
    throw err;
  }
}

/** The one 503 every link write answers while the table is absent. */
export function linksUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: "needs_database_update", file: PHASE5B_SQL_FILE }, { status: 503 });
}

// ── Order and positions ─────────────────────────────────────────────

/**
 * The List's order lock, held for the rest of the transaction. Every append
 * to a List (a new task, a new link) takes it, so two appends can never read
 * the same maximum and land on the same position.
 *
 * pg_advisory_xact_lock returns void, which the query path cannot
 * deserialise, so it runs through $executeRaw.
 */
export async function listOrderLock(tx: Prisma.TransactionClient, boardId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`list-order:${boardId}`}))`;
}

/**
 * The position at the end of a List that holds its own tasks and linked ones.
 *
 * `linksOn` is listLinksAvailable(), answered by the caller BEFORE its
 * transaction opened: this runs inside one, and only `db` may be queried
 * here (see listLinksAvailable for the pool deadlock the other way caused).
 */
export async function nextPositionInList(db: Db, boardId: string, linksOn: boolean): Promise<number> {
  const home = await db.item.aggregate({ where: { boardId, parentItemId: null }, _max: { position: true } });
  let maxLink: number | null = null;
  if (linksOn) {
    const links = await db.itemListLink.aggregate({ where: { boardId }, _max: { position: true } });
    maxLink = links._max.position ?? null;
  }
  return nextListPosition(home._max.position ?? null, maxLink);
}

// ── A task's own links ──────────────────────────────────────────────

/**
 * The task whose links a task inherits: itself when top level, else its
 * top-level ancestor on the SAME home List (a subtask appears wherever its
 * parent does). Bounded like every other subtask walk.
 */
export async function topLevelAncestor(
  item: { id: string; boardId: string; parentItemId: string | null },
  db: Db = prisma,
): Promise<{ id: string; boardId: string; topLevel: boolean }> {
  let cur = item;
  for (let i = 0; i < SUBTREE_DEPTH && cur.parentItemId; i += 1) {
    const parent = await db.item.findUnique({
      where: { id: cur.parentItemId },
      select: { id: true, boardId: true, parentItemId: true },
    });
    if (!parent || parent.boardId !== item.boardId) break;
    cur = parent;
  }
  return { id: cur.id, boardId: cur.boardId, topLevel: !cur.parentItemId };
}

/** One task's link rows, oldest first. Absent table: none. */
export async function linksOfItem(itemId: string, db: Db = prisma): Promise<LinkRow[]> {
  return withListLinks(
    () => db.itemListLink.findMany({ where: { itemId }, orderBy: [{ createdAt: "asc" }, { boardId: "asc" }] }),
    [] as LinkRow[],
  );
}

/**
 * The Lists a task appears in besides its home: its own links, or, for a
 * subtask, its top-level ancestor's. One indexed query past the ancestor walk.
 */
export async function linkedListsOf(
  item: { id: string; boardId: string; parentItemId: string | null },
): Promise<{ rootId: string; links: LinkRow[] }> {
  const root = item.parentItemId ? await topLevelAncestor(item) : { id: item.id, boardId: item.boardId, topLevel: true };
  if (!root.topLevel) return { rootId: root.id, links: [] };
  const links = await linksOfItem(root.id);
  // A stale row naming the home is not a secondary List.
  return { rootId: root.id, links: links.filter((l) => l.boardId !== item.boardId) };
}

// ── Readable Lists ──────────────────────────────────────────────────

export interface ReadableList {
  id: string;
  slug: string;
  name: string;
  spaceId: string | null;
  folderId: string | null;
  itemType: string;
  productSlug: string | null;
  archivedAt: Date | null;
  settings: unknown;
  statuses: unknown;
  schema: unknown;
  visibility: string;
  ownerId: string | null;
  organizationId: string;
}

const LIST_SELECT = {
  id: true, slug: true, name: true, spaceId: true, folderId: true, itemType: true, productSlug: true,
  archivedAt: true, settings: true, statuses: true, schema: true, visibility: true, ownerId: true, organizationId: true,
} as const;

/**
 * A memoised "can this viewer read this List" for one request, answered by
 * getBoardForReader (the one read predicate) plus the org and archive checks
 * a multi-List surface also needs. `row` answers the List itself when it is
 * readable and live, else null.
 */
export function listReader(viewer: LinkViewer) {
  const readable = new Map<string, Promise<boolean>>();
  const rows = new Map<string, Promise<ReadableList | null>>();
  const canRead = (boardId: string): Promise<boolean> => {
    let p = readable.get(boardId);
    if (!p) {
      p = (isOrgAdminAccessLevel(viewer.accessLevel)
        ? prisma.board.findFirst({ where: { id: boardId, organizationId: viewer.organizationId }, select: { id: true } }).then(Boolean)
        : getBoardForReader(boardId, viewer.userId, viewer.accessLevel).then((b) => !!b && b.organizationId === viewer.organizationId)
      ).catch(() => false);
      readable.set(boardId, p);
    }
    return p;
  };
  const row = (boardId: string): Promise<ReadableList | null> => {
    let p = rows.get(boardId);
    if (!p) {
      p = (async () => {
        if (!(await canRead(boardId))) return null;
        const b = await prisma.board.findFirst({ where: { id: boardId, organizationId: viewer.organizationId }, select: LIST_SELECT });
        return b && !b.archivedAt ? (b as ReadableList) : null;
      })().catch(() => null);
      rows.set(boardId, p);
    }
    return p;
  };
  return { canRead, row };
}

export type ListReader = ReturnType<typeof listReader>;

/** Is this List a place a task can be linked into? */
export function isLinkTarget(b: Pick<ReadableList, "itemType" | "productSlug" | "settings" | "archivedAt">): boolean {
  const system = !!b.settings && typeof b.settings === "object" && (b.settings as Record<string, unknown>).system === true;
  return !b.archivedAt && b.itemType === "studio-item" && !system && b.productSlug !== "personal-list";
}

// ── Readable tasks ──────────────────────────────────────────────────

export interface ItemAccessInput {
  id: string;
  boardId: string;
  organizationId: string;
  ownerId: string | null;
  assigneeIds: string[];
  parentItemId: string | null;
  itemType?: string;
}

export type ItemVia = "org-admin" | "list" | "assignee" | "creator" | "linked-list";

/**
 * Which of these tasks the viewer can read, and why: the same ladder as
 * gateItem (org admin, the home List, an assignee, the creator) plus the one
 * rule this phase adds, a List the task (or its top-level ancestor on the
 * same home) is linked into, whose home List is not archived. Anything in
 * another org is unreadable.
 */
export async function readableItemsVia(
  viewer: LinkViewer,
  items: readonly ItemAccessInput[],
  reader: ListReader = listReader(viewer),
): Promise<Map<string, { readable: boolean; via: ItemVia | null; linkedListId?: string }>> {
  const out = new Map<string, { readable: boolean; via: ItemVia | null; linkedListId?: string }>();
  const pending: ItemAccessInput[] = [];
  const admin = isOrgAdminAccessLevel(viewer.accessLevel);
  for (const it of items) {
    if (it.organizationId !== viewer.organizationId) {
      out.set(it.id, { readable: false, via: null });
      continue;
    }
    if (admin) {
      out.set(it.id, { readable: true, via: "org-admin" });
      continue;
    }
    if (it.ownerId === viewer.userId || it.assigneeIds.includes(viewer.userId)) {
      out.set(it.id, { readable: true, via: "assignee" });
      continue;
    }
    pending.push(it);
  }
  const stillPending: ItemAccessInput[] = [];
  await Promise.all(
    pending.map(async (it) => {
      if (await reader.canRead(it.boardId)) out.set(it.id, { readable: true, via: "list" });
      else stillPending.push(it);
    }),
  );
  if (stillPending.length === 0) return out;

  const created = await prisma.itemActivity
    .findMany({
      where: { organizationId: viewer.organizationId, entityType: "BOARD_ITEM", entityId: { in: stillPending.map((i) => i.id) }, action: "CREATED", actorId: viewer.userId },
      select: { entityId: true },
    })
    .catch(() => [] as Array<{ entityId: string }>);
  const mine = new Set(created.map((c) => c.entityId));
  const viaLinks: ItemAccessInput[] = [];
  for (const it of stillPending) {
    if (mine.has(it.id)) out.set(it.id, { readable: true, via: "creator" });
    else viaLinks.push(it);
  }
  if (viaLinks.length === 0 || !(await listLinksAvailable())) {
    for (const it of viaLinks) out.set(it.id, { readable: false, via: null });
    return out;
  }

  // The linked-list rule. Roots first (a subtask inherits its parent's links).
  const rootOf = new Map<string, string>();
  await Promise.all(viaLinks.map(async (it) => rootOf.set(it.id, (await topLevelAncestor(it)).id)));
  const rootIds = Array.from(new Set(rootOf.values()));
  const [links, homes] = await Promise.all([
    withListLinks(
      () => prisma.itemListLink.findMany({ where: { itemId: { in: rootIds } }, orderBy: [{ createdAt: "asc" }, { boardId: "asc" }] }),
      [] as LinkRow[],
    ),
    prisma.board.findMany({ where: { id: { in: Array.from(new Set(viaLinks.map((i) => i.boardId))) } }, select: { id: true, archivedAt: true } }),
  ]);
  const homeArchived = new Map(homes.map((h) => [h.id, !!h.archivedAt] as const));
  const linksByRoot = new Map<string, LinkRow[]>();
  for (const l of links) {
    const list = linksByRoot.get(l.itemId) ?? [];
    list.push(l);
    linksByRoot.set(l.itemId, list);
  }
  await Promise.all(
    viaLinks.map(async (it) => {
      if (homeArchived.get(it.boardId) !== false) {
        out.set(it.id, { readable: false, via: null });
        return;
      }
      for (const l of linksByRoot.get(rootOf.get(it.id) ?? it.id) ?? []) {
        if (l.boardId === it.boardId) continue;
        const b = await reader.row(l.boardId);
        if (b) {
          out.set(it.id, { readable: true, via: "linked-list", linkedListId: b.id });
          return;
        }
      }
      out.set(it.id, { readable: false, via: null });
    }),
  );
  return out;
}

// ── The union a List read makes ─────────────────────────────────────

export interface LinkedTreeRow {
  listId: string;
  itemId: string;
  rootId: string;
  homeBoardId: string;
  status: string | null;
  linkedAt: Date;
}

/**
 * Every task linked into these Lists, with its same-home subtask tree
 * (SUBTREE_DEPTH levels), live and with a live home List. One recursive
 * query, and the ONE definition of a linked tree. It feeds the multi-List
 * where clause (buildListScopeWhere) and the row labels (contextBoardFor);
 * counts use linkedTreeCountGroups, which has no ceiling.
 *
 * At most LIST_LINK_SCOPE_MAX rows (a List read carries each id as a bind
 * parameter, and Postgres has a limit). One more is asked for so that
 * reaching the ceiling is KNOWN: it is logged with the org, never silent.
 * The ids and the labels of a read are both built from these same rows, so a
 * cut hides a row from both and can never label one with nothing.
 */
export async function linkedTreeRows(
  boardIds: readonly string[],
  opts: { organizationId: string; limit?: number },
): Promise<LinkedTreeRow[]> {
  const ids = Array.from(new Set(boardIds));
  if (ids.length === 0) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? LIST_LINK_SCOPE_MAX, LIST_LINK_SCOPE_MAX));
  const rows = await withListLinks(
    () => prisma.$queryRaw<LinkedTreeRow[]>`
      WITH RECURSIVE tree AS (
        SELECT l."boardId" AS "listId", i.id AS "itemId", i.id AS "rootId", i."boardId" AS "homeBoardId",
               i.status AS status, l."createdAt" AS "linkedAt", 0 AS depth
        FROM "ItemListLink" l
        JOIN "Item" i ON i.id = l."itemId"
        JOIN "Board" hb ON hb.id = i."boardId"
        WHERE l."boardId" = ANY(${ids}::text[])
          AND l."boardId" <> i."boardId"
          AND i."organizationId" = ${opts.organizationId}
          AND i."parentItemId" IS NULL
          AND i."archivedAt" IS NULL
          AND hb."archivedAt" IS NULL
        UNION ALL
        SELECT t."listId", c.id, t."rootId", c."boardId", c.status, t."linkedAt", t.depth + 1
        FROM tree t
        JOIN "Item" c ON c."parentItemId" = t."itemId" AND c."boardId" = t."homeBoardId"
        WHERE t.depth < ${SUBTREE_DEPTH} AND c."archivedAt" IS NULL
      )
      SELECT DISTINCT ON ("listId", "itemId") "listId", "itemId", "rootId", "homeBoardId", status, "linkedAt"
      FROM tree
      ORDER BY "listId", "itemId", "linkedAt"
      LIMIT ${limit + 1}
    `,
    [] as LinkedTreeRow[],
  );
  if (rows.length > limit) {
    console.warn(`[list-links] linked tree for org ${opts.organizationId} over ${ids.length} List(s) reached the ${limit}-row ceiling; rows past it are not shown on this read`);
    return rows.slice(0, limit);
  }
  return rows;
}

export interface LinkedCountGroup {
  listId: string;
  homeBoardId: string;
  status: string | null;
  count: number;
}

/**
 * How many linked tasks (the same trees as linkedTreeRows) each List holds,
 * grouped by home List and status, so a count can be split open and done by
 * the HOME status set. Grouped in Postgres, so it is exact at any size: the
 * Folder and Space pages count with this, never with a capped row list.
 */
export async function linkedTreeCountGroups(
  boardIds: readonly string[],
  opts: { organizationId: string },
): Promise<LinkedCountGroup[]> {
  const ids = Array.from(new Set(boardIds));
  if (ids.length === 0) return [];
  const rows = await withListLinks(
    () => prisma.$queryRaw<Array<{ listId: string; homeBoardId: string; status: string | null; count: bigint | number }>>`
      WITH RECURSIVE tree AS (
        SELECT l."boardId" AS "listId", i.id AS "itemId", i."boardId" AS "homeBoardId", i.status AS status, 0 AS depth
        FROM "ItemListLink" l
        JOIN "Item" i ON i.id = l."itemId"
        JOIN "Board" hb ON hb.id = i."boardId"
        WHERE l."boardId" = ANY(${ids}::text[])
          AND l."boardId" <> i."boardId"
          AND i."organizationId" = ${opts.organizationId}
          AND i."parentItemId" IS NULL
          AND i."archivedAt" IS NULL
          AND hb."archivedAt" IS NULL
        UNION ALL
        SELECT t."listId", c.id, c."boardId", c.status, t.depth + 1
        FROM tree t
        JOIN "Item" c ON c."parentItemId" = t."itemId" AND c."boardId" = t."homeBoardId"
        WHERE t.depth < ${SUBTREE_DEPTH} AND c."archivedAt" IS NULL
      ),
      one AS (
        SELECT DISTINCT ON ("listId", "itemId") "listId", "itemId", "homeBoardId", status
        FROM tree
        ORDER BY "listId", "itemId"
      )
      SELECT "listId", "homeBoardId", status, COUNT(*) AS count
      FROM one
      GROUP BY "listId", "homeBoardId", status
    `,
    [] as Array<{ listId: string; homeBoardId: string; status: string | null; count: bigint | number }>,
  );
  return rows.map((r) => ({ listId: r.listId, homeBoardId: r.homeBoardId, status: r.status, count: Number(r.count) }));
}

/** The linked ids for buildListScopeWhere, and each id's Lists, oldest link first. */
export async function linkedScope(
  boardIds: readonly string[],
  organizationId: string,
): Promise<{ linkedItemIds: string[] | null; listsByItem: Map<string, string[]> }> {
  const rows = await linkedTreeRows(boardIds, { organizationId });
  if (rows.length === 0) return { linkedItemIds: null, listsByItem: new Map() };
  const listsByItem = new Map<string, Array<{ listId: string; at: number }>>();
  for (const r of rows) {
    const list = listsByItem.get(r.itemId) ?? [];
    list.push({ listId: r.listId, at: new Date(r.linkedAt).getTime() });
    listsByItem.set(r.itemId, list);
  }
  const ordered = new Map<string, string[]>();
  for (const [id, list] of listsByItem) ordered.set(id, list.sort((a, b) => a.at - b.at || a.listId.localeCompare(b.listId)).map((x) => x.listId));
  return { linkedItemIds: [...listsByItem.keys()], listsByItem: ordered };
}

// ── Adding links ────────────────────────────────────────────────────

export type AddLinkResult =
  | { itemId: string; ok: true; created: boolean; position: number }
  | { itemId: string; ok: false; reason: AddLinkRefusal };

interface LockedItem {
  id: string;
  boardId: string;
  parentItemId: string | null;
  archivedAt: Date | null;
  itemType: string;
  organizationId: string;
}

/**
 * Add tasks to List `boardId`, all in ONE transaction.
 *
 * It takes the List's order lock, then locks every task row and re-runs
 * decideAddLink on the LOCKED values, so a move into this List that committed
 * first is seen here and a task can never end up both home in a List and
 * linked into it. The link count is read under the same locks, and the new
 * rows are appended after the List's current end, one step apart.
 *
 * EVERYTHING THE DECISION NEEDS FROM OUTSIDE IS ANSWERED BEFORE THE
 * TRANSACTION OPENS: `readable` (can the caller read the task) and
 * `contributeHome` (can they write its home), for the homes the tasks had
 * when the route read them. The access helpers query the GLOBAL pool, and
 * calling them in here held one connection while waiting for another: twelve
 * adds at once (the pool is ten) all hung for thirty seconds, every one
 * failed, and the whole process starved with them. Inside, only `tx` is
 * queried. A task whose home changed between the read and the lock is
 * refused as home_changed (the caller retries), never re-asked from in here.
 */
export async function addItemsToList(args: {
  viewer: LinkViewer;
  boardId: string;
  itemIds: readonly string[];
  readable: ReadonlyMap<string, boolean>;
  /** Home List id to "can the caller write it", for every pre-read home. */
  contributeHome: ReadonlyMap<string, boolean>;
  preReadHome: ReadonlyMap<string, string>;
}): Promise<AddLinkResult[]> {
  const ids = Array.from(new Set(args.itemIds));
  return prisma.$transaction(
    async (tx) => {
      await listOrderLock(tx, args.boardId);
      const target = await tx.board.findUnique({
        where: { id: args.boardId },
        select: { organizationId: true, archivedAt: true, itemType: true, productSlug: true, settings: true },
      });
      const locked = await tx.$queryRaw<LockedItem[]>`
        SELECT id, "boardId", "parentItemId", "archivedAt", "itemType", "organizationId"
        FROM "Item" WHERE id = ANY(${ids}::text[]) FOR UPDATE`;
      const byId = new Map(locked.map((r) => [r.id, r] as const));
      const homeIds = Array.from(new Set(locked.map((r) => r.boardId)));
      const [homes, existing] = await Promise.all([
        tx.board.findMany({ where: { id: { in: homeIds } }, select: { id: true, archivedAt: true, productSlug: true } }),
        tx.itemListLink.findMany({ where: { itemId: { in: ids } }, select: { itemId: true, boardId: true, position: true } }),
      ]);
      const homeArchived = new Map(homes.map((h) => [h.id, !!h.archivedAt] as const));
      const homePersonal = new Set(homes.filter((h) => h.productSlug === "personal-list").map((h) => h.id));
      const countByItem = new Map<string, number>();
      const existingHere = new Map<string, number>();
      for (const l of existing) {
        countByItem.set(l.itemId, (countByItem.get(l.itemId) ?? 0) + 1);
        if (l.boardId === args.boardId) existingHere.set(l.itemId, l.position);
      }
      // The route asked listLinksAvailable() before any of this: it only calls
      // here when the table exists.
      let next = await nextPositionInList(tx, args.boardId, true);
      const toCreate: Array<{ itemId: string; boardId: string; position: number; addedById: string }> = [];
      const results: AddLinkResult[] = [];
      for (const id of ids) {
        const it = byId.get(id) ?? null;
        const readable = args.readable.get(id) ?? false;
        const preHome = args.preReadHome.get(id);
        if (it && preHome !== undefined && preHome !== it.boardId) {
          // Moved in between. What the caller may do with it depends on the
          // new home, which is not asked from inside the transaction; a task
          // they could not read stays item_not_found, like every other fact.
          results.push({ itemId: id, ok: false, reason: readable ? "home_changed" : "item_not_found" });
          continue;
        }
        const decision = target
          ? decideAddLink({
              orgId: args.viewer.organizationId,
              target,
              item: it ? { ...it, homeArchived: homeArchived.get(it.boardId) ?? true, homePersonal: homePersonal.has(it.boardId) } : null,
              readable,
              targetId: args.boardId,
              alreadyLinked: existingHere.has(id),
              linkCount: countByItem.get(id) ?? 0,
              canContributeHome: it ? args.contributeHome.get(it.boardId) ?? false : false,
            })
          : ({ ok: false, reason: "list_archived" } as const);
        if (!decision.ok) {
          results.push({ itemId: id, ok: false, reason: decision.reason });
          continue;
        }
        if (decision.idempotent) {
          results.push({ itemId: id, ok: true, created: false, position: existingHere.get(id) ?? 0 });
          continue;
        }
        toCreate.push({ itemId: id, boardId: args.boardId, position: next, addedById: args.viewer.userId });
        results.push({ itemId: id, ok: true, created: true, position: next });
        next += LINK_POSITION_STEP;
      }
      if (toCreate.length) await tx.itemListLink.createMany({ data: toCreate, skipDuplicates: true });
      return results;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * The copy of a duplicated task joins the Lists its original is in, but ONLY
 * those the duplicator may write to (a live task List, not system, not
 * personal): the original's other links are silently not copied and nothing
 * is counted, so a duplicate teaches nobody about Lists they cannot write.
 * Only a top-level original carries links. Returns the Lists the copy joined.
 */
export async function eligibleCopyLists(originalId: string, viewer: LinkViewer): Promise<string[]> {
  const links = await linksOfItem(originalId);
  if (links.length === 0) return [];
  const reader = listReader(viewer);
  const out: string[] = [];
  for (const l of links) {
    const b = await reader.row(l.boardId);
    if (!b || !isLinkTarget(b)) continue;
    if (!(await canContributeBoard(b.id, viewer.userId, viewer.accessLevel))) continue;
    out.push(b.id);
  }
  return out;
}

export async function copyListLinks(copyId: string, boardIds: readonly string[], viewer: LinkViewer): Promise<string[]> {
  if (boardIds.length === 0 || !(await listLinksAvailable())) return [];
  const joined: string[] = [];
  for (const boardId of boardIds) {
    try {
      await prisma.$transaction(async (tx) => {
        await listOrderLock(tx, boardId);
        // Asked above, before any transaction: the table is there.
        const position = await nextPositionInList(tx, boardId, true);
        await tx.itemListLink.createMany({ data: [{ itemId: copyId, boardId, position, addedById: viewer.userId }], skipDuplicates: true });
      });
      joined.push(boardId);
    } catch (err) {
      if (isMissingListLinkTableError(err)) {
        markListLinksMissing();
        break;
      }
      // One List refusing (deleted in between) must not cost the others.
      console.error(`[list-links] copy link ${copyId} into ${boardId} failed`, err);
    }
  }
  return joined;
}

/**
 * The Lists a recurring task's next occurrence joins: the ones its source is
 * shared into that are still live task Lists (not archived, not system, not
 * personal) other than the occurrence's own home. The series was shared into
 * them by someone allowed to, so its next task appears there too, as the
 * previous one did; a List that stopped being a place a task can be shared
 * into is simply not joined. Absent table: none.
 */
export async function recurrenceLinkLists(
  source: { id: string; boardId: string; organizationId: string },
): Promise<Array<{ boardId: string; addedById: string | null }>> {
  const links = await linksOfItem(source.id);
  if (links.length === 0) return [];
  const boards = await prisma.board.findMany({
    where: { id: { in: links.map((l) => l.boardId) }, organizationId: source.organizationId },
    select: { id: true, archivedAt: true, itemType: true, productSlug: true, settings: true },
  });
  const ok = new Set(boards.filter((b) => b.id !== source.boardId && isLinkTarget(b)).map((b) => b.id));
  return links.filter((l) => ok.has(l.boardId)).map((l) => ({ boardId: l.boardId, addedById: l.addedById }));
}

/** Link a new occurrence into those Lists, each append under its List's order lock. */
export async function carryListLinks(copyId: string, lists: ReadonlyArray<{ boardId: string; addedById: string | null }>): Promise<string[]> {
  if (lists.length === 0 || !(await listLinksAvailable())) return [];
  const joined: string[] = [];
  for (const l of lists) {
    try {
      await prisma.$transaction(async (tx) => {
        await listOrderLock(tx, l.boardId);
        // Asked above, before any transaction: the table is there.
        const position = await nextPositionInList(tx, l.boardId, true);
        await tx.itemListLink.createMany({ data: [{ itemId: copyId, boardId: l.boardId, position, addedById: l.addedById }], skipDuplicates: true });
      });
      joined.push(l.boardId);
    } catch (err) {
      if (isMissingListLinkTableError(err)) {
        markListLinksMissing();
        break;
      }
      // One List refusing (deleted in between) must not cost the others.
      console.error(`[list-links] carry link ${copyId} into ${l.boardId} failed`, err);
    }
  }
  return joined;
}

// ── Trash ───────────────────────────────────────────────────────────

/** The link rows touching these tasks or Lists, deduplicated. */
export async function captureListLinks(
  db: Db,
  scope: { itemIds?: readonly string[]; boardIds?: readonly string[] },
): Promise<LinkRow[]> {
  const itemIds = Array.from(new Set(scope.itemIds ?? []));
  const boardIds = Array.from(new Set(scope.boardIds ?? []));
  if (!itemIds.length && !boardIds.length) return [];
  const or: Prisma.ItemListLinkWhereInput[] = [];
  if (itemIds.length) or.push({ itemId: { in: itemIds } });
  if (boardIds.length) or.push({ boardId: { in: boardIds } });
  const rows = await db.itemListLink.findMany({ where: { OR: or } });
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.itemId}\u0000${r.boardId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseLinkRows(raw: unknown): LinkRow[] {
  if (!Array.isArray(raw)) return [];
  const out: LinkRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.itemId !== "string" || typeof o.boardId !== "string") continue;
    out.push({
      itemId: o.itemId,
      boardId: o.boardId,
      position: typeof o.position === "number" && Number.isFinite(o.position) ? o.position : 0,
      addedById: typeof o.addedById === "string" ? o.addedById : null,
      createdAt: typeof o.createdAt === "string" || o.createdAt instanceof Date ? new Date(o.createdAt as string) : new Date(),
    });
  }
  return out;
}

/** The TrashItem that holds a task or a List, when it is in Trash. */
async function trashHolding(db: Prisma.TransactionClient, organizationId: string, kind: "item" | "board", id: string): Promise<{ id: string } | null> {
  const childKey = kind === "item" ? "items" : "boards";
  return db.trashItem.findFirst({
    where: {
      organizationId,
      OR: [
        { entityType: kind, entityId: id },
        ...(kind === "item" ? [{ entityType: "item", snapshot: { path: ["children", "subtasks"], array_contains: [{ id }] } }] : []),
        { entityType: { in: kind === "item" ? ["board", "folder", "space"] : ["folder", "space"] }, snapshot: { path: ["children", childKey], array_contains: [{ id }] } },
      ],
    },
    select: { id: true },
    orderBy: { deletedAt: "desc" },
  });
}

/**
 * Park links in another TrashItem's snapshot, as a read-modify-write of the
 * snapshot taken UNDER A ROW LOCK on that TrashItem, inside the caller's
 * transaction. Two restores parking into the same holder at once used to
 * start from the same old snapshot and the second write erased the first's
 * link; now the second waits for the first and reads what it wrote. The
 * restore of the holder itself takes the same lock, so a link parked while it
 * is being restored is either in the snapshot it reads or waits for it.
 */
async function park(tx: Prisma.TransactionClient, trashId: string, links: readonly LinkRow[]): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ snapshot: unknown }>>`SELECT snapshot FROM "TrashItem" WHERE id = ${trashId} FOR UPDATE`;
  if (rows.length === 0) return false;
  const snapshot = rows[0].snapshot;
  const s = snapshot && typeof snapshot === "object" ? (snapshot as { children?: Record<string, unknown> }) : {};
  const children = { ...(s.children ?? {}) };
  const existing = parseLinkRows(children.listLinks);
  for (const link of links) {
    if (!existing.some((l) => l.itemId === link.itemId && l.boardId === link.boardId)) existing.push(link);
  }
  children.listLinks = existing.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }));
  await tx.trashItem.update({ where: { id: trashId }, data: { snapshot: { ...(s as object), children } as object } });
  return true;
}

/**
 * Put captured links back after a restore, INSIDE the restore's transaction
 * (restoreFromTrash), so the rows, the links and the TrashItem's removal
 * land together or not at all: the snapshot is the only copy of the links,
 * and it is never deleted unless every link in it has been recreated, parked
 * or found to have nothing left to point at.
 *
 * A link whose task and List both exist is recreated; one whose other side
 * is itself in Trash is PARKED in that side's TrashItem, so it comes back
 * when that side is restored, in either order; one whose other side is gone
 * for good is dropped (the cascade had already removed it).
 *
 * The existence check and the insert cannot disagree: the tasks and Lists
 * named are read FOR KEY SHARE, which a concurrent delete of either has to
 * wait for, so no insert can fail its foreign key on a row that vanished in
 * between. Anything that does fail rolls the whole restore back, and the
 * person sees the restore refused with the Trash row still there to retry.
 *
 * `linksOn` is listLinksAvailable(), answered before the transaction opened.
 */
export async function reconcileListLinks(
  tx: Prisma.TransactionClient,
  organizationId: string,
  raw: unknown,
  linksOn: boolean,
): Promise<{ restored: number; parked: number; dropped: number }> {
  const links = parseLinkRows(raw);
  const tally = { restored: 0, parked: 0, dropped: 0 };
  if (links.length === 0 || !linksOn) return tally;
  const itemIds = Array.from(new Set(links.map((l) => l.itemId)));
  const boardIds = Array.from(new Set(links.map((l) => l.boardId)));
  const items = await tx.$queryRaw<Array<{ id: string; boardId: string; parentItemId: string | null }>>`
    SELECT id, "boardId", "parentItemId" FROM "Item"
    WHERE id = ANY(${itemIds}::text[]) AND "organizationId" = ${organizationId}
    FOR KEY SHARE`;
  const boards = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Board"
    WHERE id = ANY(${boardIds}::text[]) AND "organizationId" = ${organizationId}
    FOR KEY SHARE`;
  const itemById = new Map(items.map((i) => [i.id, i] as const));
  const liveBoards = new Set(boards.map((b) => b.id));
  const create: LinkRow[] = [];
  const parkIn = new Map<string, LinkRow[]>();
  for (const l of links) {
    const item = itemById.get(l.itemId);
    const boardOk = liveBoards.has(l.boardId);
    if (item && boardOk) {
      // A task restored into the List it was linked into, or restored as a
      // subtask, cannot carry the link any more.
      if (item.boardId === l.boardId || item.parentItemId) tally.dropped += 1;
      else create.push(l);
      continue;
    }
    const missing: "item" | "board" = item ? "board" : "item";
    const holder = await trashHolding(tx, organizationId, missing, missing === "item" ? l.itemId : l.boardId);
    if (holder) {
      const list = parkIn.get(holder.id) ?? [];
      list.push(l);
      parkIn.set(holder.id, list);
    } else {
      tally.dropped += 1;
    }
  }
  // Holders in a fixed order, so two restores parking into the same pair
  // take their locks in the same order.
  for (const holderId of [...parkIn.keys()].sort()) {
    const list = parkIn.get(holderId)!;
    if (await park(tx, holderId, list)) tally.parked += list.length;
    else tally.dropped += list.length;
  }
  if (create.length) {
    const r = await tx.itemListLink.createMany({
      data: create.map((l) => ({ itemId: l.itemId, boardId: l.boardId, position: l.position, addedById: l.addedById, createdAt: l.createdAt })),
      skipDuplicates: true,
    });
    tally.restored = r.count;
  }
  return tally;
}

// ── Multi-List scopes ───────────────────────────────────────────────

export interface ListScope {
  /** The readable, live Lists of the request, in order. */
  lists: ReadableList[];
  /** The where clause for their tasks: home rows plus linked ones. */
  where: Prisma.ItemWhereInput;
  /** For each linked task in scope, the Lists (in scope) it is linked into, oldest first. */
  listsByItem: Map<string, string[]>;
}

/**
 * "The tasks of these Lists" for a multi-List surface (a connect picker, a
 * dashboard card, a report): the Lists this viewer can read and that are
 * live, and the union of their own tasks with the tasks linked into them. A
 * List the viewer cannot read contributes nothing and is never named.
 */
export async function resolveListScope(
  viewer: LinkViewer,
  boardIds: readonly string[],
  reader: ListReader = listReader(viewer),
): Promise<ListScope> {
  const lists: ReadableList[] = [];
  for (const id of Array.from(new Set(boardIds))) {
    const b = await reader.row(id);
    if (b) lists.push(b);
  }
  const ids = lists.map((b) => b.id);
  const { linkedItemIds, listsByItem } = await linkedScope(ids, viewer.organizationId);
  return { lists, where: buildListScopeWhere(ids, linkedItemIds), listsByItem };
}

// ── The one door to the legacy gates, for Phase 5b's files ──────────
//
// The access engine stays INERT in this phase, so every Phase 5b route gates
// with the existing helpers (getBoardForReader, canContributeBoard,
// canEditBoard, the Space readers, visibleSpaceIds), and those read the
// legacy accessLevel signal. They read it HERE and nowhere else, on the
// item-gate.ts precedent: one file on eslint-access-allowlist.mjs for the
// whole feature, which leaves that list in one line the day these helpers
// delegate to can().


/** An org Owner or Admin (rule 4). */
export function viewerIsOrgAdmin(v: LinkViewer): boolean {
  return isOrgAdminAccessLevel(v.accessLevel);
}

/** The List, when this viewer can read it in their own org; else null. */
export async function boardForViewer(v: LinkViewer, boardId: string) {
  const b = await getBoardForReader(boardId, v.userId, v.accessLevel);
  return b && b.organizationId === v.organizationId ? b : null;
}

/** boardForViewer, plus a granular folder grantee (the List page's own predicate). */
export async function boardForViewerOrGrantee(v: LinkViewer, boardId: string) {
  const b = await getBoardForReaderOrFolderGrantee(boardId, v.userId, v.accessLevel);
  return b && b.organizationId === v.organizationId ? b : null;
}

export function canContributeFor(v: LinkViewer, boardId: string): Promise<boolean> {
  return canContributeBoard(boardId, v.userId, v.accessLevel);
}

export function canEditFor(v: LinkViewer, boardId: string): Promise<boolean> {
  return canEditBoard(boardId, v.userId, v.accessLevel);
}

/** The Space, when this viewer can read it in their own org; else null. */
export async function spaceForViewer(v: LinkViewer, spaceId: string) {
  const s = await getSpaceForReader(spaceId, v.userId, v.accessLevel);
  return s && s.organizationId === v.organizationId ? s : null;
}

export function canContributeSpaceFor(v: LinkViewer, spaceId: string): Promise<boolean> {
  return canContributeSpace(spaceId, v.userId, v.accessLevel);
}

/**
 * canEditSpace for this viewer: an org admin, or the Space's OWNER or ADMIN.
 * The ladder the Space page's Bookmarks and the Folders and Lists "+" already
 * use, and the one that decides who edits a Space's Overview widgets.
 */
export function canEditSpaceFor(v: LinkViewer, spaceId: string): Promise<boolean> {
  return canEditSpace(spaceId, v.userId, v.accessLevel);
}

/** visibleSpaceIds for this viewer: full-read only, never widened by a folder grant. */
export function visibleSpacesFor(v: LinkViewer, spaceIds: string[]): Promise<Set<string>> {
  return visibleSpaceIds(spaceIds, v.userId, v.accessLevel);
}

/**
 * A member as a LinkViewer, read from their row, or null when they are not a
 * live member of this org (deleted, deactivated or elsewhere) or are a Guest.
 * The report cron builds each recipient's copy under this and nothing else,
 * and counts a null as skippedInactive: a Guest is shown a 404 for every
 * dashboard page, so no report is ever mailed to one.
 */
export async function memberViewer(userId: string, organizationId: string): Promise<(LinkViewer & { email: string }) | null> {
  const u = await prisma.user.findFirst({
    where: { id: userId, organizationId, deletedAt: null, status: { not: "INACTIVE" } },
    select: { id: true, email: true, accessLevel: true },
  });
  if (!u || !u.email) return null;
  if (orgRoleOf({ accessLevel: u.accessLevel }) === "GUEST") return null;
  return { userId: u.id, accessLevel: u.accessLevel ?? "EMPLOYEE", organizationId, email: u.email };
}

// ── Report recipients ───────────────────────────────────────────────
//
// Eligible = a member of THIS org, not deleted, status not INACTIVE (ON_LEAVE,
// PROBATION, PIP and NOTICE_PERIOD still sign in, so they still receive), and
// not a Guest. The org role is read here with orgRoleOf over the legacy access
// level, the one predicate the access engine's step 4 moves onto
// User.orgRole; the access level itself never leaves this file.

export interface RecipientRow {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
  status: string;
  guest: boolean;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

function isEligibleRecipient(r: { deletedAt: Date | null; status: string | null; guest: boolean }): boolean {
  return !r.deletedAt && r.status !== "INACTIVE" && !r.guest;
}

/** The org's user rows for these ids (any other org's are simply absent). */
export async function recipientRows(ids: string[], organizationId: string): Promise<RecipientRow[]> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0))).slice(0, 500);
  if (unique.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: unique }, organizationId },
    select: { id: true, organizationId: true, deletedAt: true, status: true, accessLevel: true, firstName: true, lastName: true, avatar: true },
  });
  return rows.map((u) => ({
    id: u.id,
    organizationId: u.organizationId,
    deletedAt: u.deletedAt,
    status: String(u.status),
    guest: orgRoleOf({ accessLevel: u.accessLevel }) === "GUEST",
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    avatar: u.avatar ?? null,
  }));
}

export interface RecipientOption {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  email: string | null;
  eligible: boolean;
}

/**
 * The recipient picker's rows: the people named by `ids` (the chips already
 * on a schedule, eligible or not, so a colleague who went inactive still
 * shows as a greyed chip) plus, for `q`, the ELIGIBLE members whose first
 * name, last name or email matches. Ordered by name.
 */
export async function recipientOptions(i: {
  organizationId: string;
  q?: string;
  ids?: string[];
  limit?: number;
  /**
   * Who is asking. An ineligible person named by id is answered only when
   * they are on a schedule this caller may manage (their own, or any in the
   * org for an org admin), and never with an email (namedRecipientFor).
   * Absent: ineligible ids are never named.
   */
  viewer?: LinkViewer;
}): Promise<RecipientOption[]> {
  const limit = Math.min(50, Math.max(1, Math.floor(i.limit ?? 20)));
  const q = (i.q ?? "").trim().slice(0, 80);
  const ids = Array.from(new Set((i.ids ?? []).filter((id) => typeof id === "string" && id.length > 0))).slice(0, 100);
  const select = { id: true, organizationId: true, deletedAt: true, status: true, accessLevel: true, firstName: true, lastName: true, avatar: true, email: true } as const;
  const [named, found] = await Promise.all([
    ids.length ? prisma.user.findMany({ where: { id: { in: ids }, organizationId: i.organizationId }, select }) : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        organizationId: i.organizationId,
        deletedAt: null,
        status: { not: "INACTIVE" },
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" as const } },
                { lastName: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      // A little over the limit, because the Guest check runs after the read.
      take: limit + 10,
    }),
  ]);
  const toOption = (u: (typeof found)[number]): RecipientOption => {
    const guest = orgRoleOf({ accessLevel: u.accessLevel }) === "GUEST";
    return {
      id: u.id,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      avatar: u.avatar ?? null,
      email: u.email ?? null,
      eligible: isEligibleRecipient({ deletedAt: u.deletedAt, status: String(u.status), guest }),
    };
  };
  // The ineligible ids that sit on a schedule the caller may manage.
  const ineligibleIds = named.map(toOption).filter((o) => !o.eligible).map((o) => o.id);
  const onSchedule = new Set<string>();
  if (ineligibleIds.length && i.viewer) {
    const rows = await prisma.reportSchedule
      .findMany({
        where: {
          organizationId: i.organizationId,
          ...(viewerIsOrgAdmin(i.viewer) ? {} : { createdById: i.viewer.userId }),
          recipientUserIds: { hasSome: ineligibleIds },
        },
        select: { recipientUserIds: true },
        take: 500,
      })
      .catch(() => [] as Array<{ recipientUserIds: string[] }>);
    for (const r of rows) for (const id of r.recipientUserIds) onSchedule.add(id);
  }
  const out = new Map<string, RecipientOption>();
  for (const u of named) {
    const o = namedRecipientFor(toOption(u), onSchedule.has(u.id));
    if (o) out.set(u.id, o);
  }
  let taken = 0;
  for (const u of found) {
    if (taken >= limit) break;
    const o = toOption(u);
    if (!o.eligible) continue;
    taken += 1;
    if (!out.has(o.id)) out.set(o.id, o);
  }
  const name = (o: RecipientOption) => `${o.firstName} ${o.lastName}`.trim().toLowerCase() || (o.email ?? "");
  return [...out.values()].sort((a, b) => name(a).localeCompare(name(b)));
}
