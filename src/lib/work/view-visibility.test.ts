import { describe, it, expect } from "vitest";
import {
  viewMenuRows,
  viewVisibleTo, visibleViews, orderViews, viewsForViewer,
  canManageView, canDeleteView, canSaveView, togglePinned, type ViewLike,
} from "./view-visibility";

function v(over: Partial<ViewLike> & { id: string }): ViewLike {
  return {
    name: over.id, isShared: true, isDefault: false, ownerId: null, displayOrder: 0,
    ...over,
  };
}

describe("viewVisibleTo", () => {
  it("shows a shared view to everyone", () => {
    expect(viewVisibleTo(v({ id: "a", isShared: true, ownerId: "u2" }), "u1")).toBe(true);
  });
  it("hides a private view from anyone but its owner (audit High #5)", () => {
    const priv = v({ id: "a", isShared: false, ownerId: "u2" });
    expect(viewVisibleTo(priv, "u1")).toBe(false);
    expect(viewVisibleTo(priv, "u2")).toBe(true);
    expect(viewVisibleTo(priv, null)).toBe(false);
  });
  it("treats an ownerless legacy row as shared, so no List loses its tabs", () => {
    expect(viewVisibleTo(v({ id: "a", isShared: false, ownerId: null }), "u1")).toBe(true);
  });
});

describe("visibleViews", () => {
  it("keeps the viewer's own private views alongside the shared ones", () => {
    const rows = [
      v({ id: "shared", isShared: true, ownerId: "u2" }),
      v({ id: "mine", isShared: false, ownerId: "u1" }),
      v({ id: "theirs", isShared: false, ownerId: "u2" }),
    ];
    expect(visibleViews(rows, "u1").map((r) => r.id)).toEqual(["shared", "mine"]);
  });
});

describe("orderViews", () => {
  it("puts the resolved default first, then personal pins in pin order, then displayOrder", () => {
    const rows = [
      v({ id: "c", displayOrder: 3 }),
      v({ id: "d", displayOrder: 9 }),
      v({ id: "a", displayOrder: 1 }),
      v({ id: "b", displayOrder: 2 }),
    ];
    expect(orderViews(rows, ["b", "c"], "d").map((r) => r.id)).toEqual(["d", "b", "c", "a"]);
  });
  it("no longer ranks the raw isDefault flag: first is whatever default-view.ts resolved (decision 9)", () => {
    // The flag sat on the auto List view of almost every List, so ranking it
    // put List first while the page opened Board.
    const rows = [
      v({ id: "c", displayOrder: 3 }),
      v({ id: "d", isDefault: true, displayOrder: 9 }),
      v({ id: "a", displayOrder: 1 }),
      v({ id: "b", displayOrder: 2 }),
    ];
    expect(orderViews(rows, ["b", "c"]).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(orderViews(rows, [], "a").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores a default id that is not in the set", () => {
    const rows = [v({ id: "b", displayOrder: 2 }), v({ id: "a", displayOrder: 1 })];
    expect(orderViews(rows, [], "gone").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("falls back to name, then to arrival order, so the sort is stable", () => {
    const rows = [
      v({ id: "x", name: "Zebra", displayOrder: 0 }),
      v({ id: "y", name: "Apple", displayOrder: 0 }),
      v({ id: "z", name: "Apple", displayOrder: 0 }),
    ];
    expect(orderViews(rows).map((r) => r.id)).toEqual(["y", "z", "x"]);
  });
  it("does not mutate its input", () => {
    const rows = [v({ id: "a", displayOrder: 2 }), v({ id: "b", displayOrder: 1 })];
    orderViews(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("viewsForViewer", () => {
  it("filters then orders in one call", () => {
    const rows = [
      v({ id: "theirs", isShared: false, ownerId: "u2", displayOrder: 0 }),
      v({ id: "shared", displayOrder: 2 }),
      v({ id: "mine", isShared: false, ownerId: "u1", displayOrder: 1 }),
    ];
    expect(viewsForViewer(rows, "u1", ["shared"]).map((r) => r.id)).toEqual(["shared", "mine"]);
  });
  it("passes the resolved default through, ahead of the personal pins", () => {
    const rows = [
      v({ id: "theirs", isShared: false, ownerId: "u2", displayOrder: 0 }),
      v({ id: "shared", displayOrder: 2 }),
      v({ id: "mine", isShared: false, ownerId: "u1", displayOrder: 1 }),
    ];
    expect(viewsForViewer(rows, "u1", ["shared"], "mine").map((r) => r.id)).toEqual(["mine", "shared"]);
  });
});

describe("canSaveView (bug 7.2: a member could not save a view)", () => {
  const shared = v({ id: "s", isShared: true, ownerId: "u2" });
  const mine = v({ id: "m", isShared: false, ownerId: "u1" });

  it("lets a contributor save a shared view", () => {
    // The reported bug: PATCH was gated on canEditSpace, so a Space member
    // who may create every task on the List got a 403 renaming a tab.
    expect(canSaveView(shared, "u1", true)).toBe(true);
  });
  it("still refuses a pure reader someone else's view", () => {
    expect(canSaveView(shared, "u1", false)).toBe(false);
  });
  it("lets the view's own owner save it without contribute rights", () => {
    expect(canSaveView(mine, "u1", false)).toBe(true);
  });
  it("refuses an anonymous caller", () => {
    expect(canSaveView(v({ id: "x", isShared: false, ownerId: null }), null, false)).toBe(false);
  });
  it("is strictly looser than canManageView, never the reverse", () => {
    // Anything the management gate allowed before must still be allowed, so
    // the substitution cannot take an ability away from anyone.
    for (const view of [shared, mine, v({ id: "o", isShared: true, ownerId: null })]) {
      for (const viewer of ["u1", "u2", null]) {
        if (canManageView(view, viewer, false)) {
          expect(canSaveView(view, viewer, false)).toBe(true);
        }
      }
    }
  });
  it("does NOT hand a contributor the delete of a shared view", () => {
    // Deleting a shared view destroys other people's saved work. Saving got
    // looser; removal stays on the management ladder.
    expect(canSaveView(shared, "u1", true)).toBe(true);
    expect(canManageView(shared, "u1", false)).toBe(false);
  });
});

describe("canManageView / canDeleteView", () => {
  const shared = v({ id: "s", isShared: true, ownerId: "u2" });
  const mine = v({ id: "m", isShared: false, ownerId: "u1" });

  it("lets Full access manage anything and the owner manage their own", () => {
    expect(canManageView(shared, "u1", true)).toBe(true);
    expect(canManageView(shared, "u1", false)).toBe(false);
    expect(canManageView(mine, "u1", false)).toBe(true);
  });

  it("refuses to delete the last view even for Full access", () => {
    expect(canDeleteView(shared, [shared], "u1", true)).toBe(false);
    expect(canDeleteView(shared, [shared, mine], "u1", true)).toBe(true);
  });
});

describe("viewMenuRows", () => {
  const two = [{}, {}];
  const shared = { ownerId: "owner", isDefault: false };

  it("offers a reader who does not own the view no write row", () => {
    expect(viewMenuRows(shared, two, { viewerId: "reader", canContribute: false, hasFullAccess: false })).toEqual({
      rename: false,
      setDefault: false,
      duplicate: false,
      delete: false,
    });
  });

  it("lets a contributor save and duplicate, and delete only with full access", () => {
    expect(viewMenuRows(shared, two, { viewerId: "m", canContribute: true, hasFullAccess: false })).toEqual({ rename: true, setDefault: true, duplicate: true, delete: false });
    expect(viewMenuRows(shared, two, { viewerId: "m", canContribute: true, hasFullAccess: true }).delete).toBe(true);
  });

  it("lets an owner save and delete their own view, never the last one", () => {
    const mine = { ownerId: "me", isDefault: true };
    expect(viewMenuRows(mine, two, { viewerId: "me", canContribute: false, hasFullAccess: false })).toEqual({ rename: true, setDefault: false, duplicate: false, delete: true });
    expect(viewMenuRows(mine, [{}], { viewerId: "me", canContribute: false, hasFullAccess: false }).delete).toBe(false);
  });
});

describe("togglePinned", () => {
  it("adds at the end and removes in place", () => {
    expect(togglePinned([], "a")).toEqual(["a"]);
    expect(togglePinned(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(togglePinned(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
