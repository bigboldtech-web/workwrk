import { describe, expect, it } from "vitest";
import { filterLedgerRows, ledgerStats, matchesLedgerRow, paginate, parseLedgerSort, parseLedgerView, sortLedgerRows } from "./policy-ledger-view";

const rows = [
  { name: "Anita Rao", email: "anita@acme.com", department: "Engineering", status: "acked" as const, versionAcked: 2, acknowledgedAt: "2026-09-02T10:00:00Z", dueDate: null },
  { name: "Ben Ito", email: "ben@acme.com", department: "Sales", status: "pending" as const, versionAcked: null, acknowledgedAt: null, dueDate: "2026-10-01T00:00:00Z" },
  { name: "Cara Lee", email: null, department: "Sales", status: "overdue" as const, versionAcked: null, acknowledgedAt: null, dueDate: "2026-09-01T00:00:00Z" },
  { name: "Dev Shah", email: "dev@acme.com", department: "Engineering", status: "out-of-date" as const, versionAcked: 1, acknowledgedAt: "2026-08-01T10:00:00Z", dueDate: null },
];

describe("views", () => {
  it("parses with a fallback", () => {
    expect(parseLedgerView("reack")).toBe("reack");
    expect(parseLedgerView("nope")).toBe("all");
    expect(parseLedgerSort("due")).toBe("due");
    expect(parseLedgerSort("x")).toBeNull();
  });
  it("filters by view", () => {
    expect(filterLedgerRows(rows, { view: "acked" }).map((r) => r.name)).toEqual(["Anita Rao"]);
    expect(filterLedgerRows(rows, { view: "pending" }).map((r) => r.name)).toEqual(["Ben Ito"]);
    expect(filterLedgerRows(rows, { view: "overdue" }).map((r) => r.name)).toEqual(["Cara Lee"]);
    expect(filterLedgerRows(rows, { view: "reack" }).map((r) => r.name)).toEqual(["Dev Shah"]);
    expect(filterLedgerRows(rows, { view: "all" })).toHaveLength(4);
  });
});

describe("search, department, version", () => {
  it("matches name, email and department, case-insensitively", () => {
    expect(matchesLedgerRow(rows[0], { q: "ANITA" })).toBe(true);
    expect(matchesLedgerRow(rows[0], { q: "anita@acme" })).toBe(true);
    expect(matchesLedgerRow(rows[1], { q: "sales" })).toBe(true);
    expect(matchesLedgerRow(rows[1], { q: "anita" })).toBe(false);
  });
  it("narrows by department name and acknowledged version", () => {
    expect(filterLedgerRows(rows, { department: "Sales" })).toHaveLength(2);
    expect(filterLedgerRows(rows, { version: 1 }).map((r) => r.name)).toEqual(["Dev Shah"]);
  });
});

describe("sort", () => {
  it("sorts by name, acknowledged at (unset last) and due (unset last)", () => {
    expect(sortLedgerRows(rows, "name", "desc")[0].name).toBe("Dev Shah");
    expect(sortLedgerRows(rows, "acknowledgedAt").map((r) => r.name)).toEqual(["Dev Shah", "Anita Rao", "Ben Ito", "Cara Lee"]);
    expect(sortLedgerRows(rows, "due").map((r) => r.name)).toEqual(["Cara Lee", "Ben Ito", "Anita Rao", "Dev Shah"]);
    expect(sortLedgerRows(rows, null)).toBe(rows);
  });
});

describe("paginate", () => {
  it("clamps the page and reports the range", () => {
    const p = paginate(rows, 2, 3);
    expect(p).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2, from: 4, to: 4 });
    expect(p.items.map((r) => r.name)).toEqual(["Dev Shah"]);
    expect(paginate(rows, 9, 3).page).toBe(2);
    expect(paginate([], 1).from).toBe(0);
  });
});

describe("ledgerStats", () => {
  it("shows the danger dot only when something is overdue", () => {
    const cards = ledgerStats({ total: 42, acked: 38, overdue: 0, outOfDate: 1, pending: 3, rate: 90 });
    expect(cards[0]).toMatchObject({ label: "Acknowledged", value: "38 of 42", sub: "90%" });
    expect(cards[2].dot).toBeUndefined();
    expect(ledgerStats({ total: 1, acked: 0, overdue: 1, outOfDate: 0, pending: 0, rate: 0 })[2].dot).toBe("danger");
  });
});
