import { describe, expect, it } from "vitest";
import {
  cardVisibility,
  checkWidgetRemovals,
  parseWidgets,
  redactWidgetForEditor,
  redactWidgetsForReader,
  resolvePassthrough,
  restoreHiddenParts,
  serializeWidgets,
  widgetInputSchema,
  type CardVisibility,
  type RedactContext,
  type Widget,
  type WidgetInput,
} from "./widgets";
import {
  applyWidgetFilter,
  distribution,
  matchesWidgetRule,
  sortListRows,
  statValue,
  type WidgetRow,
} from "./widget-math";

const layout = { x: 0, y: 0, w: 4, h: 4 };

describe("parseWidgets reads the 2026-06 shape", () => {
  const legacy = [
    { id: "w1", type: "task-list", title: "Mine", config: { source: { kind: "board", boardId: "L1", boardName: "Old" } }, layout },
    { id: "w2", type: "stat", title: "Open", config: { source: { kind: "all" }, statScope: "overdue" }, layout },
    { id: "w3", type: "notes", title: "Read me", config: { noteText: "hello" }, layout },
    { id: "w4", type: "battery", title: "Workload", config: {}, layout },
    { id: "w5", type: "chart", title: "By person", config: { chartBy: "assignee", chartKind: "pie" }, layout },
  ];
  it("into the current kinds, card by card", () => {
    const w = parseWidgets(legacy);
    expect(w.map((x) => x.kind)).toEqual(["list", "stat", "notes", "chart", "chart"]);
    expect(w[0]).toMatchObject({ kind: "list", source: { kind: "lists", listIds: ["L1"] }, title: "Mine" });
    expect(w[1]).toMatchObject({ kind: "stat", scope: "overdue", metric: { op: "count" }, source: { kind: "all" } });
    expect(w[2]).toMatchObject({ kind: "notes", text: "hello" });
    expect(w[3]).toMatchObject({ kind: "chart", groupBy: "status", display: "bar" });
    expect(w[4]).toMatchObject({ kind: "chart", groupBy: "assignee", display: "donut" });
  });
  it("never drops an entry it does not recognise, a duplicate or an id-less one", () => {
    const odd = { id: "w9", type: "hologram", config: { beam: true } };
    const w = parseWidgets([odd, { id: "w1", kind: "notes", title: "A", text: "", layout }, { id: "w1", kind: "notes", title: "B", text: "", layout }, "loose", { kind: "stat", source: { kind: "all" }, layout }]);
    expect(w).toHaveLength(5);
    expect(w[0]).toEqual({ id: "w9", kind: "passthrough", raw: odd });
    expect(w[2].kind).toBe("passthrough");
    expect(w[2].id).not.toBe("w1");
    expect(w[3]).toEqual({ id: "legacy-3", kind: "passthrough", raw: "loose" });
    expect(w[4]).toMatchObject({ id: "legacy-4", kind: "stat" });
    expect(parseWidgets(null)).toEqual([]);
  });
  it("round-trips the current shape and writes a passthrough back verbatim", () => {
    const current: Widget[] = [
      { id: "s", kind: "stat", title: "Sum", source: { kind: "lists", listIds: ["A"] }, filter: { connector: "AND", rules: [{ field: "points", operator: "isSet", value: "" }], hideDone: true }, metric: { op: "sum", fieldKey: "points" }, scope: "open", layout },
      { id: "p", kind: "passthrough", raw: { id: "p", type: "future", x: [1, 2] } },
    ];
    const again = parseWidgets(serializeWidgets(current));
    expect(again).toEqual(current);
    expect(serializeWidgets(current)[1]).toEqual({ id: "p", type: "future", x: [1, 2] });
  });
});

describe("writing widgets", () => {
  const stored = parseWidgets([
    { id: "keep", kind: "notes", title: "N", text: "t", layout },
    { id: "odd", type: "hologram" },
  ]);
  it("validates the write shape", () => {
    expect(widgetInputSchema.safeParse({ id: "a", kind: "stat", title: "T", source: { kind: "all" }, layout }).success).toBe(true);
    expect(widgetInputSchema.safeParse({ id: "a", kind: "stat", title: "T", source: { kind: "lists", listIds: [] }, layout }).success).toBe(false);
    expect(widgetInputSchema.safeParse({ id: "a b", kind: "notes", title: "T", text: "", layout }).success).toBe(false);
    expect(widgetInputSchema.safeParse({ id: "a", kind: "chart", title: "T", source: { kind: "all" }, groupBy: "mood", layout }).success).toBe(false);
  });
  it("replaces a submitted passthrough by the STORED value", () => {
    const submitted = [{ id: "odd", kind: "passthrough" }] as WidgetInput[];
    const r = resolvePassthrough(submitted, stored);
    expect(r.ok && r.widgets[0]).toEqual(stored[1]);
    // Any stored card may be kept by naming it: that is how an editor keeps a
    // card they are not shown. The value is still the stored one, verbatim.
    const kept = resolvePassthrough([{ id: "keep", kind: "passthrough" }] as WidgetInput[], stored);
    expect(kept).toEqual({ ok: true, widgets: [stored[0]] });
    expect(resolvePassthrough([{ id: "new", kind: "passthrough" }] as WidgetInput[], stored)).toEqual({ ok: false, error: "unknown_widget", id: "new" });
    expect(resolvePassthrough([{ id: "odd", kind: "passthrough" }] as WidgetInput[], [])).toEqual({ ok: false, error: "unknown_widget", id: "odd" });
  });
  it("fills the defaults of a data card", () => {
    const r = resolvePassthrough([{ id: "c", kind: "chart", title: "T", source: { kind: "lists", listIds: ["A", "A"] }, groupBy: "status", layout }] as WidgetInput[], []);
    expect(r.ok && r.widgets[0]).toEqual({ id: "c", kind: "chart", title: "T", source: { kind: "lists", listIds: ["A"] }, filter: { connector: "AND", rules: [], hideDone: false }, groupBy: "status", display: "bar", layout });
  });
  it("refuses to lose a card the submission merely leaves out", () => {
    expect(checkWidgetRemovals(stored, ["keep"], [])).toEqual(["odd"]);
    expect(checkWidgetRemovals(stored, ["keep"], ["odd"])).toEqual([]);
  });
});

// Who wrote a card's title (titleEdited) is what keeps a typed title from
// being replaced by its settings, so it must come back from every step a
// save takes: the write schema, resolvePassthrough, the stored JSON and the
// read. A card stored before the flag must still load, without one.
describe("titleEdited survives the round trip", () => {
  const src = { kind: "lists" as const, listIds: ["A"] };
  const typed = { id: "t", kind: "chart", title: "Tasks by Owner", titleEdited: true, source: src, groupBy: { field: "owner" }, layout };
  const auto = { id: "a", kind: "stat", title: "Open tasks", titleEdited: false, source: src, scope: "open", layout };

  it("is accepted by the write schema as a boolean and kept by it", () => {
    const parsed = widgetInputSchema.safeParse(typed);
    expect(parsed.success && parsed.data).toMatchObject({ titleEdited: true });
    expect(widgetInputSchema.safeParse(auto).success).toBe(true);
    expect(widgetInputSchema.safeParse({ ...typed, titleEdited: "yes" }).success).toBe(false);
    for (const kind of ["stat", "chart", "list"]) {
      const card = { id: "k", kind, title: "T", titleEdited: true, source: src, groupBy: "status", layout };
      const r = widgetInputSchema.safeParse(card);
      expect(r.success && "titleEdited" in r.data && r.data.titleEdited).toBe(true);
    }
  });

  it("is kept from the submitted card to the stored JSON and back", () => {
    const inputs = [typed, auto].map((w) => widgetInputSchema.parse(w));
    const r = resolvePassthrough(inputs, []);
    expect(r.ok && r.widgets.map((w) => ("titleEdited" in w ? w.titleEdited : "none"))).toEqual([true, false]);
    const stored = serializeWidgets(r.ok ? r.widgets : []) as Array<Record<string, unknown>>;
    expect(stored.map((w) => w.titleEdited)).toEqual([true, false]);
    const back = parseWidgets(JSON.parse(JSON.stringify(stored)));
    expect(back.map((w) => ("titleEdited" in w ? w.titleEdited : "none"))).toEqual([true, false]);
    expect(serializeWidgets(back)).toEqual(stored);
  });

  it("loads a card stored before the flag with no flag, and writes it back without one", () => {
    const old = { id: "o", kind: "chart", title: "Tasks by Owner", source: src, filter: { connector: "AND", rules: [], hideDone: false }, groupBy: { field: "owner" }, display: "bar", layout };
    const [w] = parseWidgets([old]);
    expect(w).toMatchObject({ id: "o", kind: "chart", title: "Tasks by Owner" });
    expect("titleEdited" in w).toBe(false);
    expect(serializeWidgets([w])).toEqual([old]);
    // A flag that is not a boolean is not a flag.
    const [odd] = parseWidgets([{ ...old, titleEdited: "true" }]);
    expect("titleEdited" in odd).toBe(false);
  });

  it("keeps the stored flag when a client that does not know it saves the same title", () => {
    const stored = parseWidgets([{ ...typed, filter: { connector: "AND", rules: [], hideDone: false }, display: "bar" }]);
    const moved = { id: "t", kind: "chart", title: "Tasks by Owner", source: src, groupBy: { field: "owner" }, layout: { ...layout, x: 4 } } as WidgetInput;
    const r = resolvePassthrough([moved], stored);
    expect(r.ok && r.widgets[0]).toMatchObject({ titleEdited: true, layout: { x: 4 } });
    // A new title sent without the flag: nobody can say who wrote it.
    const renamed = resolvePassthrough([{ ...moved, title: "Owners" } as WidgetInput], stored);
    expect(renamed.ok && "titleEdited" in renamed.widgets[0]).toBe(false);
    // A flag that is sent always wins.
    const cleared = resolvePassthrough([{ ...moved, titleEdited: false } as WidgetInput], stored);
    expect(cleared.ok && cleared.widgets[0]).toMatchObject({ titleEdited: false });
  });
});

describe("redactWidgetsForReader", () => {
  const cards = parseWidgets([
    { id: "notes", kind: "notes", title: "N", text: "t", layout },
    { id: "odd", type: "hologram" },
    { id: "private", kind: "stat", title: "Secret revenue", source: { kind: "lists", listIds: ["P"] }, layout },
    { id: "mixed", kind: "list", title: "Mixed", source: { kind: "lists", listIds: ["A", "P"] }, filter: { rules: [{ field: "status", operator: "is", value: "DONE" }, { field: "revenue", operator: "isSet", value: "" }, { field: "points", operator: "isSet", value: "" }] }, layout },
    { id: "bygroup", kind: "chart", title: "By revenue", source: { kind: "lists", listIds: ["A", "P"] }, groupBy: { field: "revenue" }, layout },
    { id: "space", kind: "stat", title: "Space", source: { kind: "space", spaceId: "S-private" }, layout },
    { id: "sum", kind: "stat", title: "Sum", source: { kind: "lists", listIds: ["A", "P"] }, metric: { op: "sum", fieldKey: "revenue" }, layout },
  ]);
  const ctx: RedactContext = {
    readableListsFor: (s) => (s.kind === "space" ? (s.spaceId === "S-private" ? null : []) : s.kind === "lists" ? s.listIds.filter((id) => id === "A") : ["A"]),
    fieldKeysByList: new Map([["A", new Set(["points"])], ["P", new Set(["revenue"])]]),
  };
  it("shows notes, hides what the viewer cannot read, and says nothing about it", () => {
    const out = redactWidgetsForReader(cards, ctx);
    expect(out[0]).toEqual(cards[0]);
    expect(out[1]).toEqual({ id: "odd", kind: "hidden" });
    expect(out[2]).toEqual({ id: "private", kind: "hidden", layout });
    expect(JSON.stringify(out[2])).not.toContain("Secret");
    expect(out[5]).toEqual({ id: "space", kind: "hidden", layout });
  });
  it("reduces a partly readable card to what the viewer can read", () => {
    const out = redactWidgetsForReader(cards, ctx);
    expect(out[3]).toMatchObject({ kind: "list", title: "Mixed", source: { kind: "lists", listIds: ["A"] } });
    expect((out[3] as { filter: { rules: Array<{ field: string }> } }).filter.rules.map((r) => r.field)).toEqual(["status", "points"]);
    expect(out[4]).toEqual({ id: "bygroup", kind: "hidden", layout });
    expect(out[6]).toEqual({ id: "sum", kind: "hidden", layout });
    expect(JSON.stringify(out)).not.toContain('"P"');
  });
});

describe("editors see only what they can read, and a save keeps the rest", () => {
  const cards = parseWidgets([
    { id: "notes", kind: "notes", title: "N", text: "t", layout },
    { id: "odd", type: "hologram", secret: "P" },
    { id: "private", kind: "stat", title: "Secret revenue", source: { kind: "lists", listIds: ["P"] }, layout },
    { id: "mixed", kind: "list", title: "Mixed", source: { kind: "lists", listIds: ["A", "P"] }, filter: { rules: [{ field: "status", operator: "is", value: "DONE" }, { field: "revenue", operator: "isSet", value: "" }, { field: "points", operator: "isSet", value: "" }] }, layout },
    { id: "space", kind: "stat", title: "Space", source: { kind: "space", spaceId: "S-private" }, layout },
    { id: "open", kind: "chart", title: "Readable", source: { kind: "lists", listIds: ["A"] }, groupBy: "status", layout },
    { id: "bygroup", kind: "chart", title: "By revenue", source: { kind: "lists", listIds: ["A", "P"] }, groupBy: { field: "revenue" }, layout },
  ]);
  const ctx: RedactContext = {
    readableListsFor: (s) => (s.kind === "space" ? (s.spaceId === "S-private" ? null : []) : s.kind === "lists" ? s.listIds.filter((id) => id === "A") : ["A"]),
    fieldKeysByList: new Map([["A", new Set(["points"])], ["P", new Set(["revenue"])]]),
  };
  const byId = (id: string) => cards.find((w) => w.id === id) as Widget;
  const visibility = new Map<string, CardVisibility>(cards.map((w) => [w.id, cardVisibility(w, ctx)] as const));

  it("classifies each card for the editor", () => {
    expect(cardVisibility(byId("notes"), ctx)).toEqual({ kind: "full" });
    expect(cardVisibility(byId("odd"), ctx)).toEqual({ kind: "full" });
    expect(cardVisibility(byId("private"), ctx)).toEqual({ kind: "hidden" });
    expect(cardVisibility(byId("space"), ctx)).toEqual({ kind: "hidden" });
    expect(cardVisibility(byId("bygroup"), ctx)).toEqual({ kind: "hidden" });
    expect(cardVisibility(byId("open"), ctx)).toEqual({ kind: "full" });
    expect(cardVisibility(byId("mixed"), ctx)).toEqual({ kind: "partial", hiddenListIds: ["P"], hiddenRules: [{ field: "revenue", operator: "isSet", value: "" }] });
  });

  it("gives the editor no title, config or raw value of what they cannot read", () => {
    const out = cards.map((w) => redactWidgetForEditor(w, ctx));
    expect(out[1]).toEqual({ id: "odd", kind: "passthrough", raw: null });
    expect(out[2]).toEqual({ id: "private", kind: "hidden", layout });
    expect(out[4]).toEqual({ id: "space", kind: "hidden", layout });
    expect(out[3]).toMatchObject({ kind: "list", partial: true, source: { kind: "lists", listIds: ["A"] } });
    expect((out[3] as { filter: { rules: Array<{ field: string }> } }).filter.rules.map((r) => r.field)).toEqual(["status", "points"]);
    expect(out[5]).toEqual(byId("open"));
    const text = JSON.stringify(out);
    expect(text).not.toContain('"P"');
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("revenue");
  });

  it("keeps a hidden card only verbatim, and refuses any other value for it", () => {
    const kept = restoreHiddenParts(cards, [byId("private")], visibility);
    expect(kept).toEqual({ ok: true, widgets: [byId("private")] });
    const forged = { ...(byId("private") as Extract<Widget, { kind: "stat" }>), title: "Mine now" };
    expect(restoreHiddenParts(cards, [forged], visibility)).toEqual({ ok: false, error: "widget_locked", id: "private" });
  });

  it("appends the Lists and rules the editor could not see to their edit of a partial card", () => {
    const edited = { ...(byId("mixed") as Extract<Widget, { kind: "list" }>), title: "Renamed", source: { kind: "lists" as const, listIds: ["A", "B"] }, filter: { connector: "AND" as const, rules: [{ field: "points", operator: "isSet" as const, value: "" }], hideDone: true } };
    const r = restoreHiddenParts(cards, [edited], visibility);
    expect(r.ok).toBe(true);
    const w = r.ok ? (r.widgets[0] as Extract<Widget, { kind: "list" }>) : null;
    expect(w?.title).toBe("Renamed");
    expect(w?.source).toEqual({ kind: "lists", listIds: ["A", "B", "P"] });
    expect(w?.filter.rules.map((x) => x.field)).toEqual(["points", "revenue"]);
    expect(w?.filter.hideDone).toBe(true);
  });

  it("locks a partial card's source to a List set and refuses to cut past the limits", () => {
    const toAll = { ...(byId("mixed") as Extract<Widget, { kind: "list" }>), source: { kind: "all" as const } };
    expect(restoreHiddenParts(cards, [toAll], visibility)).toEqual({ ok: false, error: "source_locked", id: "mixed" });
    const many = { ...(byId("mixed") as Extract<Widget, { kind: "list" }>), source: { kind: "lists" as const, listIds: Array.from({ length: 50 }, (_, i) => `L${i}`) } };
    expect(restoreHiddenParts(cards, [many], visibility)).toEqual({ ok: false, error: "too_many_lists", id: "mixed" });
    const rules = Array.from({ length: 20 }, () => ({ field: "status", operator: "is" as const, value: "x" }));
    const lotsOfRules = { ...(byId("mixed") as Extract<Widget, { kind: "list" }>), filter: { connector: "AND" as const, rules, hideDone: false } };
    expect(restoreHiddenParts(cards, [lotsOfRules], visibility)).toEqual({ ok: false, error: "too_many_rules", id: "mixed" });
  });

  it("takes a new card and a fully readable card as sent, and fails closed on a stored card it was told nothing about", () => {
    const fresh: Widget = { id: "fresh", kind: "notes", title: "New", text: "", layout };
    const changedOpen = { ...(byId("open") as Extract<Widget, { kind: "chart" }>), display: "donut" as const };
    const r = restoreHiddenParts(cards, [fresh, changedOpen], visibility);
    expect(r).toEqual({ ok: true, widgets: [fresh, changedOpen] });
    const blind = restoreHiddenParts(cards, [changedOpen], new Map());
    expect(blind).toEqual({ ok: false, error: "widget_locked", id: "open" });
  });
});

const row = (over: Partial<WidgetRow> = {}): WidgetRow => ({
  id: "r",
  title: "Task",
  status: "TO_DO",
  done: false,
  priority: null,
  dueAt: null,
  startAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  ownerId: null,
  assigneeIds: [],
  itemTypeId: null,
  tagIds: [],
  listId: "A",
  metadata: {},
  ...over,
});

describe("widget math", () => {
  it("reads a due-date rule's day in the viewer's zone", () => {
    // 2026-09-24T20:00Z is already 25 September in Kolkata.
    const r = row({ dueAt: new Date("2026-09-24T20:00:00Z") });
    expect(matchesWidgetRule(r, { field: "due", operator: "on", value: "2026-09-25" }, "Asia/Kolkata")).toBe(true);
    expect(matchesWidgetRule(r, { field: "due", operator: "on", value: "2026-09-25" }, "UTC")).toBe(false);
    expect(matchesWidgetRule(r, { field: "due", operator: "before", value: "2026-09-25" }, "UTC")).toBe(true);
    expect(matchesWidgetRule(r, { field: "due", operator: "before", value: "2026-09-25" }, "Asia/Kolkata")).toBe(false);
    expect(matchesWidgetRule(r, { field: "due", operator: "after", value: "2026-09-23" }, "UTC")).toBe(true);
  });
  it("matches assignees across the whole set, and custom fields as text", () => {
    const r = row({ ownerId: "u1", assigneeIds: ["u1", "u2"], metadata: { size: "Large" } });
    expect(matchesWidgetRule(r, { field: "assignee", operator: "is", value: "u2" }, "UTC")).toBe(true);
    expect(matchesWidgetRule(r, { field: "size", operator: "contains", value: "larg" }, "UTC")).toBe(true);
    expect(matchesWidgetRule(r, { field: "size", operator: "isNotSet", value: "" }, "UTC")).toBe(false);
  });
  it("applies the connector, skips incomplete rules and hides done rows on request", () => {
    const rows = [row({ id: "a", status: "DONE", done: true }), row({ id: "b", priority: "HIGH" }), row({ id: "c" })];
    expect(applyWidgetFilter(rows, { connector: "AND", rules: [{ field: "priority", operator: "is", value: "" }], hideDone: true }, "UTC").map((r) => r.id)).toEqual(["b", "c"]);
    expect(applyWidgetFilter(rows, { connector: "OR", rules: [{ field: "status", operator: "is", value: "done" }, { field: "priority", operator: "is", value: "HIGH" }], hideDone: false }, "UTC").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("counts by scope and sums a numeric field", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const rows = [
      row({ done: true, metadata: { points: 3 } }),
      row({ dueAt: new Date("2026-09-20T00:00:00Z"), metadata: { points: "2" } }),
      row({ metadata: { points: "x" } }),
    ];
    expect(statValue(rows, { op: "count" }, "total", now)).toBe(3);
    expect(statValue(rows, { op: "count" }, "open", now)).toBe(2);
    expect(statValue(rows, { op: "count" }, "completed", now)).toBe(1);
    expect(statValue(rows, { op: "count" }, "overdue", now)).toBe(1);
    expect(statValue(rows, { op: "sum", fieldKey: "points" }, "total", now)).toBe(5);
  });
  it("buckets a distribution, a person with every task they hold", () => {
    const rows = [row({ ownerId: "u1", assigneeIds: ["u1", "u2"] }), row({ ownerId: "u2", assigneeIds: ["u2"] }), row()];
    const b = distribution(rows, "assignee", (k) => ({ label: k ?? "Unassigned", color: null }));
    expect(b).toEqual([
      { key: "u2", label: "u2", color: null, count: 2 },
      { key: "u1", label: "u1", color: null, count: 1 },
      { key: null, label: "Unassigned", color: null, count: 1 },
    ]);
    const byField = distribution([row({ metadata: { tags2: ["a", "b"] } }), row({ metadata: { tags2: ["a"] } })], { field: "tags2" }, (k) => ({ label: k ?? "None", color: null }));
    expect(byField.map((x) => [x.key, x.count])).toEqual([["a", 2], ["b", 1]]);
  });
  it("sorts and cuts a list card", () => {
    const rows = [
      row({ id: "a", title: "b", dueAt: new Date("2026-09-30T00:00:00Z"), priority: "LOW" }),
      row({ id: "b", title: "a", dueAt: null, priority: "URGENT" }),
      row({ id: "c", title: "c", dueAt: new Date("2026-09-25T00:00:00Z"), priority: "HIGH" }),
    ];
    expect(sortListRows(rows, "due", 10).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortListRows(rows, "priority", 2).map((r) => r.id)).toEqual(["b", "c"]);
    expect(sortListRows(rows, "title", 1).map((r) => r.id)).toEqual(["b"]);
  });
});
