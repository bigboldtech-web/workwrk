import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_FIELDS,
  ITEM_FIELD_LABELS,
  ITEM_FIELD_ORDER,
  addFieldRows,
  fieldAllowed,
  isItemFieldKey,
  listFieldRows,
  resolveVisibleFields,
  resolveVisibleListFields,
  toggleStoredField,
  toggleStoredListField,
  type ItemFieldKey,
} from "./item-fields";

const none = () => false;
const all = () => true;

describe("item-fields", () => {
  it("labels every field exactly once", () => {
    for (const key of ITEM_FIELD_ORDER) {
      expect(ITEM_FIELD_LABELS[key], key).toBeTruthy();
    }
    expect(new Set(Object.values(ITEM_FIELD_LABELS)).size).toBe(ITEM_FIELD_ORDER.length);
  });

  it("shows the four defaults on a task nobody has configured", () => {
    expect(resolveVisibleFields({ hasValue: none })).toEqual([...DEFAULT_ITEM_FIELDS]);
  });

  it("keeps the four defaults even when a stored set drops them", () => {
    const visible = resolveVisibleFields({ stored: ["tags"], hasValue: none });
    for (const key of DEFAULT_ITEM_FIELDS) expect(visible).toContain(key);
    expect(visible).toContain("tags");
  });

  it("renders in the canon order, never the order they were checked", () => {
    const visible = resolveVisibleFields({ stored: ["watchers", "tags", "status"], hasValue: none });
    expect(visible).toEqual(ITEM_FIELD_ORDER.filter((k) => visible.includes(k)));
  });

  // The rule that keeps a value from vanishing.
  it("never hides a field that carries a value", () => {
    const visible = resolveVisibleFields({
      stored: [...DEFAULT_ITEM_FIELDS],
      hasValue: (k) => k === "estimate",
    });
    expect(visible).toContain("estimate");
  });

  it("drops a field whose module is off, value or not, stored or not", () => {
    const gating = { priority: false, tags: false, timeTracking: false, customFields: true };
    const visible = resolveVisibleFields({ stored: ["tags", "timeTracked"], hasValue: all, gating });
    expect(visible).not.toContain("tags");
    expect(visible).not.toContain("timeTracked");
    expect(visible).not.toContain("priority");
    expect(visible).toContain("status");
  });

  it("hides KRA / KPI from a Guest", () => {
    const visible = resolveVisibleFields({ stored: ["alignment"], hasValue: all, hideAlignment: true });
    expect(visible).not.toContain("alignment");
  });

  it("fieldAllowed treats absent gating as everything on", () => {
    for (const key of ITEM_FIELD_ORDER) expect(fieldAllowed(key, null)).toBe(true);
  });

  it("isItemFieldKey rejects anything not in the table", () => {
    expect(isItemFieldKey("status")).toBe(true);
    expect(isItemFieldKey("nope")).toBe(false);
    expect(isItemFieldKey(7)).toBe(false);
  });

  describe("addFieldRows", () => {
    it("never offers one of the four pinned defaults", () => {
      const rows = addFieldRows({ hasValue: none });
      for (const key of DEFAULT_ITEM_FIELDS) {
        expect(rows.find((r) => r.key === key)).toBeUndefined();
      }
    });

    it("checks a row that is visible only because it holds a value, and says so", () => {
      const rows = addFieldRows({ stored: [...DEFAULT_ITEM_FIELDS], hasValue: (k) => k === "tags" });
      const tags = rows.find((r) => r.key === "tags");
      expect(tags?.checked).toBe(true);
      expect(tags?.lockedByValue).toBe(true);
    });

    it("does not mark a stored row as locked by its value", () => {
      const rows = addFieldRows({ stored: ["tags"], hasValue: (k) => k === "tags" });
      expect(rows.find((r) => r.key === "tags")?.lockedByValue).toBe(false);
    });
  });

  describe("toggleStoredField", () => {
    it("adds and removes, and is its own inverse", () => {
      const on = toggleStoredField([...DEFAULT_ITEM_FIELDS], "tags");
      expect(on).toContain("tags");
      const off = toggleStoredField(on, "tags");
      expect(off).not.toContain("tags");
      expect(off).toEqual([...DEFAULT_ITEM_FIELDS]);
    });

    it("cannot turn a pinned default off", () => {
      const next = toggleStoredField([...DEFAULT_ITEM_FIELDS], "status");
      expect(next).toContain("status");
    });

    it("writes the canon order, so the same selection is the same array", () => {
      const a = toggleStoredField(["watchers", ...DEFAULT_ITEM_FIELDS] as ItemFieldKey[], "tags");
      const b = toggleStoredField(["tags", ...DEFAULT_ITEM_FIELDS] as ItemFieldKey[], "watchers");
      expect(a).toEqual(b);
    });

    it("drops junk a broken client may have stored", () => {
      const next = toggleStoredField(["status", "not-a-field"], "tags");
      expect(next).not.toContain("not-a-field");
    });
  });
});

// A List's OWN fields. Before these, the only door to them was a reveal row
// that appeared only while at least one of them already carried a value, so a
// List whose custom fields were all empty had no way to show them at all.
describe("the List's own fields", () => {
  const fields = [
    { key: "vendor", label: "Vendor" },
    { key: "budget", label: "Budget" },
  ];
  const none = () => false;

  it("offers every custom field of the List, checked or not", () => {
    const rows = listFieldRows({ fields, stored: [], hasValue: none });
    expect(rows.map((r) => r.key)).toEqual(["vendor", "budget"]);
    expect(rows.every((r) => !r.checked)).toBe(true);
  });

  it("shows a checked one in the strip", () => {
    expect(resolveVisibleListFields({ fields, stored: ["budget"], hasValue: none })).toEqual(["budget"]);
  });

  it("never hides one that carries a value", () => {
    const visible = resolveVisibleListFields({ fields, stored: [], hasValue: (k) => k === "vendor" });
    expect(visible).toEqual(["vendor"]);
    const rows = listFieldRows({ fields, stored: [], hasValue: (k) => k === "vendor" });
    expect(rows.find((r) => r.key === "vendor")).toMatchObject({ checked: true, lockedByValue: true });
  });

  it("drops the whole set when the Custom fields module is off, value or not", () => {
    const gating = { priority: true, tags: true, timeTracking: true, customFields: false };
    expect(listFieldRows({ fields, stored: ["budget"], hasValue: () => true, gating })).toEqual([]);
    expect(resolveVisibleListFields({ fields, stored: ["budget"], hasValue: () => true, gating })).toEqual([]);
  });

  it("toggles one key without touching the others", () => {
    expect(toggleStoredListField(["vendor"], "budget")).toEqual(["vendor", "budget"]);
    expect(toggleStoredListField(["vendor", "budget"], "vendor")).toEqual(["budget"]);
  });

  // An older List may hold a field keyed "tags", beside the built-in Tags.
  it("keeps a field keyed like a built-in apart from that built-in", () => {
    const clashing = [{ key: "tags", label: "Tags (ours)" }];
    // The built-in Tags checked: the field stays unchecked.
    expect(listFieldRows({ fields: clashing, stored: ["status", "tags"], hasValue: none })[0].checked).toBe(false);
    // Checking the field stores its own id and leaves the built-in alone.
    const next = toggleStoredListField([], "tags");
    expect(next).toEqual(["field:tags"]);
    expect(next.filter(isItemFieldKey)).toEqual([]);
    expect(resolveVisibleListFields({ fields: clashing, stored: next, hasValue: none })).toEqual(["tags"]);
    expect(resolveVisibleFields({ stored: next, hasValue: none })).not.toContain("tags");
    // And unchecking it removes only its own id.
    expect(toggleStoredListField(["tags", "field:tags"], "tags")).toEqual(["tags"]);
  });
});
