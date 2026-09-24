import { describe, expect, it } from "vitest";
import {
  COLUMN_TYPE_CHOICES, cellFitsType, cleanColumnName, columnTypeLabel,
  countTypeChangeLosses, derivedSelectOptions, typeChangePatch,
} from "./sheet-columns";

describe("the seventeen column types", () => {
  it("lists seventeen, ten before Show more", () => {
    expect(COLUMN_TYPE_CHOICES).toHaveLength(17);
    expect(COLUMN_TYPE_CHOICES.filter((c) => !c.more)).toHaveLength(10);
    expect(COLUMN_TYPE_CHOICES.slice(0, 10).every((c) => !c.more)).toBe(true);
  });
  it("names every type, the legacy email included", () => {
    expect(columnTypeLabel("short_text")).toBe("Text");
    expect(columnTypeLabel("link")).toBe("Link to another table");
    expect(columnTypeLabel("url")).toBe("Link");
    expect(columnTypeLabel("email")).toBe("Email");
  });
});

describe("cellFitsType and the type-change confirm count", () => {
  it("counts non-numbers going to Number, and nothing blank", () => {
    expect(countTypeChangeLosses(["12", 3, "abc", "", null, "$1,200"], "number")).toBe(1);
  });
  it("counts every non-blank stored value going to a computed type", () => {
    expect(countTypeChangeLosses(["a", 2, "", null], "formula")).toBe(2);
  });
  it("lets a per-cell formula survive any non-computed type", () => {
    expect(cellFitsType({ "=": "A1+1" }, "number")).toBe(true);
    expect(cellFitsType({ "=": "A1+1" }, "lookup")).toBe(false);
  });
  it("reads dates, checkboxes and select options", () => {
    expect(cellFitsType("2026-09-23", "date")).toBe(true);
    expect(cellFitsType("soon", "date")).toBe(false);
    expect(cellFitsType(true, "checkbox")).toBe(true);
    expect(cellFitsType("yes", "checkbox")).toBe(false);
    expect(cellFitsType("Open", "select", ["Open", "Done"])).toBe(true);
    expect(cellFitsType("Other", "select", ["Open", "Done"])).toBe(false);
  });
  it("a plain string does not fit a multi-select (the grid draws it blank)", () => {
    expect(cellFitsType("Open", "multi_select", ["Open"])).toBe(false);
    expect(cellFitsType(["Open"], "multi_select", ["Open"])).toBe(true);
  });
  it("text shows scalars but not lists", () => {
    expect(cellFitsType(12, "short_text")).toBe(true);
    expect(cellFitsType(["a"], "short_text")).toBe(false);
  });
});

describe("derivedSelectOptions", () => {
  it("keeps the distinct values in first-seen order", () => {
    expect(derivedSelectOptions(["Open", "Done", "Open", "", null, ["Done", "Later"], 3])).toEqual(["Open", "Done", "Later", "3"]);
  });
  it("caps the list", () => {
    expect(derivedSelectOptions(Array.from({ length: 80 }, (_, i) => `v${i}`), 50)).toHaveLength(50);
  });
});

describe("typeChangePatch", () => {
  it("seeds a currency format the way the 123 menu does", () => {
    const p = typeChangePatch({ type: "short_text" }, "currency");
    expect(p.type).toBe("currency");
    expect(p.format).toMatchObject({ style: "currency", decimals: 2 });
  });
  it("keeps the person's format when the kind is unchanged", () => {
    const p = typeChangePatch({ type: "number", format: { decimals: 4 } }, "number");
    expect(p.format).toEqual({ decimals: 4 });
  });
  it("starts a select with the values already in the column", () => {
    expect(typeChangePatch({ type: "short_text" }, "select", ["Open", "Done", "Open"]).options).toEqual(["Open", "Done"]);
    expect(typeChangePatch({ type: "select", options: ["X"] }, "multi_select", ["Open"]).options).toBeUndefined();
  });
  it("clears a number format on a non-number type", () => {
    expect(typeChangePatch({ type: "currency", format: { style: "currency" } }, "long_text").format).toBeUndefined();
  });
});

describe("cleanColumnName", () => {
  it("trims, caps and strips brackets that would break [Name] refs", () => {
    expect(cleanColumnName("  Revenue  ")).toBe("Revenue");
    expect(cleanColumnName("Q[1]")).toBe("Q1");
    expect(cleanColumnName("x".repeat(200))).toHaveLength(120);
  });
});
