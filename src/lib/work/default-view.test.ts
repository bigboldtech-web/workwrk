// Board is every List's default view, unless a person pinned another one
// (decisions 8 and 9). These tests pin the one resolver every List surface
// calls, and the small pure pieces the pin route and the tab strip share.

import { describe, it, expect } from "vitest";
import {
  readPinnedDefault,
  isAutoListView,
  isPlainBoardView,
  visibleToEveryone,
  countsAsPinnedDefault,
  resolveDefaultView,
  listViewsForViewer,
  withPinnedDefault,
  withoutPinnedDefault,
  carryPinnedDefault,
  moveTabKeepingDefaultFirst,
  pinMenuRow,
  PIN_DENIED,
  PIN_PRIVATE_DENIED,
  PINNED_PRIVATE_DENIED,
  UNPIN_STALE,
  type DefaultViewCandidate,
} from "./default-view";

const MARK = { byId: "u-admin", at: "2026-09-24T10:00:00.000Z" };

function view(over: Partial<DefaultViewCandidate> & { id: string }): DefaultViewCandidate {
  return {
    name: over.id,
    type: "TABLE",
    isDefault: false,
    isShared: true,
    ownerId: "u-owner",
    displayOrder: 0,
    config: {},
    ...over,
  };
}

/** The four tabs createBoard used to write: the auto List view carried the old system default. */
function seededList(listConfig: Record<string, unknown> = { groupBy: "status" }): DefaultViewCandidate[] {
  return [
    view({ id: "list", name: "List", type: "TABLE", isDefault: true, config: listConfig, displayOrder: 0 }),
    view({ id: "board", name: "Board", type: "KANBAN", displayOrder: 1 }),
    view({ id: "cal", name: "Calendar", type: "CALENDAR", displayOrder: 2 }),
    view({ id: "gantt", name: "Gantt", type: "GANTT", displayOrder: 3 }),
  ];
}

describe("resolveDefaultView: a pin wins, otherwise Board", () => {
  it("lets a marked isDefault auto List view beat the plain Board, and names who pinned it", () => {
    const r = resolveDefaultView(seededList({ groupBy: "status", pinned: MARK }));
    expect(r?.view.id).toBe("list");
    expect(r?.reason).toBe("pinned");
    expect(r?.pinned).toBe(true);
    expect(r?.pinnedById).toBe("u-admin");
  });

  it("opens existing Lists on Board with no migration: the unmarked isDefault auto List view loses", () => {
    const r = resolveDefaultView(seededList());
    expect(r?.view.id).toBe("board");
    expect(r?.reason).toBe("board");
    expect(r?.pinned).toBe(false);
    expect(r?.pinnedById).toBeNull();
  });

  it("reads an unmarked isDefault plain Board as the Board fallback, not a pin (review #32)", () => {
    // What coreViewCreateData wrote for every List created with
    // defaultViewType KANBAN: a Pin glyph there would be one nobody set, and
    // its Unpin row would do nothing.
    const views = seededList().map((v) => ({ ...v, isDefault: v.id === "board" }));
    const r = resolveDefaultView(views);
    expect(r?.view.id).toBe("board");
    expect(r?.reason).toBe("board");
    expect(r?.pinned).toBe(false);
  });

  it("keeps an earlier explicit choice: an unmarked isDefault Calendar", () => {
    const views = seededList().map((v) => ({ ...v, isDefault: v.id === "cal" }));
    const r = resolveDefaultView(views);
    expect(r?.view.id).toBe("cal");
    expect(r?.reason).toBe("chosen");
    expect(r?.pinned).toBe(true);
    expect(r?.pinnedById).toBeNull();
  });

  it("keeps an earlier explicit choice: an unmarked isDefault Monday Table (TABLE with config.grid)", () => {
    const views = [
      ...seededList().map((v) => ({ ...v, isDefault: false })),
      view({ id: "table", name: "Table", type: "TABLE", isDefault: true, config: { grid: "monday" }, displayOrder: 4 }),
    ];
    const r = resolveDefaultView(views);
    expect(r?.view.id).toBe("table");
    expect(r?.reason).toBe("chosen");
    expect(r?.pinned).toBe(true);
  });

  it("does not count a KANBAN variant as the plain Board, then falls back to the legacy default, then to the first view", () => {
    const swimlanes = view({ id: "swim", name: "Swimlanes", type: "KANBAN", config: { variant: "swimlane" }, displayOrder: 1 });
    const legacy = view({ id: "list", name: "List", type: "TABLE", isDefault: true, config: { groupBy: "status" } });
    const legacyWins = resolveDefaultView([legacy, swimlanes]);
    expect(legacyWins?.view.id).toBe("list");
    expect(legacyWins?.reason).toBe("legacy");
    expect(legacyWins?.pinned).toBe(false);

    const noDefault = resolveDefaultView([{ ...legacy, isDefault: false }, swimlanes]);
    expect(noDefault?.view.id).toBe("list");
    expect(noDefault?.reason).toBe("first");
    expect(noDefault?.pinned).toBe(false);

    expect(resolveDefaultView([])).toBeNull();
  });

  it("resolves two plain Boards to the shared one, then the lower displayOrder, then the id, for every viewer alike", () => {
    const privateBoard = view({ id: "b-private", type: "KANBAN", isShared: false, ownerId: "u1", displayOrder: 0 });
    const sharedBoard = view({ id: "b-shared", type: "KANBAN", displayOrder: 5 });
    expect(resolveDefaultView([privateBoard, sharedBoard])?.view.id).toBe("b-shared");

    const later = view({ id: "b-later", type: "KANBAN", displayOrder: 3 });
    const earlier = view({ id: "b-earlier", type: "KANBAN", displayOrder: 1 });
    expect(resolveDefaultView([later, earlier])?.view.id).toBe("b-earlier");

    const b = view({ id: "b-b", type: "KANBAN", displayOrder: 1 });
    const a = view({ id: "b-a", type: "KANBAN", displayOrder: 1 });
    expect(resolveDefaultView([b, a])?.view.id).toBe("b-a");
  });

  it("ignores a mark on a view that is not the default, and every malformed mark", () => {
    const strayMark = seededList().map((v) =>
      v.id === "cal" ? { ...v, config: { pinned: MARK } } : v,
    );
    expect(resolveDefaultView(strayMark)?.view.id).toBe("board");

    const malformed: unknown[] = [
      "yes",
      true,
      ["u-admin", MARK.at],
      { byId: "u-admin" },
      { at: MARK.at },
      { byId: "", at: MARK.at },
      { byId: "x".repeat(65), at: MARK.at },
      { byId: "u-admin", at: "not a date" },
      { byId: 42, at: MARK.at },
    ];
    for (const pinned of malformed) {
      expect(readPinnedDefault({ pinned })).toBeNull();
      const r = resolveDefaultView(seededList({ groupBy: "status", pinned }));
      expect(r?.view.id).toBe("board");
      expect(r?.reason).toBe("board");
    }
  });

  it("resolves two marked defaults (a race or a legacy row) to the newest pin", () => {
    const older = view({ id: "cal", type: "CALENDAR", isDefault: true, config: { pinned: { byId: "u1", at: "2026-09-01T00:00:00.000Z" } } });
    const newer = view({ id: "gantt", type: "GANTT", isDefault: true, displayOrder: 9, config: { pinned: { byId: "u2", at: "2026-09-20T00:00:00.000Z" } } });
    const r = resolveDefaultView([older, newer]);
    expect(r?.view.id).toBe("gantt");
    expect(r?.pinnedById).toBe("u2");
  });

  it("ranks a marked default above an unmarked chosen one", () => {
    const chosen = view({ id: "cal", type: "CALENDAR", isDefault: true, displayOrder: 0 });
    const marked = view({ id: "gantt", type: "GANTT", isDefault: true, displayOrder: 5, config: { pinned: MARK } });
    expect(resolveDefaultView([chosen, marked])?.view.id).toBe("gantt");
  });
});

describe("listViewsForViewer: the strip and the page agree for every viewer", () => {
  const rows = (): DefaultViewCandidate[] => [
    view({ id: "list", name: "List", type: "TABLE", config: { groupBy: "status" }, displayOrder: 0 }),
    view({ id: "board", name: "Board", type: "KANBAN", displayOrder: 1 }),
    view({ id: "cal", name: "Calendar", type: "CALENDAR", displayOrder: 2 }),
    view({
      id: "mine",
      name: "My board",
      type: "KANBAN",
      config: { variant: "swimlane", pinned: { byId: "u1", at: MARK.at } },
      isDefault: true,
      isShared: false,
      ownerId: "u1",
      displayOrder: 3,
    }),
  ];

  it("gives u1 their own private pinned view and u2, who cannot see it, the Board", () => {
    const forU1 = listViewsForViewer(rows(), "u1");
    expect(forU1.defaultView?.id).toBe("mine");
    expect(forU1.reason).toBe("pinned");
    expect(forU1.pinned).toBe(true);
    expect(forU1.pinnedById).toBe("u1");
    expect(forU1.views.map((v) => v.id)).toEqual(["mine", "list", "board", "cal"]);

    const forU2 = listViewsForViewer(rows(), "u2");
    expect(forU2.defaultView?.id).toBe("board");
    expect(forU2.reason).toBe("board");
    expect(forU2.pinned).toBe(false);
    expect(forU2.views.map((v) => v.id)).toEqual(["board", "list", "cal"]);
  });

  it("always puts the default first, so the first tab is the view the bare URL opens", () => {
    const cases: DefaultViewCandidate[][] = [
      rows(),
      seededList(),
      seededList({ groupBy: "status", pinned: MARK }),
      seededList().map((v) => ({ ...v, isDefault: v.id === "gantt" })),
      [view({ id: "only", type: "DOC", isDefault: true })],
    ];
    for (const views of cases) {
      for (const viewer of ["u1", "u2", null]) {
        const out = listViewsForViewer(views, viewer);
        expect(out.views[0]).toBe(out.defaultView);
      }
    }
  });

  it("answers an empty List with no default and no pin", () => {
    expect(listViewsForViewer([], "u1")).toEqual({
      views: [],
      defaultView: null,
      reason: null,
      pinned: false,
      pinnedById: null,
    });
  });

  it("orders the rest by displayOrder then name, whatever order the rows arrived in", () => {
    const out = listViewsForViewer([...seededList()].reverse(), "u1");
    expect(out.views.map((v) => v.id)).toEqual(["board", "list", "cal", "gantt"]);
  });
});

describe("the config helpers never drop or forge a pin (reviews #5a and #29)", () => {
  it("withPinnedDefault adds the mark and keeps every other key", () => {
    const out = withPinnedDefault({ groupBy: "status", colWidths: { title: 320 } }, MARK);
    expect(out).toEqual({ groupBy: "status", colWidths: { title: 320 }, pinned: MARK });
  });

  it("withoutPinnedDefault removes the key entirely and keeps the rest", () => {
    const out = withoutPinnedDefault({ groupBy: "status", pinned: MARK });
    expect(out).toEqual({ groupBy: "status" });
    expect("pinned" in out).toBe(false);
  });

  it("treats a non-object config as empty and never mutates its input", () => {
    expect(withPinnedDefault(null, MARK)).toEqual({ pinned: MARK });
    expect(withoutPinnedDefault([1, 2])).toEqual({});
    expect(withoutPinnedDefault("x")).toEqual({});
    const input = { groupBy: "status", pinned: MARK };
    withoutPinnedDefault(input);
    withPinnedDefault(input, { byId: "u9", at: MARK.at });
    expect(input).toEqual({ groupBy: "status", pinned: MARK });
  });

  it("carryPinnedDefault ignores the incoming mark and keeps the stored one", () => {
    // A renderer PATCHes the config it mounted with: a tab opened before the
    // pin has no mark, a tab opened before an unpin still has the old one.
    const stored = { groupBy: "status", pinned: MARK };
    expect(carryPinnedDefault({ groupBy: "priority" }, stored)).toEqual({ groupBy: "priority", pinned: MARK });
    const forged = { groupBy: "priority", pinned: { byId: "x", at: "2099-01-01T00:00:00Z" } };
    expect(carryPinnedDefault(forged, stored)).toEqual({ groupBy: "priority", pinned: MARK });
    expect(carryPinnedDefault(forged, { groupBy: "status" })).toEqual({ groupBy: "priority" });
    expect(carryPinnedDefault(forged, { pinned: "garbage" })).toEqual({ groupBy: "priority" });
  });

  it("withoutPinnedDefault on a configPatch means a shallow merge keeps the stored mark", () => {
    // The shallow merge the configPatch path uses: a null value deletes the
    // stored key, any other value replaces it, an absent key keeps it.
    const merge = (base: Record<string, unknown>, patch: Record<string, unknown>) => {
      const out = { ...base };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete out[k];
        else out[k] = v;
      }
      return out;
    };
    const stored = { groupBy: "status", pinned: MARK };
    expect(merge(stored, withoutPinnedDefault({ pinned: null, rowHeight: "tall" }))).toEqual({
      groupBy: "status",
      pinned: MARK,
      rowHeight: "tall",
    });
    expect(merge({ groupBy: "status" }, withoutPinnedDefault({ pinned: MARK }))).toEqual({ groupBy: "status" });
  });
});

describe("readPinnedDefault", () => {
  it("returns the mark only for a well-formed one", () => {
    expect(readPinnedDefault({ pinned: MARK })).toEqual(MARK);
    expect(readPinnedDefault({ pinned: { ...MARK, extra: 1 } })).toEqual(MARK);
    expect(readPinnedDefault({})).toBeNull();
    expect(readPinnedDefault(null)).toBeNull();
    expect(readPinnedDefault([{ pinned: MARK }])).toBeNull();
  });
});

describe("the view kinds the resolver tells apart", () => {
  it("isAutoListView is the TABLE view createBoard seeds, with no grid and no variant", () => {
    expect(isAutoListView({ type: "TABLE", config: { groupBy: "status" } })).toBe(true);
    expect(isAutoListView({ type: "TABLE", config: { filters: { rules: [] } } })).toBe(true);
    expect(isAutoListView({ type: "TABLE", config: null })).toBe(true);
    expect(isAutoListView({ type: "TABLE", config: { grid: "monday" } })).toBe(false);
    expect(isAutoListView({ type: "TABLE", config: { variant: "x" } })).toBe(false);
    expect(isAutoListView({ type: "KANBAN", config: {} })).toBe(false);
  });

  it("isPlainBoardView is a KANBAN with no variant", () => {
    expect(isPlainBoardView({ type: "KANBAN", config: {} })).toBe(true);
    expect(isPlainBoardView({ type: "KANBAN", config: { groupBy: "status" } })).toBe(true);
    expect(isPlainBoardView({ type: "KANBAN", config: { variant: "swimlane" } })).toBe(false);
    expect(isPlainBoardView({ type: "TABLE", config: {} })).toBe(false);
  });

  it("visibleToEveryone is shared or ownerless (the legacy row reads as shared)", () => {
    expect(visibleToEveryone({ isShared: true, ownerId: "u1" })).toBe(true);
    expect(visibleToEveryone({ isShared: false, ownerId: null })).toBe(true);
    expect(visibleToEveryone({ isShared: false, ownerId: "u1" })).toBe(false);
  });
});

describe("countsAsPinnedDefault (review #31, the rule behind refusing to make a pinned view private)", () => {
  const alone = (v: Omit<DefaultViewCandidate, "id" | "name" | "isShared" | "ownerId" | "displayOrder">) => {
    const row = view({ id: "only", ...v });
    return countsAsPinnedDefault(row, [row]);
  };

  it("is true for a marked default and for an unmarked Calendar default", () => {
    expect(alone({ isDefault: true, type: "TABLE", config: { pinned: MARK } })).toBe(true);
    expect(alone({ isDefault: true, type: "KANBAN", config: { pinned: MARK } })).toBe(true);
    expect(alone({ isDefault: true, type: "CALENDAR", config: {} })).toBe(true);
  });

  it("is false for the unmarked auto List view, the List's lone plain Board and any view that is not the default", () => {
    expect(alone({ isDefault: true, type: "TABLE", config: { groupBy: "status" } })).toBe(false);
    expect(alone({ isDefault: true, type: "KANBAN", config: {} })).toBe(false);
    expect(alone({ isDefault: false, type: "CALENDAR", config: { pinned: MARK } })).toBe(false);
  });

  it("is true for an unmarked isDefault SECOND plain Board, a person's choice (+ View > Board, Duplicate)", () => {
    const core = view({ id: "board", type: "KANBAN", displayOrder: 1 });
    const second = view({ id: "sprint", type: "KANBAN", isDefault: true, config: { groupBy: "assignee" }, displayOrder: 4 });
    expect(countsAsPinnedDefault(second, [core, second])).toBe(true);
    // The core Board itself, flagged by coreViewCreateData, stays the fallback
    // even with a later Board beside it.
    const flaggedCore = { ...core, isDefault: true };
    const later = { ...second, isDefault: false };
    expect(countsAsPinnedDefault(flaggedCore, [flaggedCore, later])).toBe(false);
  });

  it("judges 'first Board' among the Boards everyone sees, so a private Board never changes the answer", () => {
    const privateEarlier = view({ id: "mine", type: "KANBAN", isShared: false, ownerId: "u1", displayOrder: 0 });
    const flaggedCore = view({ id: "board", type: "KANBAN", isDefault: true, displayOrder: 1 });
    expect(countsAsPinnedDefault(flaggedCore, [privateEarlier, flaggedCore])).toBe(false);
  });
});

describe("resolveDefaultView keeps a legacy choice of a second plain Board", () => {
  it("opens 'Sprint board' when HEAD's Set as default wrote isDefault on it alone", () => {
    const views = [
      view({ id: "list", type: "TABLE", config: { groupBy: "status" }, displayOrder: 0 }),
      view({ id: "board", type: "KANBAN", displayOrder: 1 }),
      view({ id: "cal", type: "CALENDAR", displayOrder: 2 }),
      view({ id: "sprint", type: "KANBAN", isDefault: true, config: { groupBy: "assignee" }, displayOrder: 4 }),
    ];
    const r = resolveDefaultView(views);
    expect(r?.view.id).toBe("sprint");
    expect(r?.reason).toBe("chosen");
    expect(r?.pinned).toBe(true);
    const strip = listViewsForViewer(views, "u-anyone");
    expect(strip.views[0].id).toBe("sprint");
    expect(strip.pinned).toBe(true);
  });
});

describe("moveTabKeepingDefaultFirst (review #24)", () => {
  const ids = ["def", "a", "b", "c"];

  it("never moves the default", () => {
    expect(moveTabKeepingDefaultFirst(ids, "def", "c", "def")).toEqual({ ids, hitDefault: false });
  });

  it("lands a drop on the default second and says so", () => {
    expect(moveTabKeepingDefaultFirst(ids, "c", "def", "def")).toEqual({ ids: ["def", "c", "a", "b"], hitDefault: true });
    expect(moveTabKeepingDefaultFirst(ids, "a", "def", "def")).toEqual({ ids: ["def", "a", "b", "c"], hitDefault: true });
  });

  it("splices every other move normally", () => {
    expect(moveTabKeepingDefaultFirst(ids, "c", "a", "def")).toEqual({ ids: ["def", "c", "a", "b"], hitDefault: false });
    expect(moveTabKeepingDefaultFirst(ids, "a", "c", "def")).toEqual({ ids: ["def", "b", "c", "a"], hitDefault: false });
  });

  it("splices freely when there is no default", () => {
    expect(moveTabKeepingDefaultFirst(["a", "b", "c"], "c", "a", null)).toEqual({ ids: ["c", "a", "b"], hitDefault: false });
  });

  it("returns the input for unknown ids or a drop on itself", () => {
    expect(moveTabKeepingDefaultFirst(ids, "zz", "a", "def")).toEqual({ ids, hitDefault: false });
    expect(moveTabKeepingDefaultFirst(ids, "a", "zz", "def")).toEqual({ ids, hitDefault: false });
    expect(moveTabKeepingDefaultFirst(ids, "b", "b", "def")).toEqual({ ids, hitDefault: false });
  });

  it("does not mutate its input", () => {
    const input = ["def", "a", "b"];
    moveTabKeepingDefaultFirst(input, "b", "a", "def");
    moveTabKeepingDefaultFirst(input, "b", "def", "def");
    expect(input).toEqual(["def", "a", "b"]);
  });
});

describe("pinMenuRow (decision 9: the gate Set as default had)", () => {
  const base = { isDefault: false, pinned: false, canPin: true, pinnable: true, tabCount: 4 };

  it("shows no row on a one-tab List", () => {
    expect(pinMenuRow({ ...base, tabCount: 1 })).toBe("none");
  });

  it("shows no row to a viewer the route would refuse (canPin is canSaveView for that view)", () => {
    expect(pinMenuRow({ ...base, canPin: false })).toBe("none");
    expect(pinMenuRow({ ...base, isDefault: true, pinned: true, canPin: false })).toBe("none");
  });

  it("offers Unpin on the pinned default", () => {
    expect(pinMenuRow({ ...base, isDefault: true, pinned: true })).toBe("unpin");
  });

  it("disables the row on a private view of a Space List", () => {
    expect(pinMenuRow({ ...base, pinnable: false })).toBe("pin-disabled");
  });

  it("offers Pin on the unpinned Board fallback, which makes the choice explicit", () => {
    expect(pinMenuRow({ ...base, isDefault: true, pinned: false })).toBe("pin");
  });

  it("offers Pin on a private view of the Personal list, whose owner is its only reader", () => {
    // The caller passes pinnable = personalList || visibleToEveryone(view).
    expect(pinMenuRow({ ...base, pinnable: true })).toBe("pin");
  });
});

describe("the refusal sentences", () => {
  it("are sentences a person can act on, with no dashes", () => {
    for (const s of [PIN_DENIED, PIN_PRIVATE_DENIED, PINNED_PRIVATE_DENIED, UNPIN_STALE]) {
      expect(s).toMatch(/^[A-Z].*\.$/);
      expect(s).not.toMatch(/\u2014|\u2013|-{2}/);
    }
    expect(PIN_DENIED).toContain("Can edit");
    expect(PIN_PRIVATE_DENIED).toContain("private view");
    expect(PINNED_PRIVATE_DENIED).toContain("Unpin it first");
  });
});
