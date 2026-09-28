import { describe, expect, it } from "vitest";
import { draftHasContent, kpiDraftKey, loadKpiDraft, persistKpiDraft, storedDraftsFor } from "./kpi-review-draft";

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

describe("kpi review drafts", () => {
  it("round-trips and removes an empty draft", () => {
    const s = memStore();
    persistKpiDraft("u1", "2026-09", { k1: { actual: "42" } }, s);
    expect(loadKpiDraft("u1", "2026-09", s)).toEqual({ k1: { actual: "42" } });
    persistKpiDraft("u1", "2026-09", {}, s);
    expect(s.map.has(kpiDraftKey("u1", "2026-09"))).toBe(false);
  });

  it("reads a broken value as no draft", () => {
    const s = memStore({ [kpiDraftKey("u1", "2026-09")]: "{not json" });
    expect(loadKpiDraft("u1", "2026-09", s)).toEqual({});
  });

  it("counts a number or a note as content, not blanks or junk", () => {
    expect(draftHasContent({ a: { actual: "" } })).toBe(false);
    expect(draftHasContent({ a: { actual: "abc" } })).toBe(false);
    expect(draftHasContent({ a: { notes: "  " } })).toBe(false);
    expect(draftHasContent({ a: { actual: "0" } })).toBe(true);
    expect(draftHasContent({ a: { notes: "late" } })).toBe(true);
  });

  it("finds drafts only for listed people and open months, newest month first", () => {
    const s = memStore({
      [kpiDraftKey("amit", "2026-09")]: JSON.stringify({ k: { actual: "" } }),
      [kpiDraftKey("priya", "2026-08")]: JSON.stringify({ k: { actual: "7" } }),
      [kpiDraftKey("priya", "2026-09")]: JSON.stringify({ k: { actual: "42" } }),
      [kpiDraftKey("stranger", "2026-09")]: JSON.stringify({ k: { actual: "1" } }),
      [kpiDraftKey("priya", "2026-01")]: JSON.stringify({ k: { actual: "3" } }),
      "workwrk:other": "x",
    });
    const open = (p: string) => p === "2026-09" || p === "2026-08";
    expect(storedDraftsFor(["amit", "priya"], open, s)).toEqual([
      { userId: "priya", period: "2026-09" },
      { userId: "priya", period: "2026-08" },
    ]);
  });

  it("orders people as the page lists them within a month", () => {
    const s = memStore({
      [kpiDraftKey("b", "2026-09")]: JSON.stringify({ k: { actual: "1" } }),
      [kpiDraftKey("a", "2026-09")]: JSON.stringify({ k: { notes: "n" } }),
    });
    expect(storedDraftsFor(["a", "b"], () => true, s).map((d) => d.userId)).toEqual(["a", "b"]);
  });
});
