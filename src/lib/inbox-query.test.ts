import { describe, it, expect, afterEach } from "vitest";
import {
  setClearedAtAvailable,
  tabUnreadWhere,
  tabWhere,
  typesForGroups,
  unreadWhere,
  withClearedAtFallback,
  isMissingClearedAtError,
} from "./inbox-query";
import { typesForTab } from "./inbox-kinds";

const NOW = new Date("2026-09-16T14:30:00.000Z");
const ME = "u1";

function json(value: unknown): string {
  return JSON.stringify(value);
}

afterEach(() => setClearedAtAvailable(true));

describe("tabWhere", () => {
  it("scopes every tab to the caller and nobody else", () => {
    for (const tab of ["primary", "other", "mentions", "snoozed", "cleared"] as const) {
      expect(tabWhere(tab, ME, NOW), tab).toMatchObject({ userId: ME });
    }
  });

  it("Primary is UNCLEARED, unsnoozed, and IN the primary types", () => {
    const where = tabWhere("primary", ME, NOW);
    expect(where.clearedAt).toBeNull();
    expect(where.type).toEqual({ in: typesForTab("primary") });
    expect(json(where.OR)).toContain("snoozedUntil");
  });

  it("a READ row stays in its tab: read is a weight, not a filing decision", () => {
    // This is the defect the whole clearedAt change exists to fix. When the
    // tab was `read: false`, the 1.5s auto-mark-read on the page took the row
    // you had just clicked out of the list and emptied the detail pane.
    for (const tab of ["primary", "other", "mentions"] as const) {
      expect(tabWhere(tab, ME, NOW).read, tab).toBeUndefined();
    }
  });

  it("Other is NOT IN the primary types, so an unrouted type still appears", () => {
    // This is the whole point: an automation author can write any string, and
    // an `IN` on both tabs would make such a row unreachable while it still
    // counted toward the unread badge.
    const where = tabWhere("other", ME, NOW);
    expect(where.type).toEqual({ notIn: typesForTab("primary") });
  });

  it("Other widens to every uncleared row when Show everything is on", () => {
    const where = tabWhere("other", ME, NOW, true);
    expect(where.type).toBeUndefined();
    expect(where.clearedAt).toBeNull();
  });

  it("Mentions ignores read state: a mention you read is still a mention", () => {
    const where = tabWhere("mentions", ME, NOW);
    expect(where.read).toBeUndefined();
    expect(where.type).toEqual({ in: ["mention"] });
  });

  it("Snoozed is strictly in the future, so a lapsed snooze is back in Primary", () => {
    expect(tabWhere("snoozed", ME, NOW).snoozedUntil).toEqual({ gt: NOW });
  });

  it("Cleared is the rows somebody cleared, whatever the type or the snooze", () => {
    const where = tabWhere("cleared", ME, NOW);
    expect(where).toEqual({ userId: ME, clearedAt: { not: null } });
  });

  it("Primary and Other are disjoint, so nothing is counted twice", () => {
    const primary = tabWhere("primary", ME, NOW).type as { in: string[] };
    const other = tabWhere("other", ME, NOW).type as { notIn: string[] };
    expect(other.notIn).toEqual(primary.in);
  });
});

describe("tabUnreadWhere", () => {
  it("is the tab plus unread, which is the number the pill prints", () => {
    const where = tabUnreadWhere("primary", ME, NOW);
    expect(where.AND).toHaveLength(2);
    expect(json(where.AND)).toContain('"read":false');
  });
});

describe("unreadWhere", () => {
  it("is the ONE unread clause: unread, uncleared, not currently snoozed", () => {
    const where = unreadWhere(ME, NOW);
    expect(where).toMatchObject({ userId: ME, read: false, clearedAt: null });
    expect(json(where.OR)).toContain("snoozedUntil");
  });

  it("has no type filter, so it is exactly Primary plus Other", () => {
    // The badge, the bell and the Home widget all read this number. If it
    // filtered by type, an unrouted notification would raise a badge that no
    // tab could clear.
    expect(unreadWhere(ME, NOW).type).toBeUndefined();
  });
});

describe("the one release without the column", () => {
  it("falls back to the old read-based semantics", () => {
    setClearedAtAvailable(false);
    expect(tabWhere("primary", ME, NOW).read).toBe(false);
    expect(tabWhere("primary", ME, NOW).clearedAt).toBeUndefined();
    expect(tabWhere("cleared", ME, NOW)).toEqual({ userId: ME, read: true });
    expect(unreadWhere(ME, NOW).clearedAt).toBeUndefined();
  });

  it("recognises the error Postgres raises for the missing column", () => {
    expect(isMissingClearedAtError({ code: "P2022", meta: { column: "clearedAt" } })).toBe(true);
    expect(isMissingClearedAtError({ code: "P2022", meta: { column: "somethingElse" } })).toBe(false);
    expect(isMissingClearedAtError(new Error("boom"))).toBe(false);
  });

  it("retries once, on the legacy clauses, and never loops", () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      if (calls === 1) throw { code: "P2022", meta: { column: "clearedAt" } };
      return tabWhere("primary", ME, NOW);
    };
    return withClearedAtFallback(run).then((where) => {
      expect(calls).toBe(2);
      expect(where.read).toBe(false);
    });
  });

  it("rethrows an error that is not the missing column", async () => {
    await expect(withClearedAtFallback(async () => { throw new Error("db is on fire"); })).rejects.toThrow("db is on fire");
  });
});

describe("typesForGroups", () => {
  it("flattens Filter-panel rows into one type list with no duplicates", () => {
    const types = typesForGroups(["tasks", "mentions"]);
    expect(types).toContain("task_assigned");
    expect(types).toContain("mention");
    expect(new Set(types).size).toBe(types.length);
  });

  it("is empty for no groups, which the caller reads as no filter", () => {
    expect(typesForGroups([])).toEqual([]);
  });
});
