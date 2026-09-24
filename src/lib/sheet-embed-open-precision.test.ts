import { describe, expect, it } from "vitest";
import { buildEmbedSnapshot } from "./sheet-embed";

// The embed must read the same as the grid for a computed number in an OPEN
// (sheet-born, short_text) column: the engine's display text when the cell
// has no number format, the cell's own format when it does.
describe("buildEmbedSnapshot: open column formula precision matches the grid", () => {
  const columns = [
    { id: "a", type: "short_text", label: "" },
    { id: "b", type: "short_text", label: "" },
  ];

  it("shows the engine's 10 digit display, not the raw double", () => {
    const s = buildEmbedSnapshot({
      columns,
      rows: [
        { id: "r1", values: { a: 800, b: { "=": "A1/1200" } } },
        { id: "r2", values: { a: 0.1, b: { "=": "A2+0.2" } } },
      ],
    });
    expect(s.rows[0].cells[1]).toBe("0.6666666667");
    expect(s.rows[1].cells[1]).toBe("0.3");
  });

  it("still honours a cell's own number format on a computed result", () => {
    const s = buildEmbedSnapshot({
      columns,
      rows: [
        { id: "r1", values: { a: 800, b: { "=": "A1/1200" }, $fmt: { b: { nf: "percent", dp: 1 } } } },
        { id: "r2", values: { a: 1234.5, b: { "=": "A2*2" }, $fmt: { b: { nf: "currency", dp: 2 } } } },
      ],
    });
    expect(s.rows[0].cells[1]).toBe("66.7%");
    expect(s.rows[1].cells[1]).toBe("$2,469.00");
  });

  it("keeps a typed literal number as typed", () => {
    const s = buildEmbedSnapshot({ columns, rows: [{ id: "r1", values: { a: 0.6666666666666666 } }] });
    expect(s.rows[0].cells[0]).toBe("0.6666666666666666");
  });
});
