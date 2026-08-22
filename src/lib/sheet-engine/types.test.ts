import { describe, expect, it } from "vitest";

import {
  CELL_ERRORS,
  MAX_COLUMN_INDEX,
  cellError,
  columnLabel,
  formulaCell,
  isCellErrorCode,
  isErrorValue,
  isFormulaCell,
  parseColumnLabel,
} from "./types";

describe("cell errors", () => {
  it("returns a frozen singleton per code", () => {
    const a = cellError("#DIV/0!");
    const b = cellError("#DIV/0!");
    expect(a).toBe(b);
    expect(a).toEqual({ err: "#DIV/0!" });
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("covers every code the engine can raise", () => {
    for (const code of CELL_ERRORS) {
      expect(cellError(code).err).toBe(code);
      expect(isCellErrorCode(code)).toBe(true);
    }
    expect(CELL_ERRORS).toContain("#CYCLE!");
    expect(CELL_ERRORS).toContain("#N/A");
  });

  it("rejects lookalikes", () => {
    expect(isCellErrorCode("#NOPE")).toBe(false);
    expect(isCellErrorCode("#div/0!")).toBe(false);
    expect(isCellErrorCode("")).toBe(false);
  });

  it("recognises error values without confusing them with literals", () => {
    expect(isErrorValue({ err: "#REF!" })).toBe(true);
    expect(isErrorValue(cellError("#N/A"))).toBe(true);
    expect(isErrorValue({ err: "#NOT_A_CODE" })).toBe(false);
    expect(isErrorValue({ err: 3 })).toBe(false);
    expect(isErrorValue("#REF!")).toBe(false);
    expect(isErrorValue(null)).toBe(false);
    expect(isErrorValue(undefined)).toBe(false);
    expect(isErrorValue(0)).toBe(false);
    expect(isErrorValue([])).toBe(false);
  });
});

describe("formula cell shape", () => {
  it("detects the stored formula envelope", () => {
    expect(isFormulaCell({ "=": "A1+B2" })).toBe(true);
    expect(isFormulaCell(formulaCell("A1+B2"))).toBe(true);
    expect(formulaCell("A1+B2")).toEqual({ "=": "A1+B2" });
  });

  it("tolerates extra keys so a cached value can be added later", () => {
    expect(isFormulaCell({ "=": "A1", v: 3 })).toBe(true);
  });

  it("treats everything else as a literal", () => {
    expect(isFormulaCell({ "=": 1 })).toBe(false);
    expect(isFormulaCell({ value: "A1" })).toBe(false);
    expect(isFormulaCell(null)).toBe(false);
    expect(isFormulaCell(undefined)).toBe(false);
    expect(isFormulaCell("=A1")).toBe(false);
    expect(isFormulaCell(42)).toBe(false);
    expect(isFormulaCell([["="], ["A1"]])).toBe(false);
  });

  it("accepts an empty formula string as the envelope shape", () => {
    // Emptiness is the parser's problem, not the shape check's.
    expect(isFormulaCell({ "=": "" })).toBe(true);
  });
});

describe("column labels", () => {
  it("maps the boundaries of each label width", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(51)).toBe("AZ");
    expect(columnLabel(52)).toBe("BA");
    expect(columnLabel(701)).toBe("ZZ");
    expect(columnLabel(702)).toBe("AAA");
    expect(columnLabel(MAX_COLUMN_INDEX)).toBe("ZZZ");
  });

  it("throws on an index the engine should never produce", () => {
    expect(() => columnLabel(-1)).toThrow(RangeError);
    expect(() => columnLabel(1.5)).toThrow(RangeError);
    expect(() => columnLabel(MAX_COLUMN_INDEX + 1)).toThrow(RangeError);
    expect(() => columnLabel(Number.NaN)).toThrow(RangeError);
  });

  it("round-trips every supported column", () => {
    for (let i = 0; i <= MAX_COLUMN_INDEX; i++) {
      expect(parseColumnLabel(columnLabel(i))).toBe(i);
    }
  });

  it("is case insensitive", () => {
    expect(parseColumnLabel("a")).toBe(0);
    expect(parseColumnLabel("zz")).toBe(701);
    expect(parseColumnLabel("aA")).toBe(26);
  });

  it("returns null instead of guessing", () => {
    expect(parseColumnLabel("")).toBeNull();
    expect(parseColumnLabel("ZZZZ")).toBeNull();
    expect(parseColumnLabel("A1")).toBeNull();
    expect(parseColumnLabel("$A")).toBeNull();
    expect(parseColumnLabel(" A")).toBeNull();
    expect(parseColumnLabel("A-")).toBeNull();
  });
});
