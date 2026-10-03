import { describe, expect, it } from "vitest";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import {
  LINKED_CAP,
  columnForHomeValue,
  linkedCardFromRow,
  linkedCardsOfList,
  linkedRowOf,
  withHomeValue,
  type LinkedList,
} from "./birdseye-linked";
import { BIRDSEYE_PAGE, afterListCursor, cardFromRow, cardOrder, mergeCardPage, type BirdseyeCard } from "./birdseye";

const B = "listB";
const HOME = "listA";

// List B's own statuses.
const B_STATUSES: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" },
  { value: "DOING", label: "Doing", color: "#0073EA", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#15803D", group: "DONE" },
];
// The home List's statuses: "Shipped" is its DONE status, a word B lacks.
const HOME_STATUSES: StatusOption[] = [
  { value: "BACKLOG", label: "Backlog", color: "#98A2B3", group: "ACTIVE" },
  { value: "DOING", label: "Doing", color: "#0073EA", group: "ACTIVE" },
  { value: "SHIPPED", label: "Shipped", color: "#15803D", group: "DONE" },
];

const LIST: LinkedList = { id: B, statuses: B_STATUSES, canContribute: true };

function row(over: Partial<BoardItemRow> = {}): BoardItemRow {
  return {
    id: "t1",
    title: "Task",
    status: "DOING",
    ownerId: null,
    assigneeIds: [],
    groupKey: null,
    position: 1024,
    metadata: {},
    archivedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    boardId: B,
    ...over,
  };
}

/** A task linked into B from List A, as listLinkedRootRows projects it. */
function linkedRoot(status: string, over: Partial<BoardItemRow> = {}, link: Partial<NonNullable<BoardItemRow["listLink"]>> = {}): BoardItemRow {
  return row({
    status,
    listLink: {
      boardId: B,
      position: 2048,
      rootId: over.id ?? "t1",
      homeList: { id: HOME, slug: "a", name: "List A" },
      homeStatus: HOME_STATUSES.find((s) => s.value === status) ?? null,
      homeStatuses: HOME_STATUSES,
      role: "EDIT",
      canRemove: true,
      canShare: true,
      ...link,
    },
    ...over,
  });
}

describe("linkedCardFromRow: a linked task sits, moves and reads as on the Board", () => {
  it("files a home status B shares under that same status, with nothing to explain", () => {
    const card = linkedCardFromRow(linkedRoot("DOING"), LIST)!;
    expect(card.boardId).toBe(B);
    expect(card.status).toBe("DOING");
    expect(card.bucket).toBe("DOING");
    expect(card.rank).toBe(1);
    expect(card.position).toBe(2048);
    expect(card.closed).toBe(false);
    expect(card.linked?.homeValue).toBe("DOING");
    expect(card.linked?.short).toBeNull();
    expect(card.linked?.note).toBeNull();
    expect(card.linked?.canDrag).toBe(true);
  });

  it("files a home status B lacks under the Board's nearest one and says why", () => {
    const card = linkedCardFromRow(linkedRoot("SHIPPED"), LIST)!;
    expect(card.status).toBe("DONE");
    expect(card.bucket).toBe("DONE");
    expect(card.rank).toBe(2);
    expect(card.closed).toBe(true);
    // The indicator already names List A, so the line is the status alone.
    expect(card.linked?.short).toBe("Shipped");
    expect(card.linked?.note).toBe("This task is Shipped in List A. This List has no Shipped status, so it shows under Done.");
    // The home value is kept: a drop maps from it, never from B's column.
    expect(card.linked?.homeValue).toBe("SHIPPED");
  });

  it("uses the link's position, never the task's position in its home List", () => {
    const card = linkedCardFromRow(linkedRoot("DOING", { position: 7 }, { position: 99 }), LIST)!;
    expect(card.position).toBe(99);
  });

  it("is no card for a subtask shown through its parent, or a link to another List", () => {
    expect(linkedCardFromRow(linkedRoot("DOING", {}, { position: null }), LIST)).toBeNull();
    expect(linkedCardFromRow(linkedRoot("DOING", {}, { boardId: "listC" }), LIST)).toBeNull();
    expect(linkedCardFromRow(row(), LIST)).toBeNull();
  });

  it("drags only by the Board's rule: contribute on B, at least EDIT on the task, and its home set known", () => {
    expect(linkedCardFromRow(linkedRoot("DOING", {}, { role: "VIEW" }), LIST)!.linked?.canDrag).toBe(false);
    expect(linkedCardFromRow(linkedRoot("DOING"), { ...LIST, canContribute: false })!.linked?.canDrag).toBe(false);
    expect(linkedCardFromRow(linkedRoot("DOING", {}, { homeStatuses: undefined }), LIST)!.linked?.canDrag).toBe(false);
    expect(linkedCardFromRow(linkedRoot("DOING", {}, { role: "FULL" }), LIST)!.linked?.canDrag).toBe(true);
  });

  it("counts a task done in its home as closed even where this List has no closed column", () => {
    const open: LinkedList = { id: B, statuses: B_STATUSES.slice(0, 2), canContribute: true };
    const card = linkedCardFromRow(linkedRoot("SHIPPED"), open)!;
    expect(["TO_DO", "DOING"]).toContain(card.bucket);
    expect(card.closed).toBe(true);
  });
});

describe("linkedCardsOfList", () => {
  const rows = [
    linkedRoot("SHIPPED", { id: "a", title: "Ship the deck" }, { position: 10 }),
    linkedRoot("DOING", { id: "b", title: "Draft the deck" }, { position: 30 }),
    linkedRoot("DOING", { id: "c", title: "Book the room" }, { position: 20 }),
    linkedRoot("BACKLOG", { id: "d", title: "Deck review" }, { position: 5 }),
  ];

  it("orders by column, then the link's position, then id, the loader's own order", () => {
    const { cards, capped } = linkedCardsOfList(rows, LIST, { q: "", hideClosed: false });
    expect(cards.map((c) => c.id)).toEqual(["d", "c", "b", "a"]);
    expect(capped).toBe(false);
  });

  it("applies the title search the loader's way: one substring, any case", () => {
    const { cards } = linkedCardsOfList(rows, LIST, { q: "DECK", hideClosed: false });
    expect(cards.map((c) => c.id)).toEqual(["d", "b", "a"]);
    expect(linkedCardsOfList(rows, LIST, { q: "the deck", hideClosed: false }).cards.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("hides closed tasks when Hide closed is on", () => {
    const { cards } = linkedCardsOfList(rows, LIST, { q: "", hideClosed: true });
    expect(cards.map((c) => c.id)).toEqual(["d", "c", "b"]);
  });

  it("shows at most LINKED_CAP and says that more exist", () => {
    const many = Array.from({ length: LINKED_CAP + 3 }, (_, i) => linkedRoot("DOING", { id: `t${String(i).padStart(4, "0")}` }, { position: i }));
    const { cards, capped } = linkedCardsOfList(many, LIST, { q: "", hideClosed: false });
    expect(cards).toHaveLength(LINKED_CAP);
    expect(capped).toBe(true);
    expect(linkedCardsOfList(many.slice(0, LINKED_CAP), LIST, { q: "", hideClosed: false }).capped).toBe(false);
  });
});

function card(id: string, rank: number, position: number): BirdseyeCard {
  return { id, boardId: B, title: id, status: null, position, rank, dueAt: null, hasDescription: false, subtaskCount: 0, assignees: [], assigneeCount: 0 };
}

describe("mergeCardPage: a merged column pages exactly like a statement's", () => {
  // Home rows answer like the statement: the smallest LIMIT (page + 1) after
  // the cursor. Linked cards are all known up front.
  const home: BirdseyeCard[] = [];
  for (let i = 0; i < 131; i += 1) home.push(card(`h${String(i).padStart(3, "0")}`, i % 3, Math.floor(i / 3) * 10));
  const extra: BirdseyeCard[] = [];
  // Some share a home row's exact (rank, position): the id breaks the tie.
  for (let i = 0; i < 47; i += 1) extra.push(card(`l${String(i).padStart(3, "0")}`, i % 3, Math.floor(i / 2) * 10 + (i % 4 === 0 ? 0 : 5)));
  const statement = (cursor: BirdseyeCard | null) =>
    [...home].sort(cardOrder).filter((c) => !cursor || afterListCursor(c, cursor)).slice(0, BIRDSEYE_PAGE + 1);

  it("walks every card once, in order, with no gap at any boundary", () => {
    const seen: string[] = [];
    let cursor: BirdseyeCard | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const rows = statement(cursor);
      const homeMore = rows.length > BIRDSEYE_PAGE;
      const c: BirdseyeCard | null = cursor;
      const page: { cards: BirdseyeCard[]; more: boolean } = mergeCardPage(rows.slice(0, BIRDSEYE_PAGE), homeMore, extra.filter((x) => !c || afterListCursor(x, c)));
      const { cards, more } = page;
      seen.push(...cards.map((x) => x.id));
      if (!more) break;
      cursor = cards[cards.length - 1];
    }
    const all = [...home, ...extra].sort(cardOrder).map((x) => x.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("says there is more when either side has more", () => {
    expect(mergeCardPage([card("h", 0, 1)], true, []).more).toBe(true);
    const fifty = Array.from({ length: BIRDSEYE_PAGE }, (_, i) => card(`h${i}`, 0, i));
    expect(mergeCardPage(fifty, false, [card("l", 0, 999)]).more).toBe(true);
    expect(mergeCardPage(fifty.slice(1), false, [card("l", 0, 999)]).more).toBe(false);
  });
});

describe("cardFromRow keeps a linked card where it is shown", () => {
  it("takes the answer's title and home value, never its home List, status or position", () => {
    const prev = linkedCardFromRow(linkedRoot("DOING"), LIST)!;
    const answer = { ...row({ id: "t1", title: "Renamed", status: "BACKLOG", boardId: HOME, position: 3 }) };
    const next = cardFromRow(answer, prev);
    expect(next.title).toBe("Renamed");
    expect(next.boardId).toBe(B);
    expect(next.status).toBe("DOING");
    expect(next.position).toBe(2048);
    expect(next.rank).toBe(prev.rank);
    expect(next.linked?.homeValue).toBe("BACKLOG");
  });
});

describe("a home status picked on a linked card, before the write lands", () => {
  it("lands where the Board places that home value", () => {
    const card = linkedCardFromRow(linkedRoot("DOING"), LIST)!;
    expect(columnForHomeValue(card, LIST, "SHIPPED")).toBe("DONE");
    expect(columnForHomeValue(card, LIST, "DOING")).toBe("DOING");
    expect(columnForHomeValue(card, LIST, "BACKLOG")).toBe("TO_DO");
  });

  it("shows the new home value and the Board's reason line for it at once", () => {
    const doing = linkedCardFromRow(linkedRoot("DOING"), LIST)!;
    const shipped = withHomeValue(doing, LIST, "SHIPPED");
    expect(shipped.linked?.homeValue).toBe("SHIPPED");
    expect(shipped.linked?.listLink.homeStatus?.value).toBe("SHIPPED");
    expect(shipped.linked?.short).toBe("Shipped");
    expect(shipped.linked?.note).toBe("This task is Shipped in List A. This List has no Shipped status, so it shows under Done.");
    // Back to a status B shares: nothing left to explain.
    const back = withHomeValue(shipped, LIST, "DOING");
    expect(back.linked?.short).toBeNull();
    expect(back.linked?.note).toBeNull();
    // Its column and drag are not this helper's: the hook moves the column.
    expect(back.status).toBe(doing.status);
    expect(back.linked?.canDrag).toBe(doing.linked?.canDrag);
  });

  it("leaves a home card alone", () => {
    const plain = card("h", 0, 1);
    expect(withHomeValue(plain, LIST, "DONE")).toBe(plain);
  });

  it("reads a linked card as the Board's row: its home value and its link here", () => {
    const c = linkedCardFromRow(linkedRoot("SHIPPED"), LIST)!;
    const r = linkedRowOf(c);
    expect(r.status).toBe("SHIPPED");
    expect(r.listLink?.boardId).toBe(B);
  });
});

