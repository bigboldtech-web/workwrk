import { describe, expect, it } from "vitest";
import { kindMeta, kindsFor, newWidgetId, newWidgetInput, WIDGET_KIND_META } from "./widget-kinds";
import { widgetInputSchema } from "./widgets";

const layout = { x: 0, y: 0, w: 3, h: 3 };

describe("WIDGET_KIND_META", () => {
  it("offers Stat, Chart, List and Text, in that order, with their sizes", () => {
    expect(WIDGET_KIND_META.map((m) => [m.kind, m.label, m.defaultSize.w, m.defaultSize.h])).toEqual([
      ["stat", "Stat", 3, 3],
      ["chart", "Chart", 6, 6],
      ["list", "List", 6, 7],
      ["notes", "Text", 4, 3],
    ]);
    expect(WIDGET_KIND_META.find((m) => m.kind === "stat")?.description).toBe("Count or add up tasks that match a filter");
    expect(WIDGET_KIND_META.find((m) => m.kind === "notes")?.description).toBe("A heading or a note");
  });
  it("offers all four on both surfaces", () => {
    expect(kindsFor("dashboard").map((m) => m.kind)).toEqual(["stat", "chart", "list", "notes"]);
    expect(kindsFor("space-overview").map((m) => m.kind)).toEqual(["stat", "chart", "list", "notes"]);
    expect(kindMeta("chart")?.label).toBe("Chart");
    expect(kindMeta("hologram")).toBeUndefined();
  });
});

describe("newWidgetId", () => {
  it("makes ids the write schema accepts and does not repeat them", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = newWidgetId();
      expect(id).toMatch(/^[A-Za-z0-9_~.-]{1,64}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });
});

describe("newWidgetInput", () => {
  it("builds a valid input for every kind", () => {
    for (const m of WIDGET_KIND_META) {
      const input = newWidgetInput(m.kind, { id: "w_1", layout });
      expect(widgetInputSchema.safeParse(input).success, m.kind).toBe(true);
      expect(input.kind).toBe(m.kind);
    }
  });
  it("starts a card on the Space when it is added to that Space's Overview", () => {
    const onSpace = newWidgetInput("stat", { id: "w_1", spaceId: "S", layout });
    expect(onSpace).toMatchObject({ source: { kind: "space", spaceId: "S" } });
    const onDashboard = newWidgetInput("chart", { id: "w_2", layout });
    expect(onDashboard).toMatchObject({ source: { kind: "all" }, groupBy: "status", display: "bar" });
    expect(newWidgetInput("notes", { id: "w_3", layout })).toEqual({ id: "w_3", kind: "notes", title: "Text", text: "", layout });
  });
});
