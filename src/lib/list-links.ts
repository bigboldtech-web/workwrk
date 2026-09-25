// Tasks in more than one List: the pure rules.
//
// Decision 7 (docs/plans/competitor-gap-2026-09.md section 7), ClickUp's
// model. A task keeps its HOME List (Item.boardId) exactly as today. A row in
// ItemListLink shows the task, with its subtask tree, in ONE more List. This
// file is every decision about that which needs no database, so each one can
// be pinned by a test in node: the where clause a multi-List read uses, which
// List a row is labelled with, when a context List in a request is honoured,
// the add and remove gates, the status rule, positions and the count merges.
//
// The server half (the table check, the locks, the queries) is
// src/lib/list-links-server.ts.
//
// Pure: type-only imports, plus system-items.ts, which is itself pure.

import type { Prisma } from "@/generated/prisma";
import type { StatusOption } from "@/lib/board-items-shared";
import { isSystemItemType } from "@/lib/system-items";

/**
 * THE ONE SWITCH, now on. A List page asks for `?links=1` (list-link-rows.ts
 * itemsUrl) and draws the tasks linked into it. It was flipped in the same
 * change that made board-canvas.tsx honour the item event's `listIds`, made
 * board-table-view.tsx and board-kanban-view.tsx send `contextBoardId` on
 * every write from a linked row, and made the poll ask for `?links=1`, so no
 * client holds a linked row it would write back without its context List.
 * list-links.client-contract.test.ts holds both halves of that promise; turn
 * it off again and the same test demands that no client asks for the union.
 */
export const LIST_LINK_CANVAS_LIVE = true;

/**
 * The most linked ids one multi-List read carries, inline, in its where
 * clause. Every id is one bind parameter and Postgres refuses a statement
 * with more than 65535 of them, so this stays well under that with room for
 * the rest of the query's filters. It is also the ceiling on the rows
 * linkedTreeRows answers; a read that reaches it is logged by the server
 * half, never silently cut.
 */
export const LIST_LINK_SCOPE_MAX = 30_000;
/** A task may appear in at most this many Lists besides its home. */
export const MAX_LISTS_PER_ITEM = 20;
/** The gap every append leaves, the same step createBoardItem has always used. */
export const LINK_POSITION_STEP = 1024;
/** How deep a linked task's subtask tree is followed, the bound moveBoardItem
 *  already uses so a cycle an older release wrote cannot loop a read. */
export const SUBTREE_DEPTH = 6;

// ── The multi-List where clause ─────────────────────────────────────

/**
 * The Item where clause for "the tasks of these Lists".
 *
 * `linkedItemIds` null or empty gives EXACTLY today's clause, which is the
 * no-behaviour-change guarantee: while no link exists (or the table is
 * absent) every multi-List read asks Postgres the question it asked before.
 *
 * With linked ids, the clause is the home rows OR exactly those ids. The ids
 * come from linkedTreeRows, whose recursive query is the ONE definition of a
 * linked tree (a linked root plus its subtasks on the SAME home, live, with a
 * live home List). This clause used to switch, past 5000 ids, to a nested
 * relation form ("a task whose parent, up to six levels up, is linked"),
 * which could not say "on the same home": a subtask moved on its own into a
 * List the viewer cannot read still has its parent, so that form handed it to
 * the viewer. It is gone. Past LIST_LINK_SCOPE_MAX ids the list is cut
 * deterministically (the server half logs that it happened); a cut can hide a
 * row, and it can never show one the viewer may not read.
 *
 * An empty `boardIds` matches nothing, linked ids or not: linked ids belong
 * to the Lists they were read for, and with no Lists there is nothing to show.
 */
export function buildListScopeWhere(
  boardIds: readonly string[],
  linkedItemIds: readonly string[] | null,
  max: number = LIST_LINK_SCOPE_MAX,
): Prisma.ItemWhereInput {
  const lists = Array.from(new Set(boardIds));
  if (lists.length === 0) return { boardId: { in: [] } };
  if (!linkedItemIds || linkedItemIds.length === 0) return { boardId: { in: lists } };
  let linked = Array.from(new Set(linkedItemIds));
  if (linked.length > max) linked = [...linked].sort().slice(0, Math.max(0, max));
  if (linked.length === 0) return { boardId: { in: lists } };
  return { OR: [{ boardId: { in: lists } }, { id: { in: linked } }] };
}

// ── Labelling a row, and honouring a context List ───────────────────

export interface RowContext {
  boardId: string;
  via: "home" | "linked";
}

/**
 * The List a multi-List surface labels a row with.
 *
 * The home List wins whenever it is in scope. Otherwise the oldest link in
 * scope. When neither is, null: the row is not in this scope at all, and an
 * unreadable home is NEVER used as a label, because printing its name is how
 * a shared task would leak the private List it lives in.
 */
export function contextBoardFor(
  homeBoardId: string,
  linkedBoardIds: readonly string[],
  scope: ReadonlySet<string>,
): RowContext | null {
  if (scope.has(homeBoardId)) return { boardId: homeBoardId, via: "home" };
  for (const id of linkedBoardIds) {
    if (scope.has(id)) return { boardId: id, via: "linked" };
  }
  return null;
}

/**
 * Which body a request with a context List gets.
 *
 * No context, or the home: the home body. A List the task appears in AND the
 * caller can read: the linked body. Anything else is ONE answer, "invalid",
 * whether the List is unreadable or the task is simply not in it, so a
 * request can never be used to learn whether a task is in a List.
 */
export function decideContext(i: {
  requested: string | null | undefined;
  homeBoardId: string;
  linkedBoardIds: readonly string[];
  requestedReadable: boolean;
}): "home" | "linked" | "invalid" {
  if (i.requested === undefined || i.requested === null || i.requested === "") return "home";
  if (i.requested === i.homeBoardId) return "home";
  if (i.requestedReadable && i.linkedBoardIds.includes(i.requested)) return "linked";
  return "invalid";
}

// ── Adding and removing a link ──────────────────────────────────────

export type AddLinkRefusal =
  | "list_archived"
  | "not_a_task_list"
  | "personal_list"
  | "item_not_found"
  | "item_archived"
  | "is_subtask"
  | "already_home"
  | "home_list_read_only"
  | "too_many_lists"
  // The task moved to another List between the caller's read and the lock.
  // Only a task the caller could read is answered this way (anything else is
  // item_not_found), and the answer is "try again", never a fact about it.
  | "home_changed";

export interface AddLinkTarget {
  organizationId: string;
  archivedAt: Date | string | null;
  itemType: string;
  productSlug: string | null;
  settings: unknown;
}

export interface AddLinkItem {
  organizationId: string;
  boardId: string;
  itemType: string;
  archivedAt: Date | string | null;
  parentItemId: string | null;
  /** The task's HOME List is archived. */
  homeArchived: boolean;
}

function isSystemList(settings: unknown): boolean {
  return !!settings && typeof settings === "object" && !Array.isArray(settings)
    && (settings as Record<string, unknown>).system === true;
}

/**
 * May this task be added to this List?
 *
 * The List checks come first (the route answers them before any task is
 * read; they are repeated here for the transaction's re-check on locked
 * rows). Then the task, IN AN ORDER THAT REVEALS NOTHING: a task that is
 * missing, in another org, a system item or not readable by the caller is
 * `item_not_found` before any other fact about it is consulted, so whether
 * it is archived, a subtask, already home here or linked twenty times is
 * never told to someone who cannot see it.
 */
export function decideAddLink(i: {
  orgId: string;
  target: AddLinkTarget;
  item: AddLinkItem | null;
  readable: boolean;
  targetId: string;
  alreadyLinked: boolean;
  linkCount: number;
  canContributeHome: boolean;
}): { ok: true; idempotent: boolean } | { ok: false; reason: AddLinkRefusal } {
  const t = i.target;
  if (t.organizationId !== i.orgId) return { ok: false, reason: "not_a_task_list" };
  if (t.archivedAt) return { ok: false, reason: "list_archived" };
  if (isSystemList(t.settings) || t.itemType !== "studio-item") return { ok: false, reason: "not_a_task_list" };
  if (t.productSlug === "personal-list") return { ok: false, reason: "personal_list" };

  const it = i.item;
  if (!it || it.organizationId !== i.orgId || isSystemItemType(it.itemType) || !i.readable) {
    return { ok: false, reason: "item_not_found" };
  }
  if (it.archivedAt || it.homeArchived) return { ok: false, reason: "item_archived" };
  if (it.parentItemId) return { ok: false, reason: "is_subtask" };
  if (it.boardId === i.targetId) return { ok: false, reason: "already_home" };
  if (!i.canContributeHome) return { ok: false, reason: "home_list_read_only" };
  if (i.alreadyLinked) return { ok: true, idempotent: true };
  if (i.linkCount >= MAX_LISTS_PER_ITEM) return { ok: false, reason: "too_many_lists" };
  return { ok: true, idempotent: false };
}

/**
 * May the caller take this task out of this List?
 *
 * 404 for a List the caller cannot read, WHATEVER the link state, and 404 for
 * a missing link: neither answer confirms that the task is in a List. 403 only
 * for a caller who can read the List and writes to neither it nor the task's
 * home. A home manager who cannot read the List uses DELETE
 * /api/items/[id]/lists instead.
 */
export function decideLinkRemoval(i: {
  listReadable: boolean;
  linkExists: boolean;
  canContributeList: boolean;
  canContributeHome: boolean;
}): 404 | 403 | "ok" {
  if (!i.listReadable) return 404;
  if (!i.linkExists) return 404;
  if (i.canContributeList || i.canContributeHome) return "ok";
  return 403;
}

// ── Status, positions, moves ────────────────────────────────────────

/**
 * A linked task's status always comes from its HOME set.
 *
 * A secondary List shows that status with an indicator and never remaps it,
 * so a write from any context must name a status the home declares. A task
 * with NO links keeps today's behaviour exactly (anything passes), and so do
 * an absent value, a clear and a re-send of the current value.
 */
export function validateLinkedStatus(
  next: string | null | undefined,
  homeStatuses: readonly StatusOption[],
  current: string | null,
  hasLinks: boolean,
): { ok: true } | { ok: false; reason: "not_in_home_list" } {
  if (next === undefined || next === null) return { ok: true };
  if (next === current) return { ok: true };
  if (!hasLinks) return { ok: true };
  if (homeStatuses.some((s) => s.value === next)) return { ok: true };
  return { ok: false, reason: "not_in_home_list" };
}

/**
 * The next position at the end of a List that holds both kinds of row.
 *
 * Its own tasks order by Item.position and its linked tasks by
 * ItemListLink.position, in ONE order space, so an append must land after the
 * larger of the two maxima. An empty List starts at one step, as
 * createBoardItem always has.
 */
export function nextListPosition(
  maxHome: number | null,
  maxLink: number | null,
  step: number = LINK_POSITION_STEP,
): number {
  const candidates = [maxHome, maxLink].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const top = candidates.length ? Math.max(...candidates) : 0;
  return top + step;
}

/**
 * The link a move must drop.
 *
 * Moving a task INTO a List it is linked into makes that List its home, and a
 * task can never be both home in a List and linked into it. Only the root's
 * link into the target goes; every other link survives the move.
 */
export function linkToDropOnMove(
  links: ReadonlyArray<{ itemId: string; boardId: string }>,
  rootId: string,
  toBoardId: string,
): { itemId: string; boardId: string } | null {
  return links.find((l) => l.itemId === rootId && l.boardId === toBoardId) ?? null;
}

// ── Count merges for the read sites ─────────────────────────────────

export interface ListTaskCount {
  total: number;
  open: number;
  done: number;
}

/**
 * One linked task in one List (linkedTreeRows), or a pre-counted group of
 * them by home and status (linkedTreeCountGroups). The groups are what the
 * Folder and Space pages use: exact at any size, where a row per task has to
 * stop somewhere.
 */
export type LinkCountRow =
  | { listId: string; itemId: string; homeBoardId: string; status: string | null }
  | { listId: string; homeBoardId: string; status: string | null; count: number };

/**
 * Per-List task counts with linked tasks included.
 *
 * Done is decided by the task's HOME status set (`isDone(homeBoardId,
 * status)`), because the status belongs to the home: a linked task whose home
 * status "Shipped" is in the DONE group counts as done in List B although B's
 * own set has no "Shipped". A task counts once per List however many link
 * rows name it, and a stale row linking a task into its own home List is
 * ignored, since the home count already holds that task.
 */
export function mergeListTaskCounts(
  homeGroups: ReadonlyArray<{ boardId: string; status: string | null; count: number }>,
  linkRows: ReadonlyArray<LinkCountRow>,
  isDone: (homeBoardId: string, status: string | null) => boolean,
): Map<string, ListTaskCount> {
  const out = new Map<string, ListTaskCount>();
  const bucket = (id: string): ListTaskCount => {
    let b = out.get(id);
    if (!b) {
      b = { total: 0, open: 0, done: 0 };
      out.set(id, b);
    }
    return b;
  };
  for (const g of homeGroups) {
    const b = bucket(g.boardId);
    b.total += g.count;
    if (isDone(g.boardId, g.status)) b.done += g.count;
    else b.open += g.count;
  }
  const seen = new Set<string>();
  for (const r of linkRows) {
    if (r.listId === r.homeBoardId) continue;
    let n = 1;
    if ("itemId" in r) {
      const key = `${r.listId}\u0000${r.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    } else {
      // A pre-counted group (linkedTreeCountGroups): the query already
      // counted each task once per List, so the number is added as it is.
      n = Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : 0;
      if (n === 0) continue;
    }
    const b = bucket(r.listId);
    b.total += n;
    if (isDone(r.homeBoardId, r.status)) b.done += n;
    else b.open += n;
  }
  return out;
}

/**
 * Per-List facet counts for a multi-List page (Everything's List filter).
 *
 * `homeGroups` is grouped by the task's HOME List over the union, so it can
 * name a List the viewer cannot read: a task shared into a readable List from
 * a private one. That List must never appear as a facet, because the facet
 * prints its name, which is the leak the union would otherwise open. Link
 * counts add onto the readable Lists they were counted for.
 */
export function mergeListFacetCounts(
  homeGroups: ReadonlyArray<{ boardId: string; count: number }>,
  linkGroups: ReadonlyArray<{ boardId: string; count: number }>,
  readable: ReadonlySet<string>,
): Array<{ boardId: string; count: number }> {
  const out = new Map<string, number>();
  for (const g of [...homeGroups, ...linkGroups]) {
    if (!readable.has(g.boardId)) continue;
    out.set(g.boardId, (out.get(g.boardId) ?? 0) + g.count);
  }
  return [...out.entries()].map(([boardId, count]) => ({ boardId, count }));
}

// ── Degrading while the table is absent ─────────────────────────────

function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Is this the error a query meets when ItemListLink does not exist yet?
 *
 * A deploy can land before its SQL, so every reader treats this as "no links"
 * and answers today's home-only read. Two shapes are recognised: the missing
 * relation (P2021 from the client, 42P01 from a raw query or the driver
 * adapter) NAMING ItemListLink, and a client that does not know the relation
 * fields at all (a PrismaClientValidationError naming otherLists or
 * linkedItems). A missing OTHER table, or any other failure such as a unique
 * violation, is not this and must surface.
 */
export function isMissingListLinkTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (e.name === "PrismaClientValidationError") return /\b(otherLists|linkedItems|itemListLink)\b/.test(message);
  const text = `${message} ${textOf(e.meta)} ${textOf(e.cause)}`;
  const code = typeof e.code === "string" ? e.code : "";
  const metaCode = e.meta && typeof e.meta === "object" ? (e.meta as { code?: unknown }).code : undefined;
  const missingRelation =
    code === "P2021" ||
    code === "42P01" ||
    metaCode === "42P01" ||
    /\b42P01\b/.test(text) ||
    /relation "?[\w."]*"? does not exist/i.test(text) ||
    /table .* does not exist/i.test(text);
  return missingRelation && /ItemListLink/.test(text);
}
