import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableCard, visibleTableColumns, type TableColumn } from "./table-card";

// Stage D review: at 1440 with the sidebar open, card-width hideBelow
// dropped KPI reviews' Note and Recorded columns and nothing brought them
// back. The column settings control is the way back.

type Row = { id: string };
const cols: TableColumn<Row>[] = [
  { key: "kpi", label: "KPI", title: true, width: "minmax(140px,1fr)", render: () => "" },
  { key: "target", label: "Target", width: "100px", render: () => "" },
  { key: "recorded", label: "Recorded", width: "140px", hideBelow: 1100, render: () => "" },
  { key: "note", label: "Note", width: "minmax(140px,1fr)", render: () => "" },
];
const keys = (c: TableColumn<Row>[]) => c.map((x) => x.key);

describe("visibleTableColumns", () => {
  it("drops a hideBelow column when the card is narrow", () => {
    expect(keys(visibleTableColumns(cols, 767, 44))).toEqual(["kpi", "target", "note"]);
  });
  it("brings a column back when the viewer chose to show it", () => {
    expect(keys(visibleTableColumns(cols, 767, 44, { shown: ["recorded"], hidden: [] }))).toEqual(["kpi", "target", "recorded", "note"]);
  });
  it("hides a column the viewer hid, but never the title column", () => {
    expect(keys(visibleTableColumns(cols, 1600, 44, { shown: [], hidden: ["note", "kpi"] }))).toEqual(["kpi", "target", "recorded"]);
  });
  it("shows everything unmeasured except what the viewer hid", () => {
    expect(keys(visibleTableColumns(cols, 0, 44))).toEqual(["kpi", "target", "recorded", "note"]);
  });
});

describe("the column settings control", () => {
  const render = (columnSettings?: boolean) => renderToStaticMarkup(
    createElement(TableCard<Row>, { columns: cols, rows: [{ id: "a" }], rowKey: (r) => r.id, columnSettings }),
  );
  it("renders only when asked for", () => {
    expect(render(true)).toContain('aria-label="Column settings"');
    expect(render()).not.toContain('aria-label="Column settings"');
  });
});
