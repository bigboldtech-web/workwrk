import { describe, expect, it } from "vitest";
import { csvCell, mapHeaders, parseCsv, rowsFromCsv } from "./people-csv";

describe("people csv", () => {
  it("parses quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("maps loose headers and ignores an access level column", () => {
    const { mapping, ignored } = mapHeaders(["First name", "last_name", "E-mail", "Access level", "Manager"]);
    expect(mapping).toEqual(["firstName", "lastName", "email", null, "reportsTo"]);
    expect(ignored).toEqual(["Access level"]);
  });
  it("reports the required columns that are missing", () => {
    expect(rowsFromCsv("Name,Email\nA,a@x.com").missing).toEqual(["firstName", "lastName"]);
  });
  it("defuses a formula in an exported cell", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("a,b")).toBe('"a,b"');
  });
});
