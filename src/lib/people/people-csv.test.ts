import { describe, expect, it } from "vitest";
import { csvCell, isIgnoredHeader, mapHeaders, parseCsv, rowsFromCsv, rowsFromTable } from "./people-csv";

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

describe("rowsFromTable (the Map columns step)", () => {
  const table = [["Given", "Family", "Mail", "Access level", "Boss"], ["Priya", "Menon", "p@x.com", "COMPANY_ADMIN", "a@x.com"]];
  it("uses the confirmed mapping", () => {
    const { rows, missing } = rowsFromTable(table, ["firstName", "lastName", "email", null, "reportsTo"]);
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ firstName: "Priya", lastName: "Menon", email: "p@x.com", reportsTo: "a@x.com" });
  });
  it("never maps an access level column, whatever the mapping says", () => {
    const { rows } = rowsFromTable(table, ["firstName", "lastName", "email", "jobTitle", null]);
    expect(rows[0].jobTitle).toBe("");
  });
  it("keeps the first of two columns mapped to one field and reports missing ones", () => {
    const { rows, missing } = rowsFromTable([["A", "B"], ["x", "y"]], ["firstName", "firstName"]);
    expect(rows[0].firstName).toBe("x");
    expect(missing).toEqual(["lastName", "email"]);
  });
  it("knows the ignored headers", () => {
    expect(isIgnoredHeader("Access Level")).toBe(true);
    expect(isIgnoredHeader("Department")).toBe(false);
  });
});
