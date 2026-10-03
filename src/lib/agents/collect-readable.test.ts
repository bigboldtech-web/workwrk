import { describe, expect, it } from "vitest";
import { clampLimit, collectReadable, olderThan } from "./collect-readable";

type Row = { id: string; n: number };
const all: Row[] = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, n: i }));

function pager(rows: Row[]) {
  let calls = 0;
  const page = async (after: Row | null, take: number) => {
    calls += 1;
    const start = after ? rows.findIndex((r) => r.id === after.id) + 1 : 0;
    return rows.slice(start, start + take);
  };
  return { page, calls: () => calls };
}

describe("collectReadable", () => {
  it("finds readable rows far down the list that one batch would miss", async () => {
    const p = pager(all);
    const keep = async (rs: Row[]) => rs.filter((r) => r.n >= 900 && r.n < 920);
    const r = await collectReadable({ limit: 20, batch: 80, maxScan: 1000, page: p.page, keep });
    expect(r.rows.map((x) => x.n)).toEqual(Array.from({ length: 20 }, (_, i) => 900 + i));
    expect(r.capped).toBe(false);
  });

  it("says when the cap cut the search short", async () => {
    const p = pager(all);
    const keep = async (rs: Row[]) => rs.filter((r) => r.n >= 900);
    const r = await collectReadable({ limit: 20, batch: 80, maxScan: 400, page: p.page, keep });
    expect(r.rows).toEqual([]);
    expect(r.capped).toBe(true);
    expect(r.scanned).toBe(400);
  });

  it("candidates that end exactly at the cap are not called cut short", async () => {
    const p = pager(all.slice(0, 400));
    const r = await collectReadable({ limit: 20, batch: 80, maxScan: 400, page: p.page, keep: async () => [] });
    expect(r).toMatchObject({ rows: [], scanned: 400, capped: false });
  });

  it("an admin who reads everything costs one page", async () => {
    const p = pager(all);
    const r = await collectReadable({ limit: 20, batch: 80, maxScan: 1000, page: p.page, keep: async (rs) => rs });
    expect(r.rows).toHaveLength(20);
    expect(p.calls()).toBe(1);
  });

  it("stops at a short last page, not capped", async () => {
    const p = pager(all.slice(0, 30));
    const r = await collectReadable({ limit: 20, batch: 80, maxScan: 1000, page: p.page, keep: async (rs) => rs.filter((x) => x.n % 2 === 0) });
    expect(r.rows).toHaveLength(15);
    expect(r.capped).toBe(false);
  });

  it("returns a row seen on two pages once, and never reads past the cap", async () => {
    const dup = [...all.slice(0, 50), all[49], ...all.slice(50, 120)];
    const p = pager(dup);
    const r = await collectReadable({ limit: 200, batch: 30, maxScan: 100, page: p.page, keep: async (rs) => rs });
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(r.rows.length);
    expect(r.scanned).toBeLessThanOrEqual(100);
  });
});

describe("olderThan", () => {
  it("reads the rows after the last one by its values, the id breaking a tie", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(olderThan(null)).toEqual({});
    expect(olderThan({ id: "r5", updatedAt: at })).toEqual({ OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: "r5" } }] });
  });
});

describe("clampLimit", () => {
  it("keeps a model-supplied limit a whole number in range", () => {
    expect(clampLimit(0, 20, 50)).toBe(1);
    expect(clampLimit(-5, 20, 50)).toBe(1);
    expect(clampLimit("abc", 20, 50)).toBe(20);
    expect(clampLimit(999, 20, 50)).toBe(50);
    expect(clampLimit(7.9, 20, 50)).toBe(7);
    expect(clampLimit(undefined, 20, 50)).toBe(20);
  });
});
