import { describe, expect, it } from "vitest";
import { USER_HUES, departmentHue, nearestUserHue } from "./department-hue";

describe("the eight user hues", () => {
  it("are eight, indexed 1 to 8", () => {
    expect(USER_HUES.map((h) => h.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("each maps to itself", () => {
    for (const h of USER_HUES) expect(nearestUserHue(h.hex), h.name).toBe(h.index);
  });
});

describe("departmentHue: the three stored encodings", () => {
  it("null and empty stay empty (the reader draws the neutral chip)", () => {
    expect(departmentHue(null)).toEqual({ kind: "empty", index: null });
    expect(departmentHue("  ")).toEqual({ kind: "empty", index: null });
  });
  it("an index is read as is", () => {
    expect(departmentHue("3")).toEqual({ kind: "index", index: 3 });
  });
  it("the dialog's CSS vars follow the 1.7 migration row", () => {
    expect(departmentHue("var(--os-brand)").index).toBe(1);
    expect(departmentHue("var(--os-c-blue)").index).toBe(1);
    expect(departmentHue("var(--os-c-green)").index).toBe(3);
    expect(departmentHue("var(--os-c-teal)").index).toBe(2);
    expect(departmentHue("var(--os-c-orange)").index).toBe(5);
    expect(departmentHue("var(--os-c-yellow)").index).toBe(4);
    expect(departmentHue("var(--os-c-brown)").index).toBe(4);
    expect(departmentHue("var(--os-c-red)").index).toBe(6);
    expect(departmentHue("var(--os-c-purple)").index).toBe(1);
    expect(departmentHue("var(--os-c-pink)").index).toBe(6);
    expect(departmentHue("var(--os-c-lime)").index).toBe(3);
  });
  it("the seed and setup hexes land on a sensible hue", () => {
    expect(departmentHue("#6C5CE7").index).toBe(1); // purple -> Sky
    expect(departmentHue("#A29BFE").index).toBe(1); // lavender -> Sky
    expect(departmentHue("#0073EA").index).toBe(1);
    expect(departmentHue("#54A0FF").index).toBe(1);
    expect(departmentHue("#00D68F").index).toBe(3); // green -> Moss
    expect(departmentHue("#8BC34A").index).toBe(3);
    expect(departmentHue("#00BCD4").index).toBe(2); // cyan -> Teal
    expect(departmentHue("#FF9F43").index).toBe(4); // orange -> Sand
    expect(departmentHue("#FF6B6B").index).toBe(6); // red -> Rose
    expect(departmentHue("#E056A0").index).toBe(6); // pink -> Rose
    expect(departmentHue("#795548").index).toBe(5); // brick brown -> Clay
    expect(departmentHue("#607D8B").index).toBe(7); // blue grey -> Slate
  });
  it("anything unreadable is reported, never guessed", () => {
    expect(departmentHue("tomato")).toEqual({ kind: "unknown", index: null });
    expect(departmentHue("var(--nope)")).toEqual({ kind: "css-var", index: null });
  });
});
