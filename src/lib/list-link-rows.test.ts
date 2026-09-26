import { describe, expect, it } from "vitest";
import type { BoardItemRow, StatusOption } from "./board-items-shared";
import {
  addLinkReasonMessage,
  boardStatusFor,
  distinctSectionLabels,
  homeStatusForBoardStatus,
  itemEventAction,
  itemsUrl,
  linkedMenuFlags,
  linkedRowAccess,
  linkedRowEditable,
  linkedRowKind,
  mergeRefetchedRow,
  optimisticLinkedStatus,
  planBulkStatus,
  reconcilePoll,
  refetchedFromRow,
  statusPickerFor,
  writeContext,
} from "./list-link-rows";
import { LIST_LINK_CANVAS_LIVE } from "./list-links";

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
  { value: "BUILDING", label: "Building", color: "#0073EA", group: "ACTIVE" },
  { value: "SHIPPED", label: "Shipped", color: "#15803D", group: "DONE" },
];

function row(over: Partial<BoardItemRow> = {}): BoardItemRow {
  return {
    id: "t1",
    title: "Task",
    status: "TO_DO",
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

function linkedRoot(over: Partial<BoardItemRow> = {}, link: Partial<NonNullable<BoardItemRow["listLink"]>> = {}): BoardItemRow {
  return row({
    status: "SHIPPED",
    // An unreadable home rewrites boardId to the context List: detection must
    // never rely on it.
    boardId: B,
    listLink: {
      boardId: B,
      position: 2048,
      rootId: "t1",
      homeList: { id: HOME, slug: "a", name: "List A" },
      homeStatus: HOME_STATUSES[2],
      homeStatuses: HOME_STATUSES,
      role: "EDIT",
      canRemove: true,
      canShare: true,
      ...link,
    },
    ...over,
  });
}

function linkedSubtask(over: Partial<BoardItemRow> = {}): BoardItemRow {
  return row({ id: "s1", parentItemId: "t1", status: "BUILDING", boardId: B, listLink: { boardId: B, position: null, rootId: "t1", role: "EDIT" }, ...over });
}

describe("linkedRowKind", () => {
  it("detects a linked root and a linked subtask even when boardId was rewritten to the context List", () => {
    expect(linkedRowKind(linkedRoot(), B)).toBe("linked-root");
    expect(linkedRowKind(linkedSubtask(), B)).toBe("linked-subtask");
  });
  it("reads a row with no link as a home row", () => {
    expect(linkedRowKind(row({ boardId: B }), B)).toBe("home");
    expect(linkedRowKind(row({ boardId: "elsewhere" }), B)).toBe("home");
  });
});

describe("linkedRowAccess", () => {
  const base = { orgAdmin: false, homeRole: "none" as const, assignee: false, creator: false, archived: false, contextContribute: false };
  it("gives VIEW to a reader who reaches the task only through the link", () => {
    expect(linkedRowAccess(base)).toEqual({ role: "VIEW", canRemove: false, canShare: false });
  });
  it("gives VIEW to a reader of the home List", () => {
    expect(linkedRowAccess({ ...base, homeRole: "VIEW" }).role).toBe("VIEW");
  });
  it("gives EDIT to a home contributor and to an assignee", () => {
    expect(linkedRowAccess({ ...base, homeRole: "EDIT" }).role).toBe("EDIT");
    expect(linkedRowAccess({ ...base, assignee: true }).role).toBe("EDIT");
  });
  it("gives FULL to the creator and to an org admin", () => {
    expect(linkedRowAccess({ ...base, creator: true }).role).toBe("FULL");
    expect(linkedRowAccess({ ...base, orgAdmin: true }).role).toBe("FULL");
  });
  it("caps an archived task at VIEW below FULL", () => {
    expect(linkedRowAccess({ ...base, homeRole: "EDIT", archived: true }).role).toBe("VIEW");
  });
  it("lets the task be removed through the context List or through the home", () => {
    expect(linkedRowAccess({ ...base, contextContribute: true }).canRemove).toBe(true);
    expect(linkedRowAccess({ ...base, homeRole: "EDIT" }).canRemove).toBe(true);
    expect(linkedRowAccess({ ...base, homeRole: "FULL" }).canRemove).toBe(true);
    expect(linkedRowAccess({ ...base, orgAdmin: true }).canRemove).toBe(true);
    // An assignee who writes neither List cannot pull it out of one.
    expect(linkedRowAccess({ ...base, assignee: true }).canRemove).toBe(false);
  });
  it("lets the task be shared further only through the home", () => {
    expect(linkedRowAccess({ ...base, contextContribute: true }).canShare).toBe(false);
    expect(linkedRowAccess({ ...base, assignee: true, creator: true }).canShare).toBe(false);
    expect(linkedRowAccess({ ...base, homeRole: "EDIT" }).canShare).toBe(true);
    expect(linkedRowAccess({ ...base, orgAdmin: true }).canShare).toBe(true);
  });
});

describe("linkedRowEditable", () => {
  it("is false for a VIEW role even when the viewer contributes to the List shown", () => {
    expect(linkedRowEditable(linkedRoot({}, { role: "VIEW" }), true)).toBe(false);
  });
  it("is false when the viewer cannot contribute to the List shown, whatever the task role", () => {
    expect(linkedRowEditable(linkedRoot({}, { role: "FULL" }), false)).toBe(false);
  });
  it("is true for EDIT and FULL in a List the viewer contributes to", () => {
    expect(linkedRowEditable(linkedRoot({}, { role: "EDIT" }), true)).toBe(true);
    expect(linkedRowEditable(linkedRoot({}, { role: "FULL" }), true)).toBe(true);
  });
  it("keeps a home row on the List's own flag", () => {
    expect(linkedRowEditable(row(), true)).toBe(true);
    expect(linkedRowEditable(row(), false)).toBe(false);
  });
  it("reads a linked row with no role as not editable", () => {
    expect(linkedRowEditable(linkedRoot({}, { role: undefined }), true)).toBe(false);
  });
});

describe("linkedMenuFlags", () => {
  it("never gives a linked subtask remove, link move or add-to-list", () => {
    const f = linkedMenuFlags(linkedSubtask({ listLink: { boardId: B, position: null, rootId: "t1", role: "FULL", canRemove: true, canShare: true } }), B, true, "u1");
    expect(f.linkedSubtask).toBe(true);
    expect(f.inSecondaryList).toBe(true);
    expect(f.canRemoveFromList).toBe(false);
    expect(f.canLinkMove).toBe(false);
    expect(f.canAddToList).toBe(false);
  });
  it("takes a linked root's role from the link, never from the List's flag", () => {
    const f = linkedMenuFlags(linkedRoot({}, { role: "VIEW", canRemove: false, canShare: false }), B, true, "u1");
    expect(f.role).toBe("VIEW");
    expect(f.canRemoveFromList).toBe(false);
    expect(f.canAddToList).toBe(false);
  });
  it("offers a linked root remove, link move and add-to-list only as far as its flags go", () => {
    const f = linkedMenuFlags(linkedRoot({}, { canRemove: true, canShare: false }), B, true, "u1");
    expect(f.canRemoveFromList).toBe(true);
    expect(f.canLinkMove).toBe(false);
    expect(f.canAddToList).toBe(false);
    const g = linkedMenuFlags(linkedRoot({}, { canRemove: true, canShare: true }), B, true, "u1");
    expect(g.canLinkMove).toBe(true);
    expect(g.canAddToList).toBe(true);
  });
  it("gives a home row add-to-list on the List's flag, never for a subtask or the Personal List", () => {
    expect(linkedMenuFlags(row(), B, true, "u1")).toMatchObject({ role: null, inSecondaryList: false, canAddToList: true });
    expect(linkedMenuFlags(row(), B, false, "u1").canAddToList).toBe(false);
    expect(linkedMenuFlags(row({ parentItemId: "p" }), B, true, "u1").canAddToList).toBe(false);
    expect(linkedMenuFlags(row(), B, true, "u1", { personalList: true }).canAddToList).toBe(false);
  });
  it("names the creator", () => {
    const r = linkedRoot({ createdBy: { id: "u1", firstName: "A", lastName: "B", avatar: null } });
    expect(linkedMenuFlags(r, B, true, "u1").isCreator).toBe(true);
    expect(linkedMenuFlags(r, B, true, "u2").isCreator).toBe(false);
  });
});

describe("itemEventAction", () => {
  it("drops on gone and on leftListIds naming the canvas", () => {
    expect(itemEventAction({ gone: true }, B, row())).toBe("drop");
    expect(itemEventAction({ leftListIds: [B] }, B, linkedRoot())).toBe("drop");
  });
  it("never drops a linked row because ev.boardId is its home", () => {
    expect(itemEventAction({ boardId: HOME }, B, linkedRoot())).toBe("refetch");
    expect(itemEventAction({ boardId: HOME, listIds: [HOME, B] }, B, linkedRoot())).toBe("refetch");
  });
  it("drops a linked row when listIds leaves the canvas out", () => {
    expect(itemEventAction({ boardId: HOME, listIds: [HOME] }, B, linkedRoot())).toBe("drop");
  });
  it("refetches a linked subtask", () => {
    expect(itemEventAction({ boardId: HOME, listIds: [HOME] }, B, linkedSubtask())).toBe("refetch");
  });
  it("drops a home row that moved elsewhere, and reloads when it still appears here", () => {
    expect(itemEventAction({ boardId: "C" }, B, row())).toBe("drop");
    expect(itemEventAction({ boardId: "C", listIds: ["C", B] }, B, row())).toBe("reload");
  });
  it("reloads for an unheld task whose listIds include the canvas, and ignores the rest", () => {
    expect(itemEventAction({ boardId: HOME, listIds: [HOME, B] }, B, undefined)).toBe("reload");
    expect(itemEventAction({ boardId: HOME, listIds: [HOME, B], gone: true }, B, undefined)).toBe("ignore");
    expect(itemEventAction({ boardId: HOME, listIds: [HOME, B], leftListIds: [B] }, B, undefined)).toBe("ignore");
    expect(itemEventAction({ boardId: HOME }, B, undefined)).toBe("ignore");
  });
  it("refetches a home row edited in place", () => {
    expect(itemEventAction({ boardId: B }, B, row())).toBe("refetch");
    expect(itemEventAction({}, B, row())).toBe("refetch");
  });
});

describe("mergeRefetchedRow", () => {
  const linkedBody = (over: Record<string, unknown> = {}) => ({
    item: { ...linkedRoot(), title: "Renamed", position: 4096, groupKey: "SHIPPED", boardId: HOME, status: "BUILDING", ...over },
    context: { boardId: B, kind: "linked" as const, homeStatus: HOME_STATUSES[1], homeStatuses: HOME_STATUSES },
    decision: { role: "FULL" as const },
  });

  it("drops the row on a 404", () => {
    expect(mergeRefetchedRow(linkedRoot(), null, B)).toEqual({ action: "drop" });
  });
  it("drops the row when the answer is for another List or for the home elsewhere", () => {
    expect(mergeRefetchedRow(linkedRoot(), { ...linkedBody(), context: { boardId: "C", kind: "linked" } }, B)).toEqual({ action: "drop" });
    expect(mergeRefetchedRow(row(), { item: row({ boardId: "C" }), context: { boardId: "C", kind: "home" } }, B)).toEqual({ action: "drop" });
  });
  it("keeps prev.boardId and listLink for a linked root, groupKey null, and refreshes homeStatus, homeStatuses and role", () => {
    const prev = linkedRoot();
    const out = mergeRefetchedRow(prev, linkedBody(), B);
    expect(out.action).toBe("merge");
    if (out.action !== "merge") return;
    expect(out.row.title).toBe("Renamed");
    expect(out.row.boardId).toBe(prev.boardId);
    expect(out.row.position).toBe(4096);
    expect(out.row.groupKey).toBeNull();
    expect(out.row.listLink?.boardId).toBe(B);
    expect(out.row.listLink?.homeList).toEqual(prev.listLink?.homeList);
    expect(out.row.listLink?.homeStatus).toEqual(HOME_STATUSES[1]);
    expect(out.row.listLink?.homeStatuses).toEqual(HOME_STATUSES);
    expect(out.row.listLink?.role).toBe("FULL");
    expect(out.row.listLink?.canRemove).toBe(true);
  });
  it("drops homeStatuses the body no longer carries", () => {
    const body = linkedBody();
    const out = mergeRefetchedRow(linkedRoot(), { ...body, context: { boardId: B, kind: "linked", homeStatus: HOME_STATUSES[0] } }, B);
    expect(out.action === "merge" && out.row.listLink?.homeStatuses).toBeUndefined();
  });
  it("merges a home row in a home body as today", () => {
    const prev = row({ commentCount: 3 });
    const out = mergeRefetchedRow(prev, { item: { ...row(), title: "New", boardId: B }, context: { boardId: B, kind: "home" } }, B);
    expect(out).toEqual({ action: "merge", row: { ...prev, title: "New", boardId: B } });
  });
  it("reloads the List on a kind change", () => {
    expect(mergeRefetchedRow(linkedRoot(), { item: row(), context: { boardId: B, kind: "home" } }, B)).toEqual({ action: "reload" });
    expect(mergeRefetchedRow(row(), linkedBody(), B)).toEqual({ action: "reload" });
  });
  it("reads a PATCH response row as a body through refetchedFromRow", () => {
    const fresh = linkedRoot({ title: "From PATCH" }, { position: 8192, homeStatus: HOME_STATUSES[0], role: "EDIT" });
    const out = mergeRefetchedRow(linkedRoot(), refetchedFromRow(fresh), B);
    expect(out.action === "merge" && out.row.title).toBe("From PATCH");
    expect(out.action === "merge" && out.row.position).toBe(8192);
    expect(out.action === "merge" && out.row.listLink?.homeStatus).toEqual(HOME_STATUSES[0]);
  });
});

describe("reconcilePoll", () => {
  it("drops a held linked row missing from the fresh answer", () => {
    const next = reconcilePoll([row({ id: "a" }), linkedRoot({ id: "l" })], [row({ id: "a" })]);
    expect(next?.map((r) => r.id)).toEqual(["a"]);
  });
  it("never drops a home row, which is what protects an optimistic add", () => {
    expect(reconcilePoll([row({ id: "a" }), row({ id: "optimistic" })], [row({ id: "a" })])).toBeNull();
  });
  it("replaces a linked row whose link position changed at an equal updatedAt", () => {
    const prev = linkedRoot({ id: "l" }, { position: 1024 });
    const fresh = linkedRoot({ id: "l" }, { position: 9999 });
    const next = reconcilePoll([prev], [fresh]);
    expect(next?.[0].listLink?.position).toBe(9999);
  });
  it("replaces a linked row whose home status changed at an equal updatedAt", () => {
    const next = reconcilePoll([linkedRoot({ id: "l" })], [linkedRoot({ id: "l" }, { homeStatus: HOME_STATUSES[0] })]);
    expect(next?.[0].listLink?.homeStatus?.value).toBe("BACKLOG");
  });
  it("replaces a linked row whose access changed at an equal updatedAt (a role just lowered)", () => {
    const held = linkedRoot({ id: "l" }, { role: "EDIT", canRemove: true, canShare: true });
    const lowered = linkedRoot({ id: "l" }, { role: "VIEW", canRemove: false, canShare: false });
    const next = reconcilePoll([held], [lowered]);
    expect(next?.[0].listLink?.role).toBe("VIEW");
    expect(next?.[0].listLink?.canRemove).toBe(false);
    // The home List unshared: no name and no home set any more.
    const unshared = linkedRoot({ id: "l" }, { homeList: null, homeStatuses: undefined });
    expect(reconcilePoll([held], [unshared])?.[0].listLink?.homeList).toBeNull();
    // Nothing changed: nothing to replace.
    expect(reconcilePoll([held], [linkedRoot({ id: "l" }, { role: "EDIT", canRemove: true, canShare: true })])).toBeNull();
  });
  it("replaces only strictly newer rows and appends new ones, as today", () => {
    const old = row({ id: "a", title: "old" });
    const same = row({ id: "a", title: "server" });
    expect(reconcilePoll([old], [same])).toBeNull();
    const newer = row({ id: "a", title: "newer", updatedAt: new Date("2026-09-02T00:00:00Z") });
    expect(reconcilePoll([old], [newer])?.[0].title).toBe("newer");
    expect(reconcilePoll([old], [old, row({ id: "b" })])?.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("status in a List the task is linked into", () => {
  it("boardStatusFor keeps a home 'Shipped' (DONE) in B's DONE status", () => {
    expect(boardStatusFor(linkedRoot(), B, B_STATUSES)).toBe("DONE");
  });
  it("boardStatusFor leaves a home row's status alone", () => {
    expect(boardStatusFor(row({ status: "DOING" }), B, B_STATUSES)).toBe("DOING");
  });
  it("homeStatusForBoardStatus maps B's column into the home set", () => {
    expect(homeStatusForBoardStatus(linkedRoot(), "DONE", B_STATUSES)).toBe("SHIPPED");
    expect(homeStatusForBoardStatus(row(), "DOING", B_STATUSES)).toBe("DOING");
  });
  it("homeStatusForBoardStatus is null without homeStatuses", () => {
    expect(homeStatusForBoardStatus(linkedRoot({}, { homeStatuses: undefined }), "DONE", B_STATUSES)).toBeNull();
    expect(homeStatusForBoardStatus(linkedSubtask(), "DONE", B_STATUSES)).toBeNull();
  });
  it("statusPickerFor offers the home set to a linked row and only it", () => {
    expect(statusPickerFor(linkedRoot(), B, B_STATUSES)).toEqual({ options: HOME_STATUSES, editable: true });
    expect(statusPickerFor(linkedRoot({}, { homeStatuses: undefined }), B, B_STATUSES)).toEqual({ options: B_STATUSES, editable: false });
    expect(statusPickerFor(row(), B, B_STATUSES)).toEqual({ options: B_STATUSES, editable: true });
  });
  it("optimisticLinkedStatus sets the status and the home status pill", () => {
    const out = optimisticLinkedStatus(linkedRoot(), "BUILDING");
    expect(out.status).toBe("BUILDING");
    expect(out.listLink?.homeStatus).toEqual(HOME_STATUSES[1]);
    expect(optimisticLinkedStatus(row(), "DOING").status).toBe("DOING");
  });
});

describe("writeContext", () => {
  it("is {} for a home row and names the canvas for every linked row, subtasks too", () => {
    expect(writeContext(row(), B)).toEqual({});
    expect(writeContext(linkedRoot(), B)).toEqual({ contextBoardId: B });
    expect(writeContext(linkedSubtask(), B)).toEqual({ contextBoardId: B });
  });
});

describe("planBulkStatus", () => {
  it("sends home rows the raw value, groups linked rows by their mapped home value and skips rows with no mapping", () => {
    const rows = [
      row({ id: "h1" }),
      row({ id: "h2" }),
      linkedRoot({ id: "l1" }),
      linkedRoot({ id: "l2" }),
      linkedRoot({ id: "l3" }, { homeStatuses: [{ value: "FIN", label: "Finished", color: "#000", group: "DONE" }] }),
      linkedRoot({ id: "x" }, { homeStatuses: undefined }),
    ];
    const plan = planBulkStatus(rows, "DONE", B, B_STATUSES);
    expect(plan.home).toEqual(["h1", "h2"]);
    expect(plan.linked).toEqual([
      { ids: ["l1", "l2"], status: "SHIPPED" },
      { ids: ["l3"], status: "FIN" },
    ]);
    expect(plan.skipped).toEqual(["x"]);
  });
});

describe("itemsUrl", () => {
  it("asks for the linked rows exactly while the switch is on", () => {
    expect(itemsUrl("b1")).toBe(LIST_LINK_CANVAS_LIVE ? "/api/boards/b1/items?links=1" : "/api/boards/b1/items");
  });
  it("carries links=1 now that the switch is on", () => {
    expect(LIST_LINK_CANVAS_LIVE).toBe(true);
    expect(itemsUrl("b1")).toContain("links=1");
  });
});

describe("addLinkReasonMessage", () => {
  it("turns every refusal into a sentence, never the code", () => {
    for (const reason of ["list_archived", "not_a_task_list", "personal_list", "item_not_found", "item_archived", "is_subtask", "already_home", "home_list_read_only", "too_many_lists", "home_changed", "something_new"]) {
      const s = addLinkReasonMessage(reason);
      expect(s).not.toBe(reason);
      expect(s).not.toMatch(/_/);
      expect(s.endsWith(".")).toBe(true);
    }
  });
});

describe("distinctSectionLabels", () => {
  it("keeps every heading's words and makes a repeated one a distinct key", () => {
    const out = distinctSectionLabels([
      { label: "Ops", options: [1] },
      { label: "Design", options: [2] },
      { label: "Ops", options: [3] },
      { options: [4] },
      { label: "Ops", options: [5] },
    ]);
    const labels = out.map((s) => s.label);
    expect(new Set(labels.filter(Boolean)).size).toBe(4);
    expect(labels.map((l) => l?.replace(/\u200B/g, ""))).toEqual(["Ops", "Design", "Ops", undefined, "Ops"]);
    expect(out.map((s) => s.options[0])).toEqual([1, 2, 3, 4, 5]);
  });
  it("leaves sections that are already distinct untouched", () => {
    const input = [{ label: "A", options: [] }, { label: "B", options: [] }];
    const out = distinctSectionLabels(input);
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(input[1]);
  });
});
