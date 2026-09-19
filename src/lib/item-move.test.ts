import { describe, expect, it } from "vitest";
import { PERSONAL_LIST_SLUG, moveDestinations, remapDescendantStatuses, remapStatusOnMove } from "./item-move";
import type { StatusOption } from "./board-items-shared";

const DEFAULT: StatusOption[] = [
  { value: "TO_DO", label: "To Do", color: "#94a3b8", group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "In Progress", color: "#3b82f6", group: "ACTIVE" },
  { value: "DONE", label: "Done", color: "#10b981", group: "DONE" },
];

const CUSTOM: StatusOption[] = [
  { value: "backlog", label: "Backlog", color: "#94a3b8", group: "ACTIVE" },
  { value: "doing", label: "in progress", color: "#3b82f6", group: "ACTIVE" },
  { value: "shipped", label: "Shipped", color: "#10b981", group: "DONE" },
  { value: "dropped", label: "Dropped", color: "#ef4444", group: "CLOSED" },
];

describe("remapStatusOnMove", () => {
  it("keeps the exact value when the target List declares it", () => {
    expect(remapStatusOnMove({ status: "DONE", from: DEFAULT, to: DEFAULT })).toEqual({
      status: "DONE",
      reason: "same-value",
    });
  });

  it("matches on the label, case-insensitively, before falling back to a group", () => {
    expect(remapStatusOnMove({ status: "IN_PROGRESS", from: DEFAULT, to: CUSTOM })).toEqual({
      status: "doing",
      reason: "same-label",
    });
  });

  it("a done task stays done on a List with different words", () => {
    expect(remapStatusOnMove({ status: "DONE", from: DEFAULT, to: CUSTOM })).toEqual({
      status: "shipped",
      reason: "same-group",
    });
  });

  it("a closed task stays closed rather than reopening", () => {
    expect(remapStatusOnMove({ status: "dropped", from: CUSTOM, to: [...CUSTOM].reverse() })).toEqual({
      status: "dropped",
      reason: "same-value",
    });
    const noClosed = DEFAULT;
    // No CLOSED status on the target, so the task lands on the first Active
    // one rather than on a value the List cannot render.
    expect(remapStatusOnMove({ status: "dropped", from: CUSTOM, to: noClosed })).toEqual({
      status: "TO_DO",
      reason: "first-active",
    });
  });

  it("an active task with no equivalent lands on the target's first Active status", () => {
    expect(remapStatusOnMove({ status: "backlog", from: CUSTOM, to: DEFAULT })).toEqual({
      status: "TO_DO",
      reason: "same-group",
    });
  });

  it("a status the SOURCE no longer declares is treated as Active", () => {
    expect(remapStatusOnMove({ status: "GHOST", from: DEFAULT, to: CUSTOM })).toEqual({
      status: "backlog",
      reason: "same-group",
    });
  });

  it("a task with no status gets the target's first Active status", () => {
    expect(remapStatusOnMove({ status: null, from: DEFAULT, to: CUSTOM })).toEqual({
      status: "backlog",
      reason: "first-active",
    });
  });

  it("falls through to the first status of any group when the target has no Active one", () => {
    const doneOnly: StatusOption[] = [{ value: "closed", label: "Closed", color: "#000", group: "CLOSED" }];
    expect(remapStatusOnMove({ status: "TO_DO", from: DEFAULT, to: doneOnly })).toEqual({
      status: "closed",
      reason: "first-any",
    });
  });

  it("a target with no statuses at all stores null rather than an unrenderable value", () => {
    expect(remapStatusOnMove({ status: "TO_DO", from: DEFAULT, to: [] })).toEqual({
      status: null,
      reason: "none",
    });
  });

  it("never invents a value the target does not declare", () => {
    for (const status of ["TO_DO", "IN_PROGRESS", "DONE", null, "GHOST"]) {
      const out = remapStatusOnMove({ status, from: DEFAULT, to: CUSTOM });
      expect(out.status === null || CUSTOM.some((s) => s.value === out.status)).toBe(true);
    }
  });
});

// The move picker used to list "My work > Personal list", and PATCH
// /api/items/[id] answers 403 for that destination. A picker must never offer
// a row the server will refuse.
describe("moveDestinations", () => {
  const LISTS = [
    { id: "b1", name: "Roadmap", productSlug: null },
    { id: "personal", name: "Personal List", productSlug: PERSONAL_LIST_SLUG },
    { id: "b2", name: "Bugs", productSlug: null },
  ];

  it("drops the Personal list, which the server refuses as a target", () => {
    expect(moveDestinations(LISTS).map((l) => l.id)).toEqual(["b1", "b2"]);
  });

  it("keeps every other destination reachable, in order", () => {
    expect(moveDestinations(LISTS).map((l) => l.name)).toEqual(["Roadmap", "Bugs"]);
  });

  it("keeps a List the route answered without a productSlug", () => {
    // The caller's own row type, so an older payload cannot silently vanish.
    const rows: { id: string; name: string; productSlug?: string | null }[] = [{ id: "b3", name: "Old" }];
    expect(moveDestinations(rows).map((l) => l.id)).toEqual(["b3"]);
  });

  it("answers an empty set when the Personal list is the only writable List", () => {
    expect(moveDestinations([LISTS[1]])).toEqual([]);
  });

  it("does not mutate the set it was handed", () => {
    const input = [...LISTS];
    moveDestinations(input);
    expect(input).toHaveLength(3);
  });
});

// ── Subtasks travel with the parent, and so do their statuses ───────
//
// A moved parent was remapped and its children were not, so a child landed in
// the target List carrying a status that List does not declare. Kanban hides
// that (it buckets an unknown status into the first column); a grouped List
// view does not, and the child simply disappears from it. Nothing is deleted,
// but a task nobody can find is a task nobody has.
describe("remapDescendantStatuses", () => {
  it("remaps every child onto a status the target List actually declares", () => {
    const out = remapDescendantStatuses(
      [
        { id: "c1", status: "TO_DO" },
        { id: "c2", status: "DONE" },
        { id: "c3", status: "IN_PROGRESS" },
      ],
      DEFAULT,
      CUSTOM,
    );
    const declared = new Set(CUSTOM.map((s) => s.value));
    for (const status of out.keys()) expect(declared.has(status as string)).toBe(true);
    expect(out.get("shipped")).toEqual(["c2"]);
    expect(out.get("doing")).toEqual(["c3"]);
  });

  it("groups children that land on the same status into one bucket", () => {
    const out = remapDescendantStatuses(
      [
        { id: "c1", status: "GHOST" },
        { id: "c2", status: "ALSO_GHOST" },
      ],
      DEFAULT,
      CUSTOM,
    );
    expect(out.size).toBe(1);
    expect(out.get("backlog")).toEqual(["c1", "c2"]);
  });

  it("keeps a child's status untouched when the target already declares it", () => {
    const out = remapDescendantStatuses([{ id: "c1", status: "DONE" }], DEFAULT, DEFAULT);
    expect(out.get("DONE")).toEqual(["c1"]);
  });

  it("a target List with no statuses puts every child on null, not on a phantom", () => {
    const out = remapDescendantStatuses([{ id: "c1", status: "DONE" }], DEFAULT, []);
    expect(out.get(null)).toEqual(["c1"]);
  });

  it("no children means no writes", () => {
    expect(remapDescendantStatuses([], DEFAULT, CUSTOM).size).toBe(0);
  });
});
