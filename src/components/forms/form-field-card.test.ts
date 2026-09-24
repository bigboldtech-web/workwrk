import { describe, expect, it } from "vitest";
import { OPTION_MAX_LENGTH, splitPastedOptions } from "./form-field-card";

// Pasting a list into a choice question's option row. The old builder's
// "Options (one per line)" textarea let a person paste many options at once;
// these pin that the one-row-per-option editor still does.
describe("splitPastedOptions", () => {
  it("leaves a single-line paste to the input's default behaviour", () => {
    expect(splitPastedOptions(["Option 1", "Option 2"], 0, "Low", 0, 8)).toBeNull();
  });

  it("turns a pasted list into one option per line, in place of the selected row", () => {
    const r = splitPastedOptions(["Option 1", "Option 2"], 0, "Low\nMedium\nHigh\nCritical", 0, 8);
    expect(r).toEqual({ next: ["Low", "Medium", "High", "Critical", "Option 2"], focus: 3 });
  });

  it("splices into the middle of the list and keeps the rows around it", () => {
    const r = splitPastedOptions(["A", "", "D"], 1, "B\nC", 0, 0);
    expect(r).toEqual({ next: ["A", "B", "C", "D"], focus: 2 });
  });

  it("handles Windows and old Mac line breaks, trims, and drops blank lines", () => {
    const r = splitPastedOptions([""], 0, "  Red \r\n\r\nGreen\rBlue\n\n", 0, 0);
    expect(r?.next).toEqual(["Red", "Green", "Blue"]);
  });

  it("splits a copied row range on tabs", () => {
    const r = splitPastedOptions([""], 0, "Q1\tQ2\tQ3", 0, 0);
    expect(r?.next).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("joins the text before the caret to the first line and after it to the last", () => {
    // "Size: |" with the caret after the space, then " (pick one)" after it.
    const r = splitPastedOptions(["Size: (pick one)"], 0, "Small\nLarge", 6, 6);
    expect(r?.next).toEqual(["Size: Small", "Large(pick one)"]);
  });

  it("replaces only the selected text", () => {
    const r = splitPastedOptions(["xxOLDyy"], 0, "a\nb", 2, 5);
    expect(r?.next).toEqual(["xxa", "byy"]);
  });

  it("clamps every option to the option length limit", () => {
    const long = "z".repeat(OPTION_MAX_LENGTH + 50);
    const r = splitPastedOptions([""], 0, `${long}\nok`, 0, 0);
    expect(r?.next[0]).toHaveLength(OPTION_MAX_LENGTH);
    expect(r?.next[1]).toBe("ok");
  });

  it("a paste of only line breaks changes nothing (and inserts no blank option)", () => {
    const r = splitPastedOptions(["A", "B"], 1, "\n\n", 1, 1);
    expect(r).toEqual({ next: ["A", "B"], focus: 1 });
  });

  it("tolerates a selection past the end of the value", () => {
    const r = splitPastedOptions(["ab"], 0, "c\nd", 99, 99);
    expect(r?.next).toEqual(["abc", "d"]);
  });
});
