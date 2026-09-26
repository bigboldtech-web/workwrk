import { describe, expect, it } from "vitest";
import { ROW_COLORS } from "./list-comfort";
import {
  LIST_SETTINGS_CHANGED,
  ROW_COLOR_TINT,
  orderColumnsForPinning,
  rowHeightStyle,
  stickyOffsets,
} from "./table-comfort";

describe("orderColumnsForPinning", () => {
  const keys = ["name", "owner", "due", "priority", "points", "size"];

  it("changes nothing and pins nothing while no column is pinned", () => {
    expect(orderColumnsForPinning(keys, [])).toEqual({ ordered: keys, stickyCount: 0 });
  });

  it("keeps Name first and moves pinned keys forward, in table order", () => {
    // Pinned in the reverse of table order: they still come out in table order.
    expect(orderColumnsForPinning(keys, ["size", "due"])).toEqual({
      ordered: ["name", "due", "size", "owner", "priority", "points"],
      stickyCount: 3,
    });
  });

  it("ignores unknown and hidden keys, and Name itself", () => {
    expect(orderColumnsForPinning(keys, ["ghost", "name", "priority"])).toEqual({
      ordered: ["name", "priority", "owner", "due", "points", "size"],
      stickyCount: 2,
    });
    expect(orderColumnsForPinning(keys, ["ghost"])).toEqual({ ordered: keys, stickyCount: 0 });
  });

  it("caps the pinned set at ten columns", () => {
    const many = ["name", ...Array.from({ length: 14 }, (_, i) => `c${i}`)];
    const out = orderColumnsForPinning(many, many.slice(1));
    expect(out.stickyCount).toBe(11);
    expect(out.ordered).toEqual(many);
  });
});

describe("stickyOffsets", () => {
  it("is cumulative from the leading width", () => {
    expect(stickyOffsets([34, 240, 112, 90])).toEqual([0, 34, 274, 386]);
    expect(stickyOffsets([])).toEqual([]);
  });
});

describe("rowHeightStyle", () => {
  it("is exactly today's density token for default and for no setting", () => {
    expect(rowHeightStyle("default")).toBe("var(--os-row-h, 44px)");
    expect(rowHeightStyle(undefined)).toBe("var(--os-row-h, 44px)");
    expect(rowHeightStyle(null)).toBe("var(--os-row-h, 44px)");
  });
  it("derives compact and tall from the same token", () => {
    expect(rowHeightStyle("compact")).toBe("max(28px, calc(var(--os-row-h, 44px) - 8px))");
    expect(rowHeightStyle("tall")).toBe("calc(var(--os-row-h, 44px) + 16px)");
  });
});

describe("ROW_COLOR_TINT", () => {
  it("has one token-only value per palette colour", () => {
    expect(Object.keys(ROW_COLOR_TINT).sort()).toEqual([...ROW_COLORS].sort());
    for (const c of ROW_COLORS) {
      const v = ROW_COLOR_TINT[c];
      expect(v).toMatch(/^color-mix\(in srgb, /);
      expect(v).toContain("var(--os-surface)");
      // Tokens only: no hex, no rgb literal.
      expect(v).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(v).not.toMatch(/rgb\(/);
    }
  });
});

describe("LIST_SETTINGS_CHANGED", () => {
  it("is the window event name the List settings panels dispatch", () => {
    expect(LIST_SETTINGS_CHANGED).toBe("workwrk:list-settings-changed");
  });
});
