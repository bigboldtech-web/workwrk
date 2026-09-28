import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableCard, type TableColumn } from "./table-card";

// Phase 6 walk: the Directory's Removed view puts a labelled "Restore" (about
// 81px) in the row-menu slot, which was always a 44px track. The sticky cell
// was narrower than its button, so every row read "Restor" at 1440 and the
// card scrolled sideways. `rowMenuWidth` sizes the track, the minimum width
// and the column-fit reserve to what the caller puts there.

type Row = { id: string };
const columns: TableColumn<Row>[] = [
  { key: "name", label: "Name", title: true, width: "minmax(200px,2fr)", render: () => "a" },
  { key: "when", label: "When", width: "136px", render: () => "b" },
];

function render(rowMenuWidth?: number) {
  return renderToStaticMarkup(
    createElement(TableCard<Row>, {
      columns,
      rows: [{ id: "a" }],
      rowKey: (r) => r.id,
      rowMenu: () => createElement("button", { type: "button" }, "Restore"),
      rowMenuWidth,
    }),
  );
}

describe("TableCard rowMenuWidth", () => {
  it("keeps the 44px end track for the plain row menu", () => {
    const html = render();
    expect(html).toContain("grid-template-columns:minmax(200px,2fr) 136px 44px");
    expect(html).toContain("min-width:380px");
  });

  it("sizes the end track and the minimum width to a labelled action", () => {
    const html = render(100);
    expect(html).toContain("grid-template-columns:minmax(200px,2fr) 136px 100px");
    expect(html).not.toContain(" 44px");
    expect(html).toContain("min-width:436px");
  });
});
