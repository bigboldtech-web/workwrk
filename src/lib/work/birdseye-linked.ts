// Bird's eye, the tasks linked INTO a List from another (Phase 5b): the
// pure half, how one projected row becomes a card. The read is in
// src/lib/work/birdseye-linked.server.ts.
//
// THE BOARD'S OWN RULES. A card's column is boardStatusFor (the home value
// remapped into this List's set by value, words or group), its drag is the
// Board's linkedRowEditable and statusPickerFor, and its note is the Board's
// sentence, so a linked task sits, moves and reads the same in both views.

import {
  boardStatusFor,
  linkedRowEditable,
  linkedStatusNote,
  linkedStatusShort,
  optimisticLinkedStatus,
  statusPickerFor,
} from "@/lib/list-link-rows";
import { isDoneStatus, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import { bucketFor, bucketRank, cardFromRow, cardOrder, isClosedStatus, type BirdseyeCard } from "@/lib/work/birdseye";

export const LINKED_CAP = 500;

/** A linked card, with the column it sits in and whether Hide closed hides it. */
export interface LinkedCard extends BirdseyeCard {
  bucket: string;
  closed: boolean;
}

export interface LinkedList {
  id: string;
  statuses: StatusOption[];
  canContribute: boolean;
}

/**
 * Closed here: its column is closed in this List, or it is done in its home
 * set. The server's Hide closed and the client's counts both read this.
 */
function closedHere(homeStatus: StatusOption | null | undefined, statuses: readonly StatusOption[], bucket: string): boolean {
  if (isClosedStatus(statuses, bucket)) return true;
  return !!homeStatus && isDoneStatus([homeStatus], homeStatus.value);
}

/** The card for one projected linked root, shown in `list`. */
export function linkedCardFromRow(row: BoardItemRow, list: LinkedList): LinkedCard | null {
  const link = row.listLink;
  if (!link || link.boardId !== list.id || link.position == null) return null;
  const placed = boardStatusFor(row, list.id, list.statuses);
  const bucket = bucketFor(list.statuses, placed);
  const base = cardFromRow(row);
  return {
    ...base,
    boardId: list.id,
    status: placed,
    position: Number(link.position),
    rank: bucketRank(list.statuses, placed),
    subtaskCount: typeof row.subtaskCount === "number" ? row.subtaskCount : 0,
    linked: {
      listLink: link,
      homeValue: row.status ?? null,
      short: linkedStatusShort(row, list.id, list.statuses),
      note: linkedStatusNote(row, list.id, list.statuses),
      canDrag: linkedRowEditable(row, list.canContribute) && statusPickerFor(row, list.id, list.statuses).editable,
    },
    bucket,
    closed: closedHere(link.homeStatus, list.statuses, bucket),
  };
}

/** The card alone, without the server's bucket and closed flags, for a screen that holds it. */
export function cardOf(card: LinkedCard): BirdseyeCard {
  const { bucket: _bucket, closed: _closed, ...rest } = card;
  void _bucket;
  void _closed;
  return rest;
}

/** Does a card match the title search? The loader's ILIKE: one substring, any case. */
export function titleMatches(card: BirdseyeCard, q: string): boolean {
  return !q || card.title.toLowerCase().includes(q.toLowerCase());
}

/**
 * One List's linked cards for the view: the search and Hide closed applied,
 * in the loader's (column, position, id) order, at most LINKED_CAP of them.
 */
export function linkedCardsOfList(
  rows: readonly BoardItemRow[],
  list: LinkedList,
  filters: { q: string; hideClosed: boolean },
): { cards: LinkedCard[]; capped: boolean } {
  const cards: LinkedCard[] = [];
  for (const row of rows) {
    const card = linkedCardFromRow(row, list);
    if (!card || !titleMatches(card, filters.q) || (filters.hideClosed && card.closed)) continue;
    cards.push(card);
  }
  cards.sort(cardOrder);
  return { cards: cards.slice(0, LINKED_CAP), capped: cards.length > LINKED_CAP };
}

/**
 * How a status pick is meant. A column (a drop, or a pick from this List's
 * statuses) is the default; `home` is a status picked from a linked task's
 * own home set, the Board's status pill, written as it is.
 */
export interface StatusPick {
  home?: boolean;
}

/** The row the Board's helpers read for a linked card: the List it is shown in, its home value and its link here. */
export function linkedRowOf(card: BirdseyeCard): BoardItemRow {
  return { id: card.id, boardId: card.boardId, status: card.linked?.homeValue ?? null, listLink: card.linked?.listLink } as unknown as BoardItemRow;
}

/**
 * Is a card closed for this List's counts? A home card: its column is a
 * closed status. A linked card: the server's rule (closedHere), its column
 * is closed here or it is done in its home set, read at `column`.
 */
export function cardClosedHere(card: BirdseyeCard, statuses: readonly StatusOption[], column: string | null = card.status): boolean {
  const bucket = bucketFor(statuses, column);
  if (!card.linked) return isClosedStatus(statuses, column);
  return closedHere(card.linked.listLink.homeStatus, statuses, bucket);
}

/**
 * A linked card holding a new home value, before the write lands: its link
 * carries the new home status and its reason line is the one the Board
 * would show for it. Its column moves separately (the hook's move).
 */
export function withHomeValue(card: BirdseyeCard, list: LinkedList, homeValue: string): BirdseyeCard {
  if (!card.linked) return card;
  const row = optimisticLinkedStatus(linkedRowOf(card), homeValue);
  return {
    ...card,
    linked: {
      ...card.linked,
      homeValue,
      listLink: row.listLink ?? card.linked.listLink,
      short: linkedStatusShort(row, list.id, list.statuses),
      note: linkedStatusNote(row, list.id, list.statuses),
    },
  };
}

/** The column a home value lands in here, the Board's placement. */
export function columnForHomeValue(card: BirdseyeCard, list: LinkedList, homeValue: string): string | null {
  return boardStatusFor(optimisticLinkedStatus(linkedRowOf(card), homeValue), list.id, list.statuses);
}
