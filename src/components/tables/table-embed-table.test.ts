import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableEmbedTable, type EmbedTablePage } from "./table-embed-table";

// The public embed of a table made public before anything was typed arrives
// with no columns and no rows. It must show the empty state alone, not a
// cell-less header row that paints as a blank band above it.

function render(page: EmbedTablePage) {
  return renderToStaticMarkup(createElement(TableEmbedTable, { page }));
}

describe("TableEmbedTable", () => {
  it("renders no header when there are no columns", () => {
    const html = render({ columns: [], rows: [], start: 0, total: 0 });
    expect(html).not.toContain("<thead");
    expect(html).toContain("No rows yet");
    // The empty-state cell still spans at least one column, so it lays out.
    expect(html).toMatch(/colspan="1"/i);
  });

  it("keeps the header when columns exist, even with no rows", () => {
    const html = render({
      columns: [{ id: "a", name: "Name", type: "short_text", align: "left" }],
      rows: [],
      start: 0,
      total: 0,
    });
    expect(html).toContain("<thead");
    expect(html).toContain(">Name</th>");
    expect(html).toContain("No rows yet");
  });
});
