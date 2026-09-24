import { describe, expect, it } from "vitest";
import { csvExportCell, csvFormulaSafe, parseCsv, toCsvMatrix } from "./csv";
import { defaultPlan, guessColumnType, planSummary, planToBody, readCsv, tableNameFromFile, targetColumnName } from "./csv-import";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, a BOM and trailing blank lines", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("keeps a newline inside quotes", () => {
    expect(parseCsv('x\n"line 1\nline 2"')).toEqual([["x"], ["line 1\nline 2"]]);
  });
  it("keeps a quote in the middle of an unquoted field as a literal, as Sheets does", () => {
    const text = 'Part,Size,Qty\nPipe,12" long,4\nValve,3/4 in,10\nHose,50 ft,2\nClamp,1" wide,8\n';
    expect(parseCsv(text)).toEqual([
      ["Part", "Size", "Qty"],
      ["Pipe", '12" long', "4"],
      ["Valve", "3/4 in", "10"],
      ["Hose", "50 ft", "2"],
      ["Clamp", '1" wide', "8"],
    ]);
    expect(readCsv(text, true).rows).toHaveLength(4);
  });
  it("keeps the quotes in an unquoted formula", () => {
    expect(parseCsv('=UPPER("a"),x')).toEqual([['=UPPER("a")', "x"]]);
    // A comma outside a field-opening quote is a separator in every CSV
    // reader (Python's csv module gives exactly this), so an unquoted
    // formula with two arguments splits; an exported one arrives quoted.
    expect(parseCsv('=HYPERLINK("a","b"),x')).toEqual([['=HYPERLINK("a"', "b)", "x"]]);
    expect(parseCsv('"=HYPERLINK(""a"",""b"")",x')).toEqual([['=HYPERLINK("a","b")', "x"]]);
  });
  it("still reads a quoted field with \"\" escapes, commas and newlines", () => {
    expect(parseCsv('id,note\n1,"He said ""hi, there""\nthen left",done\n2,"",x')).toEqual([
      ["id", "note"],
      ["1", 'He said "hi, there"\nthen left', "done"],
      ["2", "", "x"],
    ]);
  });
  it("round-trips with toCsvMatrix", () => {
    const m = [["Name", "Note"], ["A, Inc", 'He said "go"']];
    expect(parseCsv(toCsvMatrix(m))).toEqual(m);
  });
});

describe("readCsv", () => {
  it("uses the first row as names, or numbers the columns", () => {
    expect(readCsv("Name,Qty\nx,1", true)).toEqual({ headers: ["Name", "Qty"], rows: [["x", "1"]], width: 2, hasHeader: true });
    expect(readCsv("x,1\ny", false).headers).toEqual(["Column 1", "Column 2"]);
    expect(readCsv(" ,Qty\nx,1", true).headers).toEqual(["Column 1", "Qty"]);
  });
});

describe("guessColumnType", () => {
  it("guesses what every sample fits, else Text", () => {
    expect(guessColumnType(["1", "2,500", "-3.5"])).toBe("number");
    expect(guessColumnType(["$1,200", "$3"])).toBe("currency");
    expect(guessColumnType(["12%", "3.5 %"])).toBe("percent");
    expect(guessColumnType(["2026-09-01", "1/2/2026"])).toBe("date");
    expect(guessColumnType(["yes", "No"])).toBe("checkbox");
    expect(guessColumnType(["a@b.co"])).toBe("email");
    expect(guessColumnType(["https://x.io"])).toBe("url");
    expect(guessColumnType(["1", "two"])).toBe("short_text");
    expect(guessColumnType(["", " "])).toBe("short_text");
  });
});

describe("defaultPlan", () => {
  const parsed = readCsv("Name,Qty,Note\nx,1,a", true);
  it("a new table gets one new column per CSV column", () => {
    expect(defaultPlan(parsed, null)).toEqual([
      { kind: "new", label: "Name", type: "short_text" },
      { kind: "new", label: "Qty", type: "number" },
      { kind: "new", label: "Note", type: "short_text" },
    ]);
  });
  it("appending matches names first, then a sheet's unnamed column at the same position", () => {
    const target = [{ id: "A", label: "" }, { id: "B", label: "qty" }, { id: "C", label: "" }];
    expect(defaultPlan(parsed, target)).toEqual([
      { kind: "existing", target: "A" },
      { kind: "existing", target: "B" },
      { kind: "existing", target: "C" },
    ]);
  });
  it("never uses one existing column twice, and falls back to a new column", () => {
    const target = [{ id: "A", label: "Name" }];
    const plan = defaultPlan(readCsv("Name,Name\n1,2", true), target);
    expect(plan[0]).toEqual({ kind: "existing", target: "A" });
    expect(plan[1].kind).toBe("new");
  });
  it("a headerless append goes by position into named columns, and only overflow is new", () => {
    const target = [{ id: "A", label: "Name" }, { id: "B", label: "Amount" }, { id: "C", label: "" }];
    const plan = defaultPlan(readCsv("x,1,a,z\ny,2,b,w", false), target);
    expect(plan).toEqual([
      { kind: "existing", target: "A" },
      { kind: "existing", target: "B" },
      { kind: "existing", target: "C" },
      { kind: "new", label: "Column 4", type: "short_text" },
    ]);
  });
  it("a headerless append never matches a column by its made-up Column N name", () => {
    const target = [{ id: "A", label: "Name" }, { id: "B", label: "Column 1" }];
    expect(defaultPlan(readCsv("x,1", false), target)).toEqual([
      { kind: "existing", target: "A" },
      { kind: "existing", target: "B" },
    ]);
  });
  it("serialises to the import route's body and summarises", () => {
    const plan = [{ kind: "existing", target: "A" } as const, { kind: "new", label: "Q", type: "number" } as const, { kind: "skip" } as const];
    expect(planToBody(plan)).toEqual([{ target: "A" }, { label: "Q", type: "number" }, { skip: true }]);
    expect(planSummary(parsed, plan)).toEqual({ rows: 1, newColumns: 1, skipped: 1 });
  });
  it("names things", () => {
    expect(tableNameFromFile("Q3 leads.csv")).toBe("Q3 leads");
    expect(tableNameFromFile(".csv")).toBe("Imported table");
    expect(targetColumnName([{ id: "A", label: "" }, { id: "B", label: "Qty" }], "A")).toBe("A");
    expect(targetColumnName([{ id: "A", label: "" }, { id: "B", label: "Qty" }], "B")).toBe("Qty");
  });
});


describe("csvFormulaSafe (form response export)", () => {
  it("neutralises text a spreadsheet would run as a formula", () => {
    expect(csvFormulaSafe("=cmd")).toBe("'=cmd");
    expect(csvFormulaSafe("=1+1")).toBe("'=1+1");
    expect(csvFormulaSafe("+44 20")).toBe("'+44 20");
    expect(csvFormulaSafe("-2")).toBe("'-2");
    expect(csvFormulaSafe("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvFormulaSafe("\tx")).toBe("'\tx");
  });
  it("leaves ordinary text alone", () => {
    expect(csvFormulaSafe("Ada Lovelace")).toBe("Ada Lovelace");
    expect(csvFormulaSafe("")).toBe("");
    expect(csvFormulaSafe("a=b")).toBe("a=b");
  });
});

describe("csvExportCell (both table exports)", () => {
  // The regression: a number COLUMN can hold text, and both exports used to
  // let it out raw because they decided by column type or value type.
  it("escapes formula text even when it sits in a number column", () => {
    expect(csvExportCell("=HYPERLINK(\"http://x\",\"click\")")).toBe("'=HYPERLINK(\"http://x\",\"click\")");
    expect(csvExportCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(csvExportCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvExportCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("escapes arithmetic that only LOOKS numeric, because Excel evaluates it", () => {
    expect(csvExportCell("-2+3")).toBe("'-2+3");
    expect(csvExportCell("+44 20 7946 0958")).toBe("'+44 20 7946 0958");
  });

  it("leaves real numbers as numbers, so a negative still opens as a value", () => {
    for (const n of ["42", "-42", "1,234.50", "-1,234.50", "12%", "-12.5%", "$1,234.00", "-$42.00", "($42.00)", "1.5e10", "-1.5E-3", "€5", "12 €"]) {
      expect(csvExportCell(n)).toBe(n);
    }
  });

  it("leaves ordinary text untouched", () => {
    expect(csvExportCell("Apple")).toBe("Apple");
    expect(csvExportCell("")).toBe("");
    expect(csvExportCell("12 inches")).toBe("12 inches");
  });
});
