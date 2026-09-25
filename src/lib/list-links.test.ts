import { describe, expect, it } from "vitest";
import {
  buildListScopeWhere,
  contextBoardFor,
  decideAddLink,
  decideContext,
  decideLinkRemoval,
  isMissingListLinkTableError,
  linkToDropOnMove,
  mergeListFacetCounts,
  mergeListTaskCounts,
  nextListPosition,
  validateLinkedStatus,
  LIST_LINK_SCOPE_MAX,
  MAX_LISTS_PER_ITEM,
  type AddLinkItem,
  type AddLinkTarget,
} from "./list-links";
import type { StatusOption } from "./board-items-shared";

describe("buildListScopeWhere", () => {
  it("is EXACTLY today's clause when there are no linked ids", () => {
    expect(buildListScopeWhere(["a", "b"], null)).toEqual({ boardId: { in: ["a", "b"] } });
    expect(buildListScopeWhere(["a", "b"], [])).toEqual({ boardId: { in: ["a", "b"] } });
  });

  it("ORs the linked ids in, deduplicated", () => {
    expect(buildListScopeWhere(["a"], ["x", "y", "x"])).toEqual({
      OR: [{ boardId: { in: ["a"] } }, { id: { in: ["x", "y"] } }],
    });
  });

  it("matches nothing for no Lists, even with linked ids", () => {
    expect(buildListScopeWhere([], ["x"])).toEqual({ boardId: { in: [] } });
    expect(buildListScopeWhere([], null)).toEqual({ boardId: { in: [] } });
  });

  it("stays inline past 5000 ids: the nested relation form could not require the SAME home", () => {
    const many = Array.from({ length: 5001 }, (_, i) => `i${i}`);
    const w = buildListScopeWhere(["a"], many) as { OR: Array<Record<string, unknown>> };
    expect(w).toEqual({ OR: [{ boardId: { in: ["a"] } }, { id: { in: many } }] });
    // No branch may reach tasks through a parent chain: that is the form that
    // handed a subtask moved alone into an unreadable List to the viewer.
    expect(JSON.stringify(w)).not.toContain("parentItem");
    expect(JSON.stringify(w)).not.toContain("otherLists");
  });

  it("cuts deterministically at the ceiling and never widens the clause", () => {
    const ids = ["d", "b", "c", "a", "e"];
    const w = buildListScopeWhere(["L"], ids, 3) as { OR: Array<Record<string, unknown>> };
    expect(w).toEqual({ OR: [{ boardId: { in: ["L"] } }, { id: { in: ["a", "b", "c"] } }] });
    expect(buildListScopeWhere(["L"], ids, 0)).toEqual({ boardId: { in: ["L"] } });
    // The default ceiling keeps every id at the size an enterprise org reaches
    // before it, well under Postgres's bind-parameter limit.
    expect(LIST_LINK_SCOPE_MAX).toBeLessThan(65_535 / 2);
    const atMax = Array.from({ length: LIST_LINK_SCOPE_MAX }, (_, i) => `i${i}`);
    expect((buildListScopeWhere(["a"], atMax) as { OR: Array<{ id?: { in: string[] } }> }).OR[1].id!.in).toHaveLength(LIST_LINK_SCOPE_MAX);
  });
});

describe("contextBoardFor", () => {
  it("prefers the home List whenever it is in scope", () => {
    expect(contextBoardFor("home", ["b1", "b2"], new Set(["home", "b1"]))).toEqual({ boardId: "home", via: "home" });
  });
  it("falls back to the oldest link in scope", () => {
    expect(contextBoardFor("home", ["b1", "b2"], new Set(["b2", "b1"]))).toEqual({ boardId: "b1", via: "linked" });
    expect(contextBoardFor("home", ["b1", "b2"], new Set(["b2"]))).toEqual({ boardId: "b2", via: "linked" });
  });
  it("answers null rather than labelling with an unreadable home", () => {
    expect(contextBoardFor("home", ["b1"], new Set(["other"]))).toBeNull();
    expect(contextBoardFor("home", [], new Set())).toBeNull();
  });
});

describe("decideContext", () => {
  const base = { homeBoardId: "home", linkedBoardIds: ["b1"] };
  it("is home for no context and for the home id", () => {
    expect(decideContext({ ...base, requested: undefined, requestedReadable: false })).toBe("home");
    expect(decideContext({ ...base, requested: null, requestedReadable: false })).toBe("home");
    expect(decideContext({ ...base, requested: "home", requestedReadable: false })).toBe("home");
  });
  it("is linked for a readable List the task is in", () => {
    expect(decideContext({ ...base, requested: "b1", requestedReadable: true })).toBe("linked");
  });
  it("gives ONE answer for an unreadable linked List and a List the task is not in", () => {
    const unreadable = decideContext({ ...base, requested: "b1", requestedReadable: false });
    const notIn = decideContext({ ...base, requested: "b9", requestedReadable: true });
    expect(unreadable).toBe("invalid");
    expect(notIn).toBe("invalid");
  });
});

describe("decideAddLink", () => {
  const target: AddLinkTarget = { organizationId: "org", archivedAt: null, itemType: "studio-item", productSlug: null, settings: {} };
  const item: AddLinkItem = { organizationId: "org", boardId: "home", itemType: "studio-item", archivedAt: null, parentItemId: null, homeArchived: false };
  const base = { orgId: "org", target, item, readable: true, targetId: "B", alreadyLinked: false, linkCount: 0, canContributeHome: true };

  it("adds a readable top-level task", () => {
    expect(decideAddLink(base)).toEqual({ ok: true, idempotent: false });
  });
  it("refuses an archived List, a non-task List and a personal List", () => {
    expect(decideAddLink({ ...base, target: { ...target, archivedAt: new Date() } })).toEqual({ ok: false, reason: "list_archived" });
    expect(decideAddLink({ ...base, target: { ...target, itemType: "deal" } })).toEqual({ ok: false, reason: "not_a_task_list" });
    expect(decideAddLink({ ...base, target: { ...target, settings: { system: true } } })).toEqual({ ok: false, reason: "not_a_task_list" });
    expect(decideAddLink({ ...base, target: { ...target, productSlug: "personal-list" } })).toEqual({ ok: false, reason: "personal_list" });
  });
  it("says item_not_found for an unreadable, system or cross-org task BEFORE any other reason", () => {
    // Every other fact is also true here, and none of them may be the answer.
    const loud = { ...item, archivedAt: new Date(), parentItemId: "p", boardId: "B" };
    const everything = { ...base, item: loud, alreadyLinked: true, linkCount: 99, canContributeHome: false };
    expect(decideAddLink({ ...everything, readable: false })).toEqual({ ok: false, reason: "item_not_found" });
    expect(decideAddLink({ ...everything, item: { ...loud, itemType: "meeting" } })).toEqual({ ok: false, reason: "item_not_found" });
    expect(decideAddLink({ ...everything, item: { ...loud, organizationId: "other" } })).toEqual({ ok: false, reason: "item_not_found" });
    expect(decideAddLink({ ...base, item: null })).toEqual({ ok: false, reason: "item_not_found" });
  });
  it("refuses in the documented order after readability", () => {
    expect(decideAddLink({ ...base, item: { ...item, archivedAt: new Date(), parentItemId: "p" } })).toEqual({ ok: false, reason: "item_archived" });
    expect(decideAddLink({ ...base, item: { ...item, homeArchived: true } })).toEqual({ ok: false, reason: "item_archived" });
    // A Personal List's task is private to its owner: never linked elsewhere.
    expect(decideAddLink({ ...base, item: { ...item, homePersonal: true } })).toEqual({ ok: false, reason: "personal_list" });
    expect(decideAddLink({ ...base, item: { ...item, parentItemId: "p", boardId: "B" } })).toEqual({ ok: false, reason: "is_subtask" });
    expect(decideAddLink({ ...base, item: { ...item, boardId: "B" }, canContributeHome: false })).toEqual({ ok: false, reason: "already_home" });
    expect(decideAddLink({ ...base, canContributeHome: false, alreadyLinked: true })).toEqual({ ok: false, reason: "home_list_read_only" });
  });
  it("is idempotent for a re-add, even at the cap", () => {
    expect(decideAddLink({ ...base, alreadyLinked: true, linkCount: MAX_LISTS_PER_ITEM })).toEqual({ ok: true, idempotent: true });
  });
  it("refuses a twenty-first List", () => {
    expect(decideAddLink({ ...base, linkCount: MAX_LISTS_PER_ITEM })).toEqual({ ok: false, reason: "too_many_lists" });
    expect(decideAddLink({ ...base, linkCount: MAX_LISTS_PER_ITEM - 1 })).toEqual({ ok: true, idempotent: false });
  });
});

describe("decideLinkRemoval", () => {
  it("answers 404 for an unreadable List even when the link exists", () => {
    expect(decideLinkRemoval({ listReadable: false, linkExists: true, canContributeList: true, canContributeHome: true })).toBe(404);
  });
  it("answers 404 for a missing link", () => {
    expect(decideLinkRemoval({ listReadable: true, linkExists: false, canContributeList: true, canContributeHome: true })).toBe(404);
  });
  it("answers 403 only for a reader who writes to neither side", () => {
    expect(decideLinkRemoval({ listReadable: true, linkExists: true, canContributeList: false, canContributeHome: false })).toBe(403);
    expect(decideLinkRemoval({ listReadable: true, linkExists: true, canContributeList: true, canContributeHome: false })).toBe("ok");
    expect(decideLinkRemoval({ listReadable: true, linkExists: true, canContributeList: false, canContributeHome: true })).toBe("ok");
  });
});

describe("validateLinkedStatus", () => {
  const home: StatusOption[] = [
    { value: "TO_DO", label: "To Do", color: "#000", group: "ACTIVE" },
    { value: "SHIPPED", label: "Shipped", color: "#000", group: "DONE" },
  ];
  it("passes an absent value, a clear and the unchanged current value", () => {
    expect(validateLinkedStatus(undefined, home, "WEIRD", true)).toEqual({ ok: true });
    expect(validateLinkedStatus(null, home, "WEIRD", true)).toEqual({ ok: true });
    expect(validateLinkedStatus("WEIRD", home, "WEIRD", true)).toEqual({ ok: true });
  });
  it("lets a task with no links take anything, as today", () => {
    expect(validateLinkedStatus("ANYTHING", home, "TO_DO", false)).toEqual({ ok: true });
  });
  it("refuses a linked task a status outside its home set", () => {
    expect(validateLinkedStatus("IN_REVIEW", home, "TO_DO", true)).toEqual({ ok: false, reason: "not_in_home_list" });
    expect(validateLinkedStatus("SHIPPED", home, "TO_DO", true)).toEqual({ ok: true });
  });
});

describe("nextListPosition", () => {
  it("starts an empty List at one step", () => {
    expect(nextListPosition(null, null)).toBe(1024);
  });
  it("appends after the larger maximum, never equal to either", () => {
    const a = nextListPosition(5000, 9000);
    const b = nextListPosition(9000, 5000);
    expect(a).toBe(10024);
    expect(b).toBe(10024);
    expect(a).toBeGreaterThan(9000);
    expect(nextListPosition(-3000, null)).toBe(-1976);
    expect(nextListPosition(null, 2048)).toBe(3072);
  });
});

describe("linkToDropOnMove", () => {
  const links = [
    { itemId: "root", boardId: "B" },
    { itemId: "root", boardId: "C" },
    { itemId: "other", boardId: "B" },
  ];
  it("drops only the root's link into the target", () => {
    expect(linkToDropOnMove(links, "root", "B")).toEqual({ itemId: "root", boardId: "B" });
    expect(linkToDropOnMove(links, "root", "Z")).toBeNull();
    expect(linkToDropOnMove(links, "child", "B")).toBeNull();
  });
});

describe("mergeListTaskCounts", () => {
  const doneIn: Record<string, string[]> = { A: ["SHIPPED"], B: ["DONE"] };
  const isDone = (board: string, status: string | null) => !!status && (doneIn[board] ?? []).includes(status);

  it("counts a linked task done by its HOME status set", () => {
    const m = mergeListTaskCounts(
      [{ boardId: "B", status: "DONE", count: 2 }, { boardId: "B", status: "TO_DO", count: 1 }],
      [{ listId: "B", itemId: "t1", homeBoardId: "A", status: "SHIPPED" }],
      isDone,
    );
    expect(m.get("B")).toEqual({ total: 4, open: 1, done: 3 });
  });
  it("ignores a stale self-link and counts a task once per List", () => {
    const m = mergeListTaskCounts(
      [],
      [
        { listId: "A", itemId: "t1", homeBoardId: "A", status: "SHIPPED" },
        { listId: "B", itemId: "t1", homeBoardId: "A", status: "TO_DO" },
        { listId: "B", itemId: "t1", homeBoardId: "A", status: "TO_DO" },
        { listId: "C", itemId: "t1", homeBoardId: "A", status: "TO_DO" },
      ],
      isDone,
    );
    expect(m.get("A")).toBeUndefined();
    expect(m.get("B")).toEqual({ total: 1, open: 1, done: 0 });
    expect(m.get("C")).toEqual({ total: 1, open: 1, done: 0 });
  });
  it("adds pre-counted groups as they are, done by the HOME set, past any row ceiling", () => {
    const m = mergeListTaskCounts(
      [{ boardId: "B", status: "TO_DO", count: 1 }],
      [
        { listId: "B", homeBoardId: "A", status: "SHIPPED", count: 40_000 },
        { listId: "B", homeBoardId: "A", status: "TO_DO", count: 12_345 },
        { listId: "A", homeBoardId: "A", status: "TO_DO", count: 9 },
        { listId: "C", homeBoardId: "A", status: "TO_DO", count: 0 },
      ],
      isDone,
    );
    expect(m.get("B")).toEqual({ total: 52_346, open: 12_346, done: 40_000 });
    expect(m.get("A")).toBeUndefined();
    expect(m.get("C")).toBeUndefined();
  });
});

describe("mergeListFacetCounts", () => {
  it("never names an unreadable home List and adds link counts onto readable Lists", () => {
    const out = mergeListFacetCounts(
      [{ boardId: "private", count: 3 }, { boardId: "B", count: 2 }],
      [{ boardId: "B", count: 3 }, { boardId: "hidden", count: 9 }],
      new Set(["B"]),
    );
    expect(out).toEqual([{ boardId: "B", count: 5 }]);
    expect(JSON.stringify(out)).not.toContain("private");
  });
});

describe("isMissingListLinkTableError", () => {
  it("recognises the missing table from the client, a raw query and the adapter", () => {
    expect(isMissingListLinkTableError({ code: "P2021", meta: { table: "public.ItemListLink" }, message: "The table `public.ItemListLink` does not exist in the current database." })).toBe(true);
    expect(isMissingListLinkTableError({ code: "P2010", meta: { code: "42P01", message: 'relation "ItemListLink" does not exist' }, message: "Raw query failed." })).toBe(true);
    expect(isMissingListLinkTableError(new Error('relation "ItemListLink" does not exist'))).toBe(true);
  });
  it("recognises a client that does not know the relation fields", () => {
    const e = Object.assign(new Error("Unknown argument `otherLists`. Available options are marked with ?."), { name: "PrismaClientValidationError" });
    expect(isMissingListLinkTableError(e)).toBe(true);
    const f = Object.assign(new Error("Unknown field `linkedItems` for include statement"), { name: "PrismaClientValidationError" });
    expect(isMissingListLinkTableError(f)).toBe(true);
  });
  it("is false for another missing table and for any other failure", () => {
    expect(isMissingListLinkTableError({ code: "P2021", meta: { table: "public.ReportSchedule" }, message: "The table `public.ReportSchedule` does not exist" })).toBe(false);
    expect(isMissingListLinkTableError({ code: "P2002", meta: { target: ["itemId", "boardId"], modelName: "ItemListLink" }, message: "Unique constraint failed" })).toBe(false);
    expect(isMissingListLinkTableError(null)).toBe(false);
    expect(isMissingListLinkTableError("ItemListLink")).toBe(false);
    const v = Object.assign(new Error("Unknown argument `title`."), { name: "PrismaClientValidationError" });
    expect(isMissingListLinkTableError(v)).toBe(false);
  });
});
