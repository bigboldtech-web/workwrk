import { describe, expect, it } from "vitest";
import { draftHasContent, kpiDraftKey, loadKpiDraft, persistKpiDraft, storedDraftsFor, draftLiveForCounts, draftKinds, pruneKpiDraft } from "./kpi-review-draft";

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

describe("stale drafts (a row decided after the manager typed)", () => {
  it("skips a stored draft the page says can no longer save", () => {
    const s = memStore({
      [kpiDraftKey("amit", "2026-09")]: JSON.stringify({ k: { actual: "3" } }),
      [kpiDraftKey("priya", "2026-09")]: JSON.stringify({ k: { actual: "42" } }),
    });
    const live = (userId: string) => userId === "priya";
    expect(storedDraftsFor(["amit", "priya"], () => true, s, live)).toEqual([{ userId: "priya", period: "2026-09" }]);
  });

  it("judges a draft by the month's counts before the rows load", () => {
    const num = { k: { actual: "3" } };
    const note = { k: { notes: "check the source" } };
    // Everything submitted or approved: a number can never save.
    expect(draftLiveForCounts(num, { total: 2, submitted: 1, approved: 1 })).toBe(false);
    // A submitted row still takes a manager note.
    expect(draftLiveForCounts(note, { total: 2, submitted: 1, approved: 1 })).toBe(true);
    // All approved: nothing saves, not even a note.
    expect(draftLiveForCounts(note, { total: 2, submitted: 0, approved: 2 })).toBe(false);
    // A KPI with no record yet takes a number.
    expect(draftLiveForCounts(num, { total: 3, submitted: 1, approved: 1 })).toBe(true);
    expect(draftKinds({ a: { actual: "x" }, b: { notes: " " } })).toEqual({ number: false, note: false });
  });

  it("keeps only what can still save once the rows are known", () => {
    const d = { open: { actual: "5", notes: "n" }, sub: { actual: "9", notes: "please recheck" }, subBare: { actual: "9" }, done: { actual: "1" }, gone: { actual: "2" } };
    const fit = (id: string) => (id === "open" ? "number" : id === "sub" || id === "subBare" ? "note" : "none") as "number" | "note" | "none";
    expect(pruneKpiDraft(d, fit)).toEqual({ open: { actual: "5", notes: "n" }, sub: { notes: "please recheck" } });
    const clean = { open: { actual: "5" } };
    expect(pruneKpiDraft(clean, () => "number")).toBe(clean);
  });
});
