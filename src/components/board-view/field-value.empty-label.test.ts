import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FieldDef, FieldType } from "@/lib/field-catalog";
import { FieldValue } from "./field-value";

// A List's Default values panel draws every field it can hold a default for
// through FieldValue in edit mode. Its empty rows showed the table cell's
// em dash while its Status and Priority rows read "No default", and an em dash
// is never visible copy. The panel passes emptyLabel now; a cell that passes
// nothing keeps the glyph it always had.

const DASH = "—";

function field(type: FieldType, options?: FieldDef["options"]): FieldDef {
  return { key: "f", label: "F", type, position: 0, options };
}

function html(def: FieldDef, emptyLabel?: string, mode: "edit" | "display" = "edit"): string {
  return renderToStaticMarkup(
    createElement(FieldValue, { field: def, value: null, mode, onChange: () => {}, boardId: "b1", emptyLabel }),
  );
}

const EDITORS: Array<[string, FieldDef]> = [
  ["text", field("TEXT")],
  ["url", field("URL")],
  ["long text", field("LONG_TEXT")],
  ["number", field("NUMBER")],
  ["money", field("MONEY")],
  ["dropdown", field("DROPDOWN", { choices: [{ value: "a", label: "A" }] })],
  ["t-shirt size", field("TSHIRT_SIZE", { choices: [{ value: "s", label: "S" }] })],
  ["people", field("PEOPLE")],
  ["location", field("LOCATION")],
];

describe("FieldValue emptyLabel", () => {
  for (const [name, def] of EDITORS) {
    it(`an empty ${name} editor reads the label it is given, with no em dash`, () => {
      const out = html(def, "No default");
      expect(out).toContain("No default");
      expect(out).not.toContain(DASH);
    });
  }

  it("an empty read-only value reads the label too", () => {
    for (const def of [field("TEXT"), field("NUMBER"), field("DATE"), field("USER"), field("MULTI_SELECT"), field("LOCATION")]) {
      const out = html(def, "No default", "display");
      expect(out).toContain("No default");
      expect(out).not.toContain(DASH);
    }
  });

  // Progress was the one editor the label never reached: the panel's empty
  // Progress row read the bar's em dash, and its slider said 0%, a value an
  // unset default does not have.
  it("an empty progress value reads the label it is given, editor and read-only alike", () => {
    for (const mode of ["edit", "display"] as const) {
      const out = html(field("PROGRESS_MANUAL"), "No default", mode);
      expect(out).toContain("No default");
      expect(out).not.toContain(DASH);
      // The readout, not the bar's own width:0% style.
      expect(out).not.toMatch(/>0%</);
    }
  });

  it("a progress cell that passes no label keeps its em dash and its 0%", () => {
    expect(html(field("PROGRESS_MANUAL"), undefined, "display")).toContain(DASH);
    expect(html(field("PROGRESS_MANUAL"))).toMatch(/>0%</);
    // A set value reads as its percent whatever the label.
    const set = renderToStaticMarkup(createElement(FieldValue, { field: field("PROGRESS_MANUAL"), value: 40, mode: "edit", onChange: () => {}, boardId: "b1", emptyLabel: "No default" }));
    expect(set).toContain("40%");
    expect(set).not.toContain("No default");
  });

  it("a table cell that passes no label keeps the em dash it always had", () => {
    for (const def of [field("TEXT"), field("NUMBER"), field("DROPDOWN"), field("PEOPLE")]) {
      expect(html(def)).toContain(DASH);
    }
    expect(html(field("DATE"), undefined, "display")).toContain(DASH);
    // Location's editor keeps its own prompt when nothing is passed.
    expect(html(field("LOCATION"))).toContain("Add a location");
  });
});
