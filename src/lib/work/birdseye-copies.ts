// Bird's eye, the cards on screen as COPIES: one per List a task is shown
// in (its home List, and every List it is linked into, Phase 5b), always
// addressed as (List, task). Pure, so the rules a person relies on (a pick
// moves only the copy it came from, a re-read keeps a linked copy that is
// still linked, a task that arrives lands where the loaded pages reach) are
// unit tested here; src/components/space-birdseye/use-birdseye.ts holds the
// state and calls these.

import type { BoardItemRow } from "@/lib/board-items-shared";
import type { ItemRole } from "@/lib/item-role";
import { mergeRefetchedRow, type RefetchedTask } from "@/lib/list-link-rows";
import { bucketRank, cardFromRow, cardOrder, type BirdseyeCard, type CardSourceRow } from "@/lib/work/birdseye";
import { cardOf, linkedCardFromRow, linkedRowOf, type LinkedList } from "@/lib/work/birdseye-linked";

/**
 * ONE TASK, MANY COPIES. A task shows once per List it is in: its home List,
 * and every List it is linked into (Phase 5b). With two of those Lists in one
 * Space or Folder it is on screen twice, so a card is always addressed as
 * (the List it is shown in, the task), never by the task alone: a pick, a
 * drag, a refresh or a removal touches the copy it came from, and the other
 * copies are re-read in their own List (each places it by its own rule).
 */
export function copyKey(listId: string, id: string): string {
  return `${listId}\u0000${id}`;
}

export function keyOf(card: { boardId: string; id: string }): string {
  return copyKey(card.boardId, card.id);
}

/** What a column holds, as far as finding a card goes: a page of cards and the ones added this visit. */
export interface CopyColumn {
  cards: BirdseyeCard[];
  justAdded: BirdseyeCard[];
}

/** Focus: one List's columns. */
export interface CopyFocus<C extends CopyColumn = CopyColumn> {
  boardId: string;
  columns: Record<string, C>;
}

type Columns = Record<string, CopyColumn>;

/** The card of task `id` in one record of columns (one List's), through `fn`. */
export function mapCards<C extends CopyColumn>(
  columns: Record<string, C>,
  id: string,
  fn: (c: BirdseyeCard) => BirdseyeCard | null,
): Record<string, C> {
  let changed = false;
  const next: Record<string, C> = {};
  for (const [key, col] of Object.entries(columns)) {
    const touch = (list: BirdseyeCard[]) => {
      if (!list.some((c) => c.id === id)) return list;
      changed = true;
      return list.flatMap((c) => {
        if (c.id !== id) return [c];
        const out = fn(c);
        return out ? [out] : [];
      });
    };
    next[key] = { ...col, cards: touch(col.cards), justAdded: touch(col.justAdded) };
  }
  return changed ? next : columns;
}

/** The overview's copy of task `id` in List `listId` (that List's column), through `fn`. */
export function mapOverviewCopy<C extends CopyColumn>(
  overview: Record<string, C>,
  listId: string,
  id: string,
  fn: (c: BirdseyeCard) => BirdseyeCard | null,
): Record<string, C> {
  const col = overview[listId];
  if (!col) return overview;
  const next = mapCards({ [listId]: col }, id, fn)[listId];
  return next === col ? overview : { ...overview, [listId]: next };
}

/** Focus's copy of task `id`, when focus shows List `listId`, through `fn`. */
export function mapFocusCopy<F extends CopyFocus>(focus: F | null, listId: string, id: string, fn: (c: BirdseyeCard) => BirdseyeCard | null): F | null {
  if (!focus || focus.boardId !== listId) return focus;
  const columns = mapCards(focus.columns, id, fn);
  return columns === focus.columns ? focus : { ...focus, columns };
}

export function findCard(columns: Columns, id: string): BirdseyeCard | null {
  for (const col of Object.values(columns)) {
    const hit = col.cards.find((c) => c.id === id) ?? col.justAdded.find((c) => c.id === id);
    if (hit) return hit;
  }
  return null;
}

/** The copy of task `id` shown in List `listId`, from the overview or the focus columns. */
export function findCopy(overview: Columns, focus: CopyFocus | null, listId: string, id: string): BirdseyeCard | null {
  const col = overview[listId];
  const hit = col ? (col.cards.find((c) => c.id === id) ?? col.justAdded.find((c) => c.id === id)) : undefined;
  if (hit) return hit;
  return focus && focus.boardId === listId ? findCard(focus.columns, id) : null;
}

/** Every copy of task `id` on screen, one per List it is shown in. */
export function copiesOf(overview: Columns, focus: CopyFocus | null, id: string): BirdseyeCard[] {
  const out = new Map<string, BirdseyeCard>();
  for (const [listId, col] of Object.entries(overview)) {
    const hit = col.cards.find((c) => c.id === id) ?? col.justAdded.find((c) => c.id === id);
    if (hit) out.set(listId, hit);
  }
  if (focus && !out.has(focus.boardId)) {
    const hit = findCard(focus.columns, id);
    if (hit) out.set(focus.boardId, hit);
  }
  return [...out.values()];
}

/**
 * The status the copy in List `listId` shows right now. `undefined` when
 * that copy is not on screen at all (only the counts know it).
 */
export function shownStatusOf(overview: Columns, focus: CopyFocus | null, listId: string, id: string): string | null | undefined {
  const hit = findCopy(overview, focus, listId, id);
  return hit ? hit.status : undefined;
}

export function focusColumnOf(focus: CopyFocus | null, listId: string, id: string): string | null {
  if (!focus || focus.boardId !== listId) return null;
  for (const [key, col] of Object.entries(focus.columns)) {
    if (col.cards.some((c) => c.id === id) || col.justAdded.some((c) => c.id === id)) return key;
  }
  return null;
}

/** The writes in flight for one List's copies, by task: what a focus page merge reads. */
export function pendingIn(pending: ReadonlyMap<string, string | null>, listId: string): Map<string, string | null> {
  const prefix = copyKey(listId, "");
  const out = new Map<string, string | null>();
  for (const [key, status] of pending) if (key.startsWith(prefix)) out.set(key.slice(prefix.length), status);
  return out;
}

/** GET /api/items/[id]: the task, the List this body is for, and the viewer's role on it. */
export interface TaskBody {
  item?: CardSourceRow & { parentItemId?: string | null; archivedAt?: string | null };
  context?: RefetchedTask["context"] & { home?: { id?: string; slug?: string; name?: string; readable: boolean } };
  decision?: { role: ItemRole } | null;
}

/**
 * The Board's row for a task read in List `listId` that was not on screen
 * there (it just arrived): a linked body carries its link facts in
 * `context` and `decision`, and its place in this List in `position`.
 */
export function rowFromBody(body: TaskBody, listId: string): BoardItemRow | null {
  const item = body.item;
  const ctx = body.context;
  if (!item || !ctx || ctx.boardId !== listId) return null;
  if (ctx.kind !== "linked") return { ...(item as unknown as BoardItemRow), boardId: listId };
  const home = ctx.home && ctx.home.readable && ctx.home.id ? { id: ctx.home.id, slug: ctx.home.slug ?? "", name: ctx.home.name ?? "" } : undefined;
  const role = body.decision?.role && body.decision.role !== "none" ? body.decision.role : undefined;
  return {
    ...(item as unknown as BoardItemRow),
    boardId: listId,
    listLink: {
      boardId: listId,
      position: item.parentItemId ? null : typeof item.position === "number" ? item.position : null,
      rootId: item.id,
      ...(home ? { homeList: home } : {}),
      ...(ctx.homeStatus !== undefined ? { homeStatus: ctx.homeStatus } : {}),
      ...(ctx.homeStatuses ? { homeStatuses: ctx.homeStatuses } : {}),
      ...(role ? { role } : {}),
    },
  } as BoardItemRow;
}

// ── A re-read, and a task that arrives ──────────────────────────────

export type LinkedRefresh = { action: "drop" } | { action: "reload" } | { action: "merge"; card: BirdseyeCard };

/**
 * What a re-read of a linked copy does to it: the Board's own merge
 * (mergeRefetchedRow) folds the answer in, then the server's card builder
 * rebuilds it, so its column, reason line and drag follow a new home status
 * or a new role. It stays while the answer is still for this List; an
 * answer for another List (unlinked here) or an archived task, or one that
 * became a subtask, drops it; a task whose kind here changed (now its home
 * List) asks for the view to be re-read.
 */
export function refreshLinkedCopy(copy: BirdseyeCard, body: TaskBody, list: LinkedList): LinkedRefresh {
  const item = body.item;
  if (!item || !body.context) return { action: "drop" };
  const merged = mergeRefetchedRow(linkedRowOf(copy), body as RefetchedTask, list.id);
  if (merged.action !== "merge") return merged;
  if (item.archivedAt || item.parentItemId) return { action: "drop" };
  const fresh = linkedCardFromRow(merged.row, list);
  return fresh ? { action: "merge", card: cardOf(fresh) } : { action: "drop" };
}

/** The card for a task read in List `list` that has just come into it, or null when it does not belong there as a card. */
export function arrivalCard(body: TaskBody, list: LinkedList): BirdseyeCard | null {
  const row = rowFromBody(body, list.id);
  const item = body.item;
  if (!row || !item || item.archivedAt || item.parentItemId) return null;
  if (body.context?.kind === "linked") {
    const built = linkedCardFromRow(row, list);
    return built ? cardOf(built) : null;
  }
  return { ...cardFromRow(item), boardId: list.id, rank: bucketRank(list.statuses, item.status) };
}

/**
 * Does a column's loaded part reach a card? Everything, when the column has
 * no more pages; else only a card ordered before its last loaded one (the
 * rest come with Show more, in their own place, never twice).
 */
export function reachesLoaded(card: BirdseyeCard, cards: readonly BirdseyeCard[], nextCursor: string | null): boolean {
  if (!nextCursor) return true;
  const last = cards[cards.length - 1];
  return !!last && cardOrder(card, last) < 0;
}

/** A card put into a column's page in the loader's own order. */
export function insertInOrder(cards: readonly BirdseyeCard[], card: BirdseyeCard): BirdseyeCard[] {
  const at = cards.findIndex((c) => cardOrder(card, c) < 0);
  return at < 0 ? [...cards, card] : [...cards.slice(0, at), card, ...cards.slice(at)];
}
