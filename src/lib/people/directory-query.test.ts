import { describe, expect, it } from "vitest";
import { activeDirectoryFilters, directoryApiParams, directoryWhere, parseDirectoryQuery } from "./directory-query";

const sp = (s: string) => new URLSearchParams(s);

describe("parseDirectoryQuery", () => {
  it("drops the privileged views and the Deactivated filter for a Member", () => {
    const q = parseDirectoryQuery(sp("view=removed&deactivated=1"), { privileged: false });
    expect(q.view).toBe("all");
    expect(q.deactivated).toBe(false);
    expect(parseDirectoryQuery(sp("view=nomanager"), { privileged: false }).view).toBe("all");
  });
  it("keeps them for the People team and Admins", () => {
    const q = parseDirectoryQuery(sp("view=removed&deactivated=1"), { privileged: true });
    expect(q.view).toBe("removed");
    expect(q.deactivated).toBe(true);
  });
  it("caps the page size at 100 and never below 1", () => {
    expect(parseDirectoryQuery(sp("size=500"), { privileged: true }).size).toBe(100);
    expect(parseDirectoryQuery(sp("size=0"), { privileged: true }).size).toBe(40);
    expect(parseDirectoryQuery(sp("page=-3"), { privileged: true }).page).toBe(1);
  });
  it("counts filters, not views or sort", () => {
    const q = parseDirectoryQuery(sp("view=new&q=an&dept=d1&tags=a,b&sort=recent"), { privileged: true });
    expect(activeDirectoryFilters(q)).toBe(3);
  });
  it("round-trips through the API params", () => {
    const q = parseDirectoryQuery(sp("q=an&dept=d1&title=r1&reportsTo=u1&page=2&size=100"), { privileged: true });
    const again = parseDirectoryQuery(directoryApiParams(q), { privileged: true });
    expect(again).toEqual(q);
  });
});

describe("directoryWhere", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  it("All excludes the removed and the deactivated", () => {
    const w = directoryWhere(parseDirectoryQuery(sp(""), { privileged: true }), now);
    expect(w).toMatchObject({ deleted: "exclude", status: "not-inactive" });
  });
  it("Removed shows only the removed, whatever their status", () => {
    const w = directoryWhere(parseDirectoryQuery(sp("view=removed"), { privileged: true }), now);
    expect(w).toMatchObject({ deleted: "only", status: "any" });
  });
  it("New is the last 90 days", () => {
    const w = directoryWhere(parseDirectoryQuery(sp("view=new"), { privileged: false }), now);
    expect(w.joinedAfter?.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });
});
