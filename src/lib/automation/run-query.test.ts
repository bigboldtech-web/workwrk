import { describe, expect, it } from "vitest";
import { parseRunQuery, parseRunStatuses, recordHref, runOrderBy, runWhere, viewForStatuses } from "./run-query";

const q = (s: string) => new URLSearchParams(s);
const NOW = new Date("2026-09-26T12:00:00Z");

describe("parseRunStatuses", () => {
  it("accepts view words and stored statuses alike", () => {
    expect(parseRunStatuses("failed").statuses).toEqual(["FAILED"]);
    expect(parseRunStatuses("FAILED,PARTIAL").statuses).toEqual(["FAILED", "PARTIAL"]);
    expect(parseRunStatuses("partial,partial").statuses).toEqual(["PARTIAL"]);
    expect(parseRunStatuses("all").statuses).toEqual([]);
    expect(parseRunStatuses("boom").invalid).toBe("boom");
  });

  it("lights the matching view pill, All for none or several", () => {
    expect(viewForStatuses(["SKIPPED"])).toBe("skipped");
    expect(viewForStatuses([])).toBe("all");
    expect(viewForStatuses(["FAILED", "PARTIAL"])).toBe("all");
  });
});

describe("parseRunQuery", () => {
  it("turns ?days= into a from date, and an exact range supersedes it", () => {
    const a = parseRunQuery(q("days=7"), NOW);
    expect(a.ok && a.query.from?.toISOString()).toBe("2026-09-19T12:00:00.000Z");
    const b = parseRunQuery(q("days=7&from=2026-09-01&to=2026-09-02"), NOW);
    expect(b.ok && b.query.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(b.ok && b.query.to?.toISOString()).toBe("2026-09-02T23:59:59.999Z");
  });

  it("ignores a window that is not 7, 30 or 90 days", () => {
    const a = parseRunQuery(q("days=5"), NOW);
    expect(a.ok && a.query.from).toBeNull();
  });

  it("refuses bad values with a 400-shaped error", () => {
    expect(parseRunQuery(q("severity=HUGE"), NOW).ok).toBe(false);
    expect(parseRunQuery(q("record=lead"), NOW).ok).toBe(false);
    expect(parseRunQuery(q("from=nope"), NOW).ok).toBe(false);
    expect(parseRunQuery(q("from=2026-09-05&to=2026-09-01"), NOW).ok).toBe(false);
  });

  it("caps the page size at 100 and defaults to 50, newest first", () => {
    const a = parseRunQuery(q("take=500"), NOW);
    expect(a.ok && a.query.take).toBe(100);
    const b = parseRunQuery(q(""), NOW);
    expect(b.ok && b.query.take).toBe(50);
    expect(b.ok && b.query.sort).toBe("newest");
  });
});

describe("runWhere and runOrderBy", () => {
  it("always stays inside the workspace and carries every filter", () => {
    const r = parseRunQuery(q("status=failed&severity=critical&record=task&workflowId=w1"), NOW);
    if (!r.ok) throw new Error("parse");
    expect(runWhere("org1", r.query)).toEqual({
      organizationId: "org1",
      workflowId: "w1",
      status: { in: ["FAILED"] },
      severity: { in: ["CRITICAL"] },
      recordType: { in: ["task"] },
    });
  });

  it("orders by time then id so a keyset page never repeats a row", () => {
    const r = parseRunQuery(q("sort=oldest"), NOW);
    if (!r.ok) throw new Error("parse");
    expect(runOrderBy(r.query)).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });
});

describe("recordHref", () => {
  it("links a task to its page and gives no link for an unknown record", () => {
    expect(recordHref("task", "abc")).toBe("/item/abc");
    expect(recordHref("lead", "abc")).toBeNull();
    expect(recordHref(null, null)).toBeNull();
  });
});
