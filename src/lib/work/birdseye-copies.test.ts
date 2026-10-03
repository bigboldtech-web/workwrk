import { describe, expect, it } from "vitest";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { cardOrder, type BirdseyeCard } from "./birdseye";
import { linkedCardFromRow, type LinkedList } from "./birdseye-linked";
import {
  arrivalCard,
  copiesOf,
  copyKey,
  findCopy,
  focusColumnOf,
  insertInOrder,
  mapFocusCopy,
  mapOverviewCopy,
  pendingIn,
  reachesLoaded,
  refreshLinkedCopy,
  rowFromBody,
  shownStatusOf,
  type CopyColumn,
  type CopyFocus,
  type TaskBody,
} from "./birdseye-copies";

const A = "listA";
const B = "listB";
const STATUSES: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" },
  { value: "DOING", label: "Doing", color: "#0073EA", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#15803D", group: "DONE" },
];
const LIST_B: LinkedList = { id: B, statuses: STATUSES, canContribute: true };

function homeCard(id: string, status: string, position: number, boardId = A): BirdseyeCard {
  return { id, boardId, title: id, status, position, rank: STATUSES.findIndex((s) => s.value === status), dueAt: null, hasDescription: false, subtaskCount: 0, assignees: [], assigneeCount: 0 };
}

function linkedRow(id: string, status: string, position: number): BoardItemRow {
  return {
    id,
    title: id,
    status,
    ownerId: null,
    assigneeIds: [],
    groupKey: null,
    position,
    metadata: {},
    archivedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    boardId: B,
    listLink: {
      boardId: B,
      position,
      rootId: id,
      homeList: { id: A, slug: "a", name: "List A" },
      homeStatus: STATUSES.find((s) => s.value === status) ?? null,
      homeStatuses: STATUSES,
      role: "EDIT",
    },
  };
}

function linkedCard(id: string, status: string, position: number): BirdseyeCard {
  const c = linkedCardFromRow(linkedRow(id, status, position), LIST_B)!;
  const { bucket: _b, closed: _c, ...card } = c;
  void _b;
  void _c;
  return card;
}

const col = (cards: BirdseyeCard[]): CopyColumn => ({ cards, justAdded: [] });

/** GET /api/items/[id], as the route answers it. */
function body(over: { kind: "home" | "linked"; boardId: string; status?: string; position?: number; archivedAt?: string | null; parentItemId?: string | null; homeReadable?: boolean }): TaskBody {
  const status = over.status ?? "TO_DO";
  return {
    item: {
      id: "t1",
      title: "Renamed",
      status,
      boardId: over.kind === "home" ? over.boardId : A,
      position: over.position ?? 4096,
      assigneeIds: [],
      metadata: {},
      archivedAt: over.archivedAt ?? null,
      parentItemId: over.parentItemId ?? null,
    } as TaskBody["item"],
    context: {
      boardId: over.boardId,
      kind: over.kind,
      home: over.homeReadable === false ? { readable: false } : { id: A, slug: "a", name: "List A", readable: true },
      homeStatus: STATUSES.find((s) => s.value === status) ?? null,
      homeStatuses: STATUSES,
    },
    decision: { role: "EDIT" },
  };
}

describe("one task, two copies: each action touches only its own", () => {
  // t1 is homed in A and linked into B; both Lists are on screen.
  const home = homeCard("t1", "TO_DO", 1024);
  const linked = linkedCard("t1", "TO_DO", 2048);
  const orders: Array<[string, Record<string, CopyColumn>]> = [
    ["A before B", { [A]: col([home]), [B]: col([linked]) }],
    ["B before A", { [B]: col([linked]), [A]: col([home]) }],
  ];

  for (const [name, overview] of orders) {
    it(`finds and changes the copy in the List asked for (${name})`, () => {
      expect(findCopy(overview, null, A, "t1")).toBe(home);
      expect(findCopy(overview, null, B, "t1")).toBe(linked);
      expect(copiesOf(overview, null, "t1").map((c) => c.boardId).sort()).toEqual([A, B]);
      const next = mapOverviewCopy(overview, B, "t1", (c) => ({ ...c, status: "DONE" }));
      expect(next[A]).toBe(overview[A]);
      expect(findCopy(next, null, B, "t1")?.status).toBe("DONE");
      expect(shownStatusOf(next, null, A, "t1")).toBe("TO_DO");
      expect(shownStatusOf(next, null, B, "t1")).toBe("DONE");
      // Removing one copy leaves the other.
      const gone = mapOverviewCopy(overview, A, "t1", () => null);
      expect(findCopy(gone, null, A, "t1")).toBeNull();
      expect(findCopy(gone, null, B, "t1")).toBe(linked);
    });
  }

  it("keeps focus to the focused List's copy", () => {
    const focus: CopyFocus = { boardId: B, columns: { TO_DO: col([linked]) } };
    expect(mapFocusCopy(focus, A, "t1", () => null)).toBe(focus);
    expect(focusColumnOf(focus, A, "t1")).toBeNull();
    expect(focusColumnOf(focus, B, "t1")).toBe("TO_DO");
    expect(findCopy({}, focus, B, "t1")).toBe(linked);
    expect(findCopy({}, focus, A, "t1")).toBeNull();
  });

  it("keeps each copy's write in flight apart", () => {
    const pending = new Map([
      [copyKey(A, "t1"), "DONE"],
      [copyKey(B, "t1"), "DOING"],
      [copyKey(B, "t2"), null],
    ]);
    expect([...pendingIn(pending, A)]).toEqual([["t1", "DONE"]]);
    expect([...pendingIn(pending, B)]).toEqual([
      ["t1", "DOING"],
      ["t2", null],
    ]);
  });
});

describe("refreshLinkedCopy: a re-read of a linked copy", () => {
  const copy = linkedCard("t1", "TO_DO", 2048);

  it("keeps a copy that is still linked here, with its new title, home status and place", () => {
    const out = refreshLinkedCopy(copy, body({ kind: "linked", boardId: B, status: "DONE", position: 512 }), LIST_B);
    expect(out.action).toBe("merge");
    if (out.action !== "merge") return;
    expect(out.card.boardId).toBe(B);
    expect(out.card.title).toBe("Renamed");
    expect(out.card.status).toBe("DONE");
    expect(out.card.position).toBe(512);
    expect(out.card.linked?.homeValue).toBe("DONE");
    expect(out.card.linked?.listLink.homeList?.name).toBe("List A");
  });

  it("drops it when the answer is for another List (unlinked here), or the task is archived or now a subtask", () => {
    expect(refreshLinkedCopy(copy, body({ kind: "home", boardId: A }), LIST_B).action).toBe("drop");
    expect(refreshLinkedCopy(copy, body({ kind: "linked", boardId: B, archivedAt: "2026-10-03T00:00:00Z" }), LIST_B).action).toBe("drop");
    expect(refreshLinkedCopy(copy, body({ kind: "linked", boardId: B, parentItemId: "p1" }), LIST_B).action).toBe("drop");
    expect(refreshLinkedCopy(copy, {}, LIST_B).action).toBe("drop");
  });

  it("names the home List only while the fresh answer lets the viewer read it", () => {
    const named = refreshLinkedCopy(copy, body({ kind: "linked", boardId: B, homeReadable: true }), LIST_B);
    expect(named.action === "merge" && named.card.linked?.listLink.homeList?.name).toBe("List A");
    // Access to the home was taken away while the view was open.
    const lost = refreshLinkedCopy(copy, body({ kind: "linked", boardId: B, homeReadable: false }), LIST_B);
    expect(lost.action).toBe("merge");
    if (lost.action === "merge") expect(lost.card.linked?.listLink.homeList).toBeUndefined();
  });

  it("asks for the view to be re-read when the task is now homed in this very List", () => {
    expect(refreshLinkedCopy(copy, body({ kind: "home", boardId: B }), LIST_B).action).toBe("reload");
  });
});

describe("a task that arrives in a List on screen", () => {
  it("builds a linked card from the body, naming the home only when the viewer may know it", () => {
    const named = arrivalCard(body({ kind: "linked", boardId: B, position: 3000 }), LIST_B)!;
    expect(named.boardId).toBe(B);
    expect(named.position).toBe(3000);
    expect(named.linked?.listLink.homeList?.name).toBe("List A");
    const bare = arrivalCard(body({ kind: "linked", boardId: B, homeReadable: false }), LIST_B)!;
    expect(bare.linked?.listLink.homeList).toBeUndefined();
    expect(rowFromBody(body({ kind: "linked", boardId: B }), B)?.listLink?.role).toBe("EDIT");
  });

  it("builds a home card for a task that moved here, and nothing for a body about another List, a subtask or an archived task", () => {
    const moved = arrivalCard(body({ kind: "home", boardId: B, status: "DOING" }), LIST_B)!;
    expect(moved.linked).toBeUndefined();
    expect(moved.boardId).toBe(B);
    expect(moved.rank).toBe(1);
    expect(arrivalCard(body({ kind: "home", boardId: A }), LIST_B)).toBeNull();
    expect(arrivalCard(body({ kind: "linked", boardId: B, parentItemId: "p1" }), LIST_B)).toBeNull();
    expect(arrivalCard(body({ kind: "linked", boardId: B, archivedAt: "2026-10-03T00:00:00Z" }), LIST_B)).toBeNull();
  });

  it("lands only where the loaded pages reach, in the loader's order", () => {
    const loaded = [homeCard("a", "TO_DO", 100, B), homeCard("c", "TO_DO", 300, B)];
    const early = homeCard("b", "TO_DO", 200, B);
    const late = homeCard("z", "DONE", 50, B);
    // Every page loaded: it belongs whatever its place.
    expect(reachesLoaded(late, loaded, null)).toBe(true);
    // More to come: only a card before the last loaded one is placed now.
    expect(reachesLoaded(early, loaded, "cursor")).toBe(true);
    expect(reachesLoaded(late, loaded, "cursor")).toBe(false);
    expect(insertInOrder(loaded, early).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(insertInOrder(loaded, late).map((c) => c.id)).toEqual(["a", "c", "z"]);
    expect(cardOrder(early, loaded[1])).toBeLessThan(0);
  });
});
