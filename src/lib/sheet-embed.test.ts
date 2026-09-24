import { describe, expect, it } from "vitest";
import { buildEmbedSnapshot, columnDisplayName, embedCellText, pageEmbedRows } from "./sheet-embed";

describe("columnDisplayName", () => {
  it("prefers the name and falls back to the letter", () => {
    expect(columnDisplayName("Revenue", 0)).toBe("Revenue");
    expect(columnDisplayName("", 0)).toBe("A");
    expect(columnDisplayName("   ", 27)).toBe("AB");
    expect(columnDisplayName(undefined, 2)).toBe("C");
  });
});

describe("buildEmbedSnapshot (the public embed's computed values)", () => {
  const columns = [
    { id: "a", type: "number", label: "" },
    { id: "b", type: "number", label: "Price" },
    { id: "c", type: "short_text", label: "" },
    { id: "d", type: "short_text", label: "" },
  ];
  const rows = [
    { id: "r1", values: { a: 2, b: 3, c: { "=": "A1*B1" } } },
    { id: "r2", values: { a: 5, b: 1, c: { "=": "SUM(A1:A2)" } } },
    { id: "r3", values: {} },
    { id: "r4", values: {} },
  ];

  it("renders formula cells as their values, never [object Object]", () => {
    const s = buildEmbedSnapshot({ columns, rows });
    expect(s.rows[0].cells[2]).toBe("6");
    expect(s.rows[1].cells[2]).toBe("7");
    expect(JSON.stringify(s)).not.toContain("[object Object]");
  });

  it("names headers, letters the unnamed ones, and aligns numbers right", () => {
    const s = buildEmbedSnapshot({ columns, rows });
    expect(s.columns.map((c) => c.name)).toEqual(["A", "Price", "C"]);
    expect(s.columns[0].align).toBe("right");
    expect(s.columns[2].align).toBe("left");
  });

  it("trims trailing blank rows and trailing unused columns", () => {
    const s = buildEmbedSnapshot({ columns, rows });
    expect(s.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(s.columns.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a blank row in the middle, since rows anchor formulas", () => {
    const s = buildEmbedSnapshot({ columns, rows: [rows[0], { id: "gap", values: {} }, { id: "r5", values: { a: 1 } }] });
    expect(s.rows.map((r) => r.id)).toEqual(["r1", "gap", "r5"]);
  });

  it("never lists the reserved $fmt and $rh keys as columns", () => {
    const s = buildEmbedSnapshot({ columns: [...columns, { id: "$fmt", type: "short_text", label: "x" }], rows });
    expect(s.columns.some((c) => c.id.startsWith("$"))).toBe(false);
  });

  it("does not keep 1,000 seeded rows alive because a column formula reads 0 on them", () => {
    const cols = [
      { id: "item", type: "short_text", label: "Item" },
      { id: "price", type: "number", label: "Price" },
      { id: "dbl", type: "formula", label: "Double", formula: "=[Price]*2" },
    ];
    const many = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      values: i === 0 ? { item: "Widget", price: 21 } : i === 1 ? { item: "Bolt", price: 2 } : {},
    }));
    const s = buildEmbedSnapshot({ columns: cols, rows: many });
    expect(s.rows.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(s.rows[0].cells[2]).toBe("42");
  });

  it("keeps a row that holds only a cell formula", () => {
    const s = buildEmbedSnapshot({ columns, rows: [rows[0], { id: "f", values: { d: { "=": "\"x\"" } } }] });
    expect(s.rows.map((r) => r.id)).toEqual(["r1", "f"]);
  });

  it("right aligns a formula column that shows numbers, left when it shows text", () => {
    const num = buildEmbedSnapshot({
      columns: [{ id: "p", type: "number", label: "P" }, { id: "f", type: "formula", label: "F", formula: "=[P]*2" }],
      rows: [{ id: "a", values: { p: 1 } }, { id: "b", values: { p: 2 } }],
    });
    expect(num.columns[1].align).toBe("right");
    const txt = buildEmbedSnapshot({
      columns: [{ id: "p", type: "short_text", label: "P" }, { id: "f", type: "formula", label: "F", formula: "=[P]&\"!\"" }],
      rows: [{ id: "a", values: { p: "hi" } }],
    });
    expect(txt.columns[1].align).toBe("left");
  });

  it("an empty table yields no rows", () => {
    const s = buildEmbedSnapshot({ columns: [{ id: "a", type: "short_text", label: "" }], rows: [{ id: "r", values: {} }] });
    expect(s.rows).toEqual([]);
    expect(s.columns).toEqual([]);
  });
});

describe("embedCellText by type", () => {
  const row = (values: Record<string, unknown>) => ({ id: "r", values });
  it("formats currency and joins multi-select", () => {
    expect(embedCellText({ id: "x", type: "currency", format: { style: "currency", currency: "USD", decimals: 2, thousands: true } }, row({ x: 1240 }), null)).toBe("$1,240.00");
    expect(embedCellText({ id: "x", type: "multi_select" }, row({ x: ["a", "b"] }), null)).toBe("a, b");
  });
  it("renders a checkbox as a tick and a false one as empty", () => {
    expect(embedCellText({ id: "x", type: "checkbox" }, row({ x: true }), null)).toBe("✓");
    expect(embedCellText({ id: "x", type: "checkbox" }, row({ x: false }), null)).toBe("");
  });
  it("shows people by name and relational cells as a count", () => {
    expect(embedCellText({ id: "x", type: "person" }, row({ x: ["u1"] }), null, new Map([["u1", "Priya"]]))).toBe("Priya");
    expect(embedCellText({ id: "x", type: "link" }, row({ x: ["r1", "r2"] }), null)).toBe("2 linked");
  });
  it("blanks a stray object rather than printing it", () => {
    expect(embedCellText({ id: "x", type: "short_text" }, row({ x: { weird: 1 } }), null)).toBe("");
  });
});

describe("pageEmbedRows", () => {
  const rows = Array.from({ length: 450 }, (_, i) => i);
  it("defaults to 200 with a cursor to the next page", () => {
    const p = pageEmbedRows(rows, null, null);
    expect(p.page.length).toBe(200);
    expect(p.nextCursor).toBe("200");
    expect(p.start).toBe(0);
  });
  it("caps the limit at 1000 and ends with no cursor", () => {
    const p = pageEmbedRows(rows, "400", "5000");
    expect(p.page).toEqual(rows.slice(400));
    expect(p.nextCursor).toBeNull();
  });
});
