import { describe, expect, it } from "vitest";
import {
  checkWidgetRemovals,
  parseWidgets,
  redactWidgetsForReader,
  resolvePassthrough,
  serializeWidgets,
  widgetInputSchema,
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
    const forged = resolvePassthrough([{ id: "keep", kind: "passthrough" }] as WidgetInput[], stored);
    expect(forged).toEqual({ ok: false, error: "unknown_widget", id: "keep" });
    expect(resolvePassthrough([{ id: "new", kind: "passthrough" }] as WidgetInput[], stored)).toEqual({ ok: false, error: "unknown_widget", id: "new" });
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
