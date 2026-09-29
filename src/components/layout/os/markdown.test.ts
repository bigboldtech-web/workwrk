import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OsMarkdown, isTableStart, tableCells } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(OsMarkdown, { text }));

describe("OsMarkdown", () => {
  it("renders a table with a header, body rows and no raw pipes", () => {
    const out = html("Due this week:\n| Priority | Task | Due |\n|---|:---:|---:|\n| HIGH | Ship the page | Sep 16 |\n| NORMAL | Review | Sep 18 |");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain(">Priority<");
    expect(out).toContain(">Ship the page<");
    expect(out).not.toContain("|---");
    expect(out).not.toContain("| HIGH");
    expect(out).toContain("text-align:center");
  });

  it("renders --- as a rule, not text", () => {
    const out = html("First\n\n---\n\nSecond");
    expect(out).toContain("<hr");
    expect(out).not.toContain("---");
  });

  it("does not take a lone --- under a line as a table", () => {
    expect(isTableStart(["Tasks", "---"], 0)).toBe(false);
    expect(isTableStart(["a | b", "--- | ---"], 0)).toBe(true);
  });

  it("splits cells with and without the outer pipes", () => {
    expect(tableCells("| a | b |")).toEqual(["a", "b"]);
    expect(tableCells("a | b")).toEqual(["a", "b"]);
    expect(tableCells("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("renders deeper headings, lists and emphasis", () => {
    const out = html("#### Heads up\n- **3 tasks** are overdue\n1. First");
    expect(out).toContain("<h4");
    expect(out).toContain("<ul");
    expect(out).toContain("<strong");
    expect(out).toContain("<ol");
  });

  it("never renders a javascript: link", () => {
    const out = html("[click](javascript:alert(1)) and [ok](https://example.com) and [task](/item/abc)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("href=\"https://example.com\"");
    expect(out).toContain("href=\"/item/abc\"");
  });
});
