import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableCard, type TableColumn } from "./table-card";

// With the Filter panel open at 1440 the /tables card was narrower than its
// columns, and the row "..." sat behind a sideways scroll overlay scrollbars
// never show. The "..." column is pinned to the card's end edge now, with an
// opaque fill (the card surface under the row's state tint) so cells that
// scroll beneath it do not show through.

type Row = { id: string; name: string };
const columns: TableColumn<Row>[] = [
  { key: "name", label: "Name", title: true, width: "minmax(200px,2fr)", render: (r) => r.name },
  { key: "where", label: "Location", width: "minmax(120px,200px)", render: () => "No Space" },
];
const rows: Row[] = [{ id: "a", name: "Pipeline" }, { id: "b", name: "Vendors" }];

function render(selected: string[] = [], highlightKey: string | null = null) {
  return renderToStaticMarkup(
    createElement(TableCard<Row>, {
      columns,
      rows,
      rowKey: (r) => r.id,
      onRowClick: () => {},
      selectable: true,
      selected: new Set(selected),
      onSelectedChange: () => {},
      highlightKey,
      rowMenu: () => createElement("button", { type: "button" }, "more"),
    }),
  );
}

function rowHtml(html: string, key: string): string {
  const start = html.indexOf(`data-key="${key}"`);
  const open = html.lastIndexOf("<div", start);
  const next = html.indexOf('role="row"', start + 1);
  return html.slice(open, next === -1 ? undefined : next);
}

describe("TableCard sticky row menu", () => {
  it("pins every row's menu cell and the header's to the end edge", () => {
    const html = render();
    const menuCells = html.match(/class="[^"]*os-tc__more [^"]*"/g) ?? [];
    expect(menuCells).toHaveLength(rows.length);
    for (const c of menuCells) {
      expect(c).toContain("sticky");
      expect(c).toContain("end-0");
      expect(c).toContain("bg-raised");
    }
    expect(html).toMatch(/class="[^"]*sticky end-0 bg-\[var\(--os-table-head-bg\)\][^"]*" aria-hidden/);
  });

  it("paints the row state tint over the surface so the fill is opaque", () => {
    const html = render();
    expect(html).toContain("background-image:linear-gradient(var(--tc-tint, transparent), var(--tc-tint, transparent))");
  });

  it("gives a selected row the selected tint and a plain row only the hover tint", () => {
    const html = render(["b"]);
    const plain = rowHtml(html, "a");
    const sel = rowHtml(html, "b");
    expect(plain).toContain("hover:[--tc-tint:var(--os-surface-hov)]");
    expect(plain).not.toContain("[--tc-tint:var(--os-selected)]");
    expect(sel).toContain("[--tc-tint:var(--os-selected)]");
    expect(sel).toContain("hover:[--tc-tint:var(--os-selected-hov)]");
    expect(sel).not.toContain("hover:[--tc-tint:var(--os-surface-hov)]");
  });

  it("gives a highlighted row the selected tint at rest", () => {
    const hi = rowHtml(render([], "a"), "a");
    expect(hi).toContain("[--tc-tint:var(--os-selected)]");
    expect(hi).toContain("hover:[--tc-tint:var(--os-surface-hov)]");
  });
});
