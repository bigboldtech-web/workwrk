import { describe, expect, it } from "vitest";
import type { BoardItemRow, StatusOption } from "./board-items-shared";
import {
  boardStatusPlacement,
  bulkStatusSkipMessage,
  computedCellValue,
  computedFieldsKey,
  homeStatusForBoardStatus,
  homeStatusTarget,
  linkedStatusNote,
  linkedStatusRefusal,
  planBulkStatus,
  reconcilePoll,
} from "./list-link-rows";

// The Phase 5b screens walk (group 9): the exact Lists the walk used.
const SHARED = "ml-walk-shared";
const HOME = "ml-walk-open-home";

// ML walk Shared, the List the task is shown in.
const SHARED_STATUSES: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "In Progress", color: "#0073EA", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#15803D", group: "DONE" },
];
// ML walk Open Home, the task's home: no In Progress, an In review instead.
const HOME_STATUSES: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#98A2B3", group: "ACTIVE" },
  { value: "REVIEW", label: "In review", color: "#F59E0B", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#15803D", group: "DONE" },
];

function row(over: Partial<BoardItemRow> = {}): BoardItemRow {
  return {
    id: "c",
    title: "ML open home task C",
    status: "TO_DO",
    ownerId: null,
    assigneeIds: [],
    groupKey: null,
    position: 1024,
    metadata: {},
    archivedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    boardId: SHARED,
    ...over,
  };
}

function shared(status: string, over: Partial<BoardItemRow> = {}, link: Partial<NonNullable<BoardItemRow["listLink"]>> = {}): BoardItemRow {
  return row({
    status,
    listLink: {
      boardId: SHARED,
      position: 2048,
      rootId: over.id ?? "c",
      homeList: { id: HOME, slug: HOME, name: "ML walk Open Home" },
      homeStatus: HOME_STATUSES.find((s) => s.value === status) ?? null,
      homeStatuses: HOME_STATUSES,
      role: "FULL",
      canRemove: true,
      canShare: true,
      ...link,
    },
    ...over,
  });
}

describe("a drop on a column the home List has no status for", () => {
  it("is refused, never written as the home's first Active status", () => {
    // The walk: a Done card dropped on In Progress PATCHed status TO_DO.
    expect(homeStatusTarget(shared("DONE"), "IN_PROGRESS", SHARED_STATUSES)).toEqual({ ok: false, reason: "no_equivalent" });
    expect(homeStatusForBoardStatus(shared("DONE"), "IN_PROGRESS", SHARED_STATUSES)).toBeNull();
  });
  it("still writes every column that lands back where it was dropped", () => {
    expect(homeStatusTarget(shared("DONE"), "TO_DO", SHARED_STATUSES)).toEqual({ ok: true, status: "TO_DO" });
    expect(homeStatusTarget(shared("TO_DO"), "DONE", SHARED_STATUSES)).toEqual({ ok: true, status: "DONE" });
    // A group mapping that round-trips is faithful: B's Done is a home "Shipped".
    const shipped: StatusOption[] = [
      { value: "OPEN", label: "Open", color: "#98A2B3", group: "ACTIVE" },
      { value: "SHIPPED", label: "Shipped", color: "#15803D", group: "DONE" },
    ];
    expect(homeStatusTarget(shared("OPEN", {}, { homeStatuses: shipped, homeStatus: shipped[0] }), "DONE", SHARED_STATUSES)).toEqual({ ok: true, status: "SHIPPED" });
  });
  it("says home_unknown when the home set is not shared, and a home row writes the raw value", () => {
    expect(homeStatusTarget(shared("DONE", {}, { homeStatuses: undefined }), "DONE", SHARED_STATUSES)).toEqual({ ok: false, reason: "home_unknown" });
    expect(homeStatusTarget(row(), "IN_PROGRESS", SHARED_STATUSES)).toEqual({ ok: true, status: "IN_PROGRESS" });
  });
  it("names the home List and the column in the refusal", () => {
    expect(linkedStatusRefusal(shared("DONE"), "In Progress", "no_equivalent")).toBe(
      "ML walk Open Home has no In Progress status, so this task can't go in In Progress here. Open the task to pick one of its own statuses.",
    );
    expect(linkedStatusRefusal(shared("DONE", {}, { homeList: null }), "In Progress", "no_equivalent")).toMatch(/^This task's home List has no In Progress/);
  });
});

describe("planBulkStatus with a target the home List lacks", () => {
  it("skips and names those rows instead of writing a status nobody picked", () => {
    const rows = [row({ id: "h", listLink: undefined }), shared("DONE", { id: "l1" }), shared("DONE", { id: "x" }, { homeStatuses: undefined })];
    const plan = planBulkStatus(rows, "IN_PROGRESS", SHARED, SHARED_STATUSES);
    expect(plan.home).toEqual(["h"]);
    expect(plan.linked).toEqual([]);
    expect(plan.skipped).toEqual(["l1", "x"]);
    expect(plan.unmatched).toEqual(["l1"]);
    expect(bulkStatusSkipMessage(plan, "In Progress")).toBe(
      "1 task from another List wasn't changed because its home List's statuses aren't shared with you. 1 task from another List wasn't changed because its home List has no In Progress status.",
    );
    expect(bulkStatusSkipMessage({ skipped: [], unmatched: [] }, "Done")).toBe("");
  });
});

describe("a linked row filed under a status that is not its own", () => {
  it("is placed under the nearest status and explained", () => {
    const c = shared("REVIEW");
    expect(boardStatusPlacement(c, SHARED, SHARED_STATUSES)).toEqual({ status: "TO_DO", exact: false, home: HOME_STATUSES[1] });
    expect(linkedStatusNote(c, SHARED, SHARED_STATUSES)).toBe(
      "This task is In review in ML walk Open Home. This List has no In review status, so it shows under To Do.",
    );
  });
  it("says nothing when the List holds the status itself, or for a home row", () => {
    expect(linkedStatusNote(shared("DONE"), SHARED, SHARED_STATUSES)).toBeNull();
    expect(boardStatusPlacement(shared("DONE"), SHARED, SHARED_STATUSES).exact).toBe(true);
    expect(linkedStatusNote(row({ status: "IN_PROGRESS" }), SHARED, SHARED_STATUSES)).toBeNull();
  });
});

describe("reconcilePoll and computed cells", () => {
  const host = (over: Partial<BoardItemRow> = {}) =>
    row({
      id: "host",
      title: "Host One",
      metadata: { conn: ["t1"] },
      connections: { conn: [{ id: "t1", title: "Open Alpha", statusLabel: "To Do", statusColor: "#98A2B3", done: false }] },
      mirrors: { budget_mirror: { values: [100] } },
      ...over,
    });
  it("takes fresh mirror values at an equal updatedAt", () => {
    const fresh = host({ mirrors: { budget_mirror: { values: [101] } } });
    const next = reconcilePoll([host()], [fresh]);
    expect(next).not.toBeNull();
    expect(next![0].mirrors).toEqual({ budget_mirror: { values: [101] } });
  });
  it("takes a connected task's new title, and nothing else of the row", () => {
    const held = host({ title: "Host One (typing)" });
    const fresh = host({ connections: { conn: [{ id: "t1", title: "Open Alpha Renamed", statusLabel: "To Do", statusColor: "#98A2B3", done: false }] } });
    const next = reconcilePoll([held], [fresh]);
    expect(next![0].connections?.conn[0].title).toBe("Open Alpha Renamed");
    expect(next![0].title).toBe("Host One (typing)");
  });
  it("fills a new Mirror column the held rows never had", () => {
    const next = reconcilePoll([host({ mirrors: undefined })], [host()]);
    expect(next![0].mirrors).toEqual({ budget_mirror: { values: [100] } });
  });
  it("leaves the chips of a connect edit still in flight alone", () => {
    const held = host({ metadata: { conn: ["t1", "t2"] } });
    const fresh = host({ mirrors: { budget_mirror: { values: [5] } } });
    expect(reconcilePoll([held], [fresh])).toBeNull();
  });
  it("is null when nothing computed changed", () => {
    expect(reconcilePoll([host()], [host()])).toBeNull();
  });
});

describe("computedCellValue, for sorting and grouping connect and mirror columns", () => {
  it("reads a mirror's rollup, else its first value, keeping numbers numbers", () => {
    expect(computedCellValue(row({ mirrors: { m: { values: [250, 999], rollup: 1249 } } }), "m")).toBe(1249);
    expect(computedCellValue(row({ mirrors: { m: { values: [null, 100, 250] } } }), "m")).toBe(100);
    expect(computedCellValue(row({ mirrors: { m: { values: [{ label: "In Review" }] } } }), "m")).toBe("in review");
    expect(computedCellValue(row({ mirrors: { m: { values: [{ label: "In Review" }] } } }), "m", "group")).toBe("In Review");
    expect(computedCellValue(row({ mirrors: { m: { values: [] } } }), "m")).toBeNull();
  });
  it("reads a connect cell by its titles, never its ids", () => {
    const r = row({ metadata: { c: ["id9"] }, connections: { c: [{ id: "id9", title: "Beta", statusLabel: null, statusColor: null, done: false }] } });
    expect(computedCellValue(r, "c")).toBe("beta");
    expect(computedCellValue(row({ connections: { c: [] } }), "c")).toBeNull();
  });
  it("is undefined for a key that is not computed on the row", () => {
    expect(computedCellValue(row({ metadata: { budget: 5 } }), "budget")).toBeUndefined();
  });
});

describe("computedFieldsKey", () => {
  it("changes when a Mirror column is added or a Connect column retargeted, and not for other fields", () => {
    const base = [
      { key: "conn", type: "RELATIONSHIP", options: { targetBoardIds: ["a"] } },
      { key: "notes", type: "TEXT" },
    ];
    const k = computedFieldsKey(base);
    expect(computedFieldsKey([...base, { key: "notes2", type: "TEXT" }])).toBe(k);
    expect(computedFieldsKey([...base, { key: "m", type: "MIRROR", options: { linkFieldKey: "conn" } }])).not.toBe(k);
    expect(computedFieldsKey([{ ...base[0], options: { targetBoardIds: ["a", "b"] } }, base[1]])).not.toBe(k);
  });
});
