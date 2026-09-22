import { describe, expect, it } from "vitest";
import { NOT_SYSTEM_ITEMS, SYSTEM_ITEM_TYPES, isSystemItemType } from "./system-items";

describe("system items", () => {
  it("knows a meeting row is the product's own bookkeeping", () => {
    expect(isSystemItemType("meeting")).toBe(true);
  });

  it("treats every real item type as a person's work", () => {
    // "studio-item" is what every Item in this product has carried; if a
    // future board type ever landed in SYSTEM_ITEM_TYPES by accident, a
    // person's whole task list would vanish from My Work with no error.
    expect(isSystemItemType("studio-item")).toBe(false);
    expect(isSystemItemType("task")).toBe(false);
    expect(isSystemItemType("")).toBe(false);
    expect(isSystemItemType(null)).toBe(false);
    expect(isSystemItemType(undefined)).toBe(false);
  });

  it("exposes the where fragment as an exclusion, never an inclusion", () => {
    // Spreading `{ itemType: { in: [...] } }` by mistake would show ONLY
    // meetings on every "my work" surface, which is the opposite failure and
    // is the reason this shape is asserted rather than assumed.
    expect(NOT_SYSTEM_ITEMS).toEqual({ itemType: { notIn: ["meeting"] } });
  });

  it("keeps the fragment and the list in step", () => {
    expect(NOT_SYSTEM_ITEMS.itemType.notIn).toEqual([...SYSTEM_ITEM_TYPES]);
  });

  it("hands out a copy, so a caller cannot edit the shared list", () => {
    const fragment = NOT_SYSTEM_ITEMS.itemType.notIn;
    expect(fragment).not.toBe(SYSTEM_ITEM_TYPES);
  });
});
