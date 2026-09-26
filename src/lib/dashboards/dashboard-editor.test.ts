import { describe, expect, it } from "vitest";
import {
  applyLayouts,
  buildDashboardPatch,
  classifySaveResponse,
  compactVertical,
  dataKey,
  diffLayouts,
  draftHasUnmergedEdits,
  layoutsFromGrid,
  mergeMissingWidgets,
  placeNewWidget,
  previewKey,
  readdWidgetLocal,
  rebaseDashboard,
  removeWidgetLocal,
  renameWidgetLocal,
  stableStringify,
  stackOrder,
  toWidgetInputs,
  widgetGridItems,
  withoutWidgetItems,
  type DashboardSnapshot,
} from "./dashboard-editor";
import { widgetInputSchema, type EditorWidget, type WidgetInput } from "./widgets";

const L = (x: number, y: number, w = 4, h = 4) => ({ x, y, w, h });
const filter = { connector: "AND" as const, rules: [], hideDone: false };

const stat = (id: string, over: Partial<Extract<EditorWidget, { kind: "stat" }>> = {}): EditorWidget => ({
  id,
  kind: "stat",
  title: `Stat ${id}`,
  source: { kind: "all" },
  filter,
  metric: { op: "count" },
  scope: "open",
  layout: L(0, 0, 3, 3),
  ...over,
});
const notes = (id: string, text = "hello", layout = L(0, 3)): EditorWidget => ({ id, kind: "notes", title: `Notes ${id}`, text, layout });
const hiddenCard = (id: string): EditorWidget => ({ id, kind: "hidden", layout: L(4, 0) });
const passthrough = (id: string): EditorWidget => ({ id, kind: "passthrough", raw: null, layout: L(8, 0) });

describe("toWidgetInputs and buildDashboardPatch", () => {
  it("sends hidden and passthrough cards as passthrough ids, drops the partial flag, and validates", () => {
    const partial = { ...stat("p", { source: { kind: "lists", listIds: ["A"] } }), partial: true as const } as EditorWidget;
    const inputs = toWidgetInputs([stat("s"), notes("n"), hiddenCard("h"), passthrough("x"), partial]);
    expect(inputs[2]).toEqual({ id: "h", kind: "passthrough" });
    expect(inputs[3]).toEqual({ id: "x", kind: "passthrough" });
    expect("partial" in inputs[4]).toBe(false);
    for (const i of inputs) expect(widgetInputSchema.safeParse(i).success).toBe(true);
  });
  it("names only removed cards that are no longer in the list, once", () => {
    const body = buildDashboardPatch({ expectedUpdatedAt: "2026-09-24T10:00:00.000Z", widgets: [stat("a")], removedIds: ["b", "b", "a"], name: "Q3" });
    expect(body).toEqual({ expectedUpdatedAt: "2026-09-24T10:00:00.000Z", widgets: toWidgetInputs([stat("a")]), removedWidgetIds: ["b"], name: "Q3" });
    expect("name" in buildDashboardPatch({ expectedUpdatedAt: "x", widgets: [], removedIds: [] })).toBe(false);
  });
  it("clamps a layout into the 12-column model on the way out", () => {
    const [input] = toWidgetInputs([stat("a", { layout: { x: 11, y: -3, w: 6, h: 99 } })]);
    expect((input as { layout: unknown }).layout).toEqual({ x: 6, y: 0, w: 6, h: 60 });
  });
});

describe("placeNewWidget", () => {
  it("fills the gap beside a row before going to the bottom", () => {
    expect(placeNewWidget([], { w: 3, h: 3 })).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(placeNewWidget([L(0, 0, 3, 3)], { w: 3, h: 3 })).toEqual({ x: 3, y: 0, w: 3, h: 3 });
    expect(placeNewWidget([L(0, 0, 12, 3)], { w: 6, h: 6 })).toEqual({ x: 0, y: 3, w: 6, h: 6 });
    expect(placeNewWidget([L(0, 0, 6, 6), L(6, 0, 6, 2)], { w: 6, h: 3 })).toEqual({ x: 6, y: 2, w: 6, h: 3 });
  });
  it("never overlaps an existing card", () => {
    const existing = [L(0, 0, 5, 2), L(5, 0, 7, 4), L(0, 2, 3, 5)];
    const spot = placeNewWidget(existing, { w: 4, h: 3 });
    for (const e of existing) {
      const hit = spot.x < e.x + e.w && e.x < spot.x + spot.w && spot.y < e.y + e.h && e.y < spot.y + spot.h;
      expect(hit).toBe(false);
    }
  });
});

describe("layout saving", () => {
  it("reads a grid into clamped layouts and ignores broken items", () => {
    expect(layoutsFromGrid([{ i: "a", x: 10, y: 2.4, w: 5, h: 0 }, { i: "b", x: Number.NaN, y: 0, w: 1, h: 1 }])).toEqual({ a: { x: 7, y: 2, w: 5, h: 1 } });
  });
  it("says which cards moved, and nothing when nothing moved", () => {
    const stored = { a: L(0, 0), b: L(4, 0) };
    expect(diffLayouts(stored, { a: L(0, 0), b: L(4, 0) })).toEqual([]);
    expect(diffLayouts(stored, { a: L(0, 4), b: L(4, 0) })).toEqual(["a"]);
    expect(diffLayouts(stored, { c: L(0, 0) })).toEqual(["c"]);
  });
  it("applies new layouts but never to a hidden or passthrough card", () => {
    const next = applyLayouts([stat("a"), hiddenCard("h"), passthrough("x")], { a: L(6, 6), h: L(0, 9), x: L(0, 9) });
    expect(next[0].layout).toEqual(L(6, 6));
    expect(next[1].layout).toEqual(L(4, 0));
    expect(next[2].layout).toEqual(L(8, 0));
  });
});

describe("widgetGridItems", () => {
  const cards = [stat("a", { layout: L(0, 2) }), hiddenCard("h"), passthrough("x"), notes("n", "t", L(0, 0))];
  it("lets an editor move data and notes cards, never hidden or passthrough ones", () => {
    const items = widgetGridItems(cards, { canEdit: true, cols: 12 });
    expect(items.map((i) => [i.i, i.static])).toEqual([["a", false], ["h", true], ["x", true], ["n", false]]);
  });
  it("locks a viewer's cards per item, never as static, so the grid compacts them too", () => {
    // The grid never compacts a static item: a viewer's static cards sat at
    // their raw stored rows while the editor's grid pulled them up.
    const items = widgetGridItems(cards, { canEdit: false, cols: 12 });
    expect(items.every((i) => i.static === false && i.isDraggable === false && i.isResizable === false)).toBe(true);
  });
  it("gives a viewer and an editor the same compacted rows after a card is deleted", () => {
    // What removing the card between them leaves stored: a stat at the top
    // and a note 10 rows down, with nothing in between.
    const left = [stat("s", { layout: L(0, 0, 4, 4) }), notes("n", "t", L(0, 10, 4, 3)), hiddenCard("h")];
    const editor = widgetGridItems(left, { canEdit: true, cols: 12, compact: true });
    const viewer = widgetGridItems(left, { canEdit: false, cols: 12, compact: true });
    const rows = (xs: typeof editor) => xs.map((i) => [i.i, i.x, i.y, i.w, i.h]);
    expect(rows(viewer)).toEqual(rows(editor));
    // The note rises under the stat; the hidden card (x 4, y 0) sits beside it.
    expect(editor.find((i) => i.i === "n")).toMatchObject({ y: 4 });
    expect(editor.find((i) => i.i === "h")).toMatchObject({ y: 0, static: true });
    // Without compact (the Space Overview, where the grid compacts widgets
    // together with each person's own cards) the stored rows pass through.
    expect(widgetGridItems(left, { canEdit: false, cols: 12 }).find((i) => i.i === "n")).toMatchObject({ y: 10 });
  });
  it("pulls a Space Overview's widgets up from under the built-in cards on the canvas", () => {
    const sov = [stat("a", { layout: L(0, 16, 6, 4) }), stat("b", { layout: L(6, 16, 6, 4) }), notes("c", "t", L(0, 20, 12, 3))];
    expect(widgetGridItems(sov, { canEdit: false, cols: 12, compact: true }).map((i) => i.y)).toEqual([0, 0, 4]);
  });
  it("prefixes ids and derives a static stack on narrow breakpoints", () => {
    const items = widgetGridItems(cards, { canEdit: true, cols: 6, prefix: "w:" });
    // stackOrder: n (0,0), h (4,0), x (8,0), a (0,2).
    expect(items.map((i) => i.i)).toEqual(["w:n", "w:h", "w:x", "w:a"]);
    expect(items.every((i) => i.static && i.x === 0 && i.w === 6)).toBe(true);
    expect(items.map((i) => i.y)).toEqual([0, 4, 8, 12]);
  });
  it("places a card that has no layout instead of dropping it", () => {
    const items = widgetGridItems([stat("a", { layout: L(0, 0, 12, 3) }), { id: "h", kind: "hidden" }], { canEdit: true, cols: 12 });
    expect(items[1]).toMatchObject({ i: "h", y: 3, static: true });
  });
});

describe("compactVertical", () => {
  it("rises each card to the first row the cards above leave free, keeping input order", () => {
    const out = compactVertical([
      { i: "low", x: 0, y: 9, w: 4, h: 2 },
      { i: "top", x: 0, y: 2, w: 12, h: 3 },
      { i: "side", x: 8, y: 7, w: 4, h: 2 },
    ]);
    expect(out.map((l) => [l.i, l.y])).toEqual([["low", 3], ["top", 0], ["side", 3]]);
  });
  it("drops a card that starts on top of another just below it, never overlapping", () => {
    const out = compactVertical([L(0, 0, 6, 4), L(2, 1, 6, 2)]);
    expect(out).toEqual([L(0, 0, 6, 4), L(2, 4, 6, 2)]);
  });
  it("is a fixed point: compacting a compacted layout changes nothing", () => {
    const once = compactVertical([L(0, 5, 4, 3), L(4, 12, 8, 2), L(0, 30, 12, 1), L(6, 2, 3, 9)]);
    expect(compactVertical(once)).toEqual(once);
  });
});

describe("withoutWidgetItems and stackOrder", () => {
  it("keeps every built-in card and drops only widget items", () => {
    const layouts = { lg: [{ i: "recent", x: 0 }, { i: "w:abc", x: 4 }], sm: [{ i: "w:abc", x: 0 }] };
    expect(withoutWidgetItems(layouts)).toEqual({ lg: [{ i: "recent", x: 0 }], sm: [] });
    const plain = { lg: [{ i: "recent", x: 0 }] };
    expect(stableStringify(withoutWidgetItems(plain))).toBe(stableStringify(plain));
  });
  it("orders cards top to bottom, then left to right", () => {
    const order = stackOrder([stat("c", { layout: L(6, 3) }), stat("a", { layout: L(0, 0) }), { id: "h", kind: "hidden" }, stat("b", { layout: L(4, 0) })]);
    expect(order.map((w) => w.id)).toEqual(["a", "b", "c", "h"]);
  });
});

describe("local removal, undo and missing cards", () => {
  it("names a removed card only when the server has it, and undo takes the name back", () => {
    const state = { widgets: [stat("a"), stat("new")], removedIds: [] as string[], baseIds: new Set(["a"]) };
    const r1 = removeWidgetLocal(state, "a");
    expect(r1).toEqual({ widgets: [stat("new")], removedIds: ["a"] });
    expect(removeWidgetLocal(state, "new").removedIds).toEqual([]);
    const back = readdWidgetLocal(r1, stat("a"), 0);
    expect(back).toEqual({ widgets: [stat("a"), stat("new")], removedIds: [] });
  });
  it("puts back the cards the server says were left out", () => {
    const merged = mergeMissingWidgets([stat("a")], [stat("a"), stat("b"), stat("c")], ["b"]);
    expect(merged.map((w) => w.id)).toEqual(["a", "b"]);
  });
});

describe("rebaseDashboard", () => {
  const base: DashboardSnapshot = { name: "Ops", widgets: [stat("a"), notes("n"), stat("d"), hiddenCard("h"), stat("r")] };

  it("keeps my changes where I made them and their edits where I did not", () => {
    const local: DashboardSnapshot = { name: "Ops weekly", widgets: [stat("a", { title: "Mine" }), notes("n"), stat("d"), hiddenCard("h"), stat("r")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { scope: "overdue" }), notes("n", "theirs"), stat("d"), hiddenCard("h"), stat("r")] };
    const out = rebaseDashboard(base, local, live);
    expect(out.name).toBe("Ops weekly");
    const a = out.widgets.find((w) => w.id === "a") as Extract<EditorWidget, { kind: "stat" }>;
    expect(a.title).toBe("Mine");
    expect(a.scope).toBe("overdue");
    expect((out.widgets.find((w) => w.id === "n") as { text: string }).text).toBe("theirs");
    expect(out.removedIds).toEqual([]);
  });

  it("never resurrects a card they deleted unless I changed it, and names it as removed", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: [stat("a"), notes("n", "edited by me"), stat("d"), hiddenCard("h"), stat("r")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [stat("r")] };
    const out = rebaseDashboard(base, local, live);
    expect(out.widgets.map((w) => w.id)).toEqual(["n", "r"]);
    expect(out.removedIds).toEqual([]);
  });

  it("keeps a card I deleted deleted, unless they edited it since", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: [notes("n"), hiddenCard("h")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [stat("a"), notes("n"), stat("d", { title: "They renamed" }), hiddenCard("h"), stat("r")] };
    const out = rebaseDashboard(base, local, live);
    expect(out.widgets.map((w) => w.id)).toEqual(["n", "h", "d"]);
    expect(out.removedIds.sort()).toEqual(["a", "r"]);
  });

  it("keeps cards they added and cards I added, and treats a hidden card as always theirs", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: [...base.widgets, stat("mine")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [...base.widgets.filter((w) => w.id !== "h"), stat("theirs")] };
    const out = rebaseDashboard(base, local, live);
    expect(out.widgets.map((w) => w.id)).toEqual(["a", "n", "d", "r", "mine", "theirs"]);
    expect(out.removedIds).toEqual([]);
  });

  it("merges a moved card with their settings change", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: base.widgets.map((w) => (w.id === "d" ? stat("d", { layout: L(6, 6, 3, 3) }) : w)) };
    const live: DashboardSnapshot = { name: "Ops", widgets: base.widgets.map((w) => (w.id === "d" ? stat("d", { metric: { op: "sum", fieldKey: "pts" } }) : w)) };
    const d = rebaseDashboard(base, local, live).widgets.find((w) => w.id === "d") as Extract<EditorWidget, { kind: "stat" }>;
    expect(d.layout).toEqual(L(6, 6, 3, 3));
    expect(d.metric).toEqual({ op: "sum", fieldKey: "pts" });
  });
});

describe("draftHasUnmergedEdits", () => {
  const base: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "first"), stat("a")] };

  it("keeps a draft whose edit never reached the server, even when the row is newer", () => {
    // Save 1 ("second") landed after the draft of save 2 ("third") was written.
    const local: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "third"), stat("a")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "second"), stat("a")] };
    expect(draftHasUnmergedEdits({ base, local, removedIds: [] }, live)).toBe(true);
  });

  it("keeps my failed edit when another editor saved something else later", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "mine"), stat("a")] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "first"), stat("a", { title: "Theirs" })] };
    expect(draftHasUnmergedEdits({ base, local, removedIds: [] }, live)).toBe(true);
  });

  it("keeps a removal and a rename the server does not have", () => {
    expect(draftHasUnmergedEdits({ base, local: { name: "Ops", widgets: [stat("a")] }, removedIds: ["n"] }, base)).toBe(true);
    expect(draftHasUnmergedEdits({ base, local: { name: "Ops weekly", widgets: base.widgets }, removedIds: [] }, base)).toBe(true);
  });

  it("lets go of a draft the server already has, or one with no edits", () => {
    const local: DashboardSnapshot = { name: "Ops", widgets: [notes("n", "second"), stat("a")] };
    expect(draftHasUnmergedEdits({ base, local, removedIds: [] }, local)).toBe(false);
    expect(draftHasUnmergedEdits({ base, local: base, removedIds: [] }, { name: "Ops", widgets: [notes("n", "later")] })).toBe(false);
    // The removed card is gone on the server too.
    expect(draftHasUnmergedEdits({ base, local: { name: "Ops", widgets: [stat("a")] }, removedIds: ["n"] }, { name: "Ops", widgets: [stat("a")] })).toBe(false);
  });
});

describe("classifySaveResponse", () => {
  it("maps every answer the save can get", () => {
    expect(classifySaveResponse(200, {})).toBe("ok");
    expect(classifySaveResponse(409, { error: "conflict" })).toBe("conflict");
    expect(classifySaveResponse(409, { error: "widget_missing", ids: ["a"] })).toBe("widget_missing");
    expect(classifySaveResponse(400, { error: "widget_locked" })).toBe("invalid");
    expect(classifySaveResponse(400, { error: "overview_source" })).toBe("invalid");
    expect(classifySaveResponse(403, { error: "no_access" })).toBe("forbidden");
    expect(classifySaveResponse(404, { error: "Not found" })).toBe("gone");
    expect(classifySaveResponse(401, "Unauthorized")).toBe("unauthorized");
    expect(classifySaveResponse(0, null)).toBe("retry");
    expect(classifySaveResponse(503, { error: "needs_database_update" })).toBe("retry");
    expect(classifySaveResponse(429, null)).toBe("retry");
  });
});

describe("titleEdited on the canvas", () => {
  const flagOf = (w: EditorWidget | WidgetInput | undefined) => (w && "titleEdited" in w ? w.titleEdited : "none");

  it("travels in the save body, and a card without it is sent without it", () => {
    const [typed, auto, old] = toWidgetInputs([stat("t", { titleEdited: true }), stat("a", { titleEdited: false }), stat("o")]);
    expect([flagOf(typed), flagOf(auto), flagOf(old)]).toEqual([true, false, "none"]);
    for (const i of [typed, auto, old]) expect(widgetInputSchema.safeParse(i).success).toBe(true);
  });

  it("is not part of a card's data: flagging a title never refetches its numbers", () => {
    expect(dataKey(stat("a", { titleEdited: true }))).toBe(dataKey(stat("a")));
    const [input] = toWidgetInputs([stat("a", { titleEdited: true })]);
    expect(previewKey(input)).toBe(previewKey(toWidgetInputs([stat("a")])[0]));
  });

  it("flags a data card renamed from its menu as typed, and leaves notes and locked cards alone", () => {
    const out = renameWidgetLocal([stat("a", { titleEdited: false }), notes("n"), hiddenCard("h")], "a", "Tasks by Owner");
    expect(out[0]).toMatchObject({ title: "Tasks by Owner", titleEdited: true });
    expect(renameWidgetLocal([notes("n")], "n", "Read me")[0]).toEqual({ ...notes("n"), title: "Read me" });
    expect(renameWidgetLocal([hiddenCard("h")], "h", "X")[0]).toEqual(hiddenCard("h"));
  });

  it("moves with the title in a rebase: my typed title keeps my flag over their settings change", () => {
    const base: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { title: "Open tasks", titleEdited: false })] };
    const local: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { title: "Open tasks", titleEdited: true })] };
    const live: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { title: "Overdue tasks", titleEdited: false, scope: "overdue" })] };
    const a = rebaseDashboard(base, local, live).widgets[0];
    expect(a).toMatchObject({ title: "Open tasks", titleEdited: true, scope: "overdue" });
    // Their typed title keeps their flag when I only moved the card.
    const moved: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { title: "Open tasks", titleEdited: false, layout: L(6, 0, 3, 3) })] };
    const theirs: DashboardSnapshot = { name: "Ops", widgets: [stat("a", { title: "Q3 blockers", titleEdited: true })] };
    expect(rebaseDashboard(base, moved, theirs).widgets[0]).toMatchObject({ title: "Q3 blockers", titleEdited: true, layout: L(6, 0, 3, 3) });
    // A card with no flag on either side gains none.
    const plain: DashboardSnapshot = { name: "Ops", widgets: [stat("b")] };
    const out = rebaseDashboard(plain, { name: "Ops", widgets: [stat("b", { layout: L(3, 0, 3, 3) })] }, { name: "Ops", widgets: [stat("b", { scope: "overdue" })] }).widgets[0];
    expect(flagOf(out)).toBe("none");
  });
});

describe("dataKey and previewKey", () => {
  it("ignore id, title, place and the partial flag, and see every data setting", () => {
    const a = stat("a");
    expect(dataKey(a)).toBe(dataKey(stat("b", { title: "Other", layout: L(9, 9, 3, 3) })));
    expect(dataKey({ ...a, partial: true } as EditorWidget)).toBe(dataKey(a));
    expect(dataKey(a)).not.toBe(dataKey(stat("a", { scope: "overdue" })));
    const input = toWidgetInputs([a])[0] as WidgetInput;
    expect(previewKey(input)).toBe(previewKey({ ...(input as Extract<WidgetInput, { kind: "stat" }>), id: "zz", title: "T" }));
    expect(previewKey(input)).not.toBe(previewKey({ ...(input as Extract<WidgetInput, { kind: "stat" }>), filter: { connector: "OR", rules: [], hideDone: false } }));
  });
  it("compares objects whatever their key order", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});
