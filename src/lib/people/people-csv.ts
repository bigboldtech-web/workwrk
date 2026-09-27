// Import people: the CSV half, pure, so the modal's staging grid and the
// tests agree on what a file means. Headers are matched loosely ("First
// name", "first_name", "firstName" all map to firstName). An access level
// column is IGNORED with a note: a file never sets anyone's access.
//
// Pure: no imports. Client safe.

export type ImportField = "firstName" | "lastName" | "email" | "jobTitle" | "department" | "office" | "reportsTo" | "phone";

export interface ImportRow {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  department: string;
  office: string;
  reportsTo: string;
  phone: string;
}

const ALIASES: Record<ImportField, string[]> = {
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  email: ["email", "emailaddress", "workemail", "mail"],
  jobTitle: ["jobtitle", "title", "role", "position", "designation"],
  department: ["department", "dept", "function", "team"],
  office: ["office", "location", "site", "city"],
  reportsTo: ["reportsto", "manager", "manageremail", "reportingmanager", "reportsto(email)"],
  phone: ["phone", "mobile", "phonenumber", "cell"],
};

const IGNORED = new Set(["accesslevel", "access", "level", "orgrole", "password"]);

function norm(h: string): string {
  return h.toLowerCase().replace(/[\s_\-.]/g, "");
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Map each column to a field by its header. */
export function mapHeaders(headers: readonly string[]): { mapping: Array<ImportField | null>; ignored: string[] } {
  const used = new Set<ImportField>();
  const ignored: string[] = [];
  const mapping = headers.map((h) => {
    const n = norm(h);
    if (IGNORED.has(n)) { ignored.push(h.trim()); return null; }
    for (const f of Object.keys(ALIASES) as ImportField[]) {
      if (used.has(f)) continue;
      if (n === norm(f) || ALIASES[f].includes(n)) { used.add(f); return f; }
    }
    return null;
  });
  return { mapping, ignored };
}

/** The labels the Map columns step shows, in the template's order. */
export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  jobTitle: "Job title",
  department: "Department",
  office: "Office",
  reportsTo: "Reports to (email)",
  phone: "Phone",
};
export const IMPORT_FIELDS = Object.keys(IMPORT_FIELD_LABEL) as ImportField[];
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["firstName", "lastName", "email"];

/** Is this header one a file may never use (access, passwords)? */
export function isIgnoredHeader(h: string): boolean {
  return IGNORED.has(norm(h));
}

/**
 * Rows from a parsed table and a column mapping the person confirmed in the
 * Map columns step. A field mapped by two columns keeps the FIRST; an
 * ignored header can never be mapped, whatever the mapping says.
 */
export function rowsFromTable(
  table: readonly (readonly string[])[],
  mapping: ReadonlyArray<ImportField | null>,
): { rows: ImportRow[]; missing: ImportField[] } {
  const headers = table[0] ?? [];
  const seen = new Set<ImportField>();
  const clean = mapping.map((f, i) => {
    if (!f || seen.has(f) || isIgnoredHeader(headers[i] ?? "")) return null;
    seen.add(f);
    return f;
  });
  const missing = REQUIRED_IMPORT_FIELDS.filter((f) => !seen.has(f));
  const rows = table.slice(1).map((cells) => {
    const r: ImportRow = { firstName: "", lastName: "", email: "", jobTitle: "", department: "", office: "", reportsTo: "", phone: "" };
    clean.forEach((f, i) => { if (f) r[f] = (cells[i] ?? "").trim(); });
    return r;
  });
  return { rows, missing };
}

export function rowsFromCsv(text: string): { rows: ImportRow[]; ignoredColumns: string[]; missing: ImportField[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], ignoredColumns: [], missing: ["firstName", "lastName", "email"] };
  const { mapping, ignored } = mapHeaders(table[0]);
  const missing = (["firstName", "lastName", "email"] as ImportField[]).filter((f) => !mapping.includes(f));
  const rows = table.slice(1).map((cells) => {
    const r: ImportRow = { firstName: "", lastName: "", email: "", jobTitle: "", department: "", office: "", reportsTo: "", phone: "" };
    mapping.forEach((f, i) => { if (f) r[f] = (cells[i] ?? "").trim(); });
    return r;
  });
  return { rows, ignoredColumns: ignored, missing };
}

export const IMPORT_TEMPLATE_CSV = [
  "First name,Last name,Email,Job title,Department,Office,Reports to,Phone",
  "Priya,Menon,priya@example.com,Designer,Design,Bengaluru,anita@example.com,+91 90000 00000",
].join("\n");

/** One CSV cell, quoted when it needs to be (for every Export CSV in this unit). */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}
