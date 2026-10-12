// POST /api/v1/kpi-records. Docs-found fixes batch 3
// (src/lib/kpi-integration.ts): the OpenAPI example "2026-Q1" was a period
// goals never read, and a second reading for the same KPI, person and month
// threw on the unique key and answered a bare 500.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentKpiPeriod, shiftKpiPeriod } from "@/lib/kpi-period";

// The answers' words, as src/lib/kpi-integration.ts says them (its own test
// holds them); written here so this file also runs against the code before.
const PERIOD_RULE = "period must be a month written YYYY-MM, such as 2026-10, and not a month that has not started yet. Goals read only month keys.";
const CLOSED_MONTH = "That month is closed, so its reading stays as it is. A reading can change only in this month or last month.";

type Row = { id: string; kpiId: string; userId: string; period: string; targetValue: number; actualValue: number | null; score: number | null; status: string; reviewedById: string | null; createdAt: Date };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  events: [] as unknown[],
  recalcs: 0,
  /** A create that loses to another call: the row lands first, then the create throws P2002. */
  raceOnCreate: null as Row | null,
  /** The KPI as stored now (its target can be edited after a reading was written). */
  kpi: { id: "kpi1", type: "QUANTITATIVE", targetValue: 100 as number | null },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: () => { st.recalcs += 1; } }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async (e: unknown) => { st.events.push(e); } }));
vi.mock("@/lib/prisma", () => {
  const find = (w: { kpiId_userId_period: { kpiId: string; userId: string; period: string } }) =>
    st.rows.find((r) => r.kpiId === w.kpiId_userId_period.kpiId && r.userId === w.kpiId_userId_period.userId && r.period === w.kpiId_userId_period.period) ?? null;
  return {
    prisma: {
      kPI: { findFirst: async (a: { where: { id: string } }) => (a.where.id === "kpi1" ? { ...st.kpi } : null) },
      user: { findFirst: async (a: { where: { id: string; organizationId: string } }) => (a.where.id === "u1" && a.where.organizationId === "org" ? { id: "u1" } : null) },
      kPIRecord: {
        findUnique: async (a: { where: { kpiId_userId_period: { kpiId: string; userId: string; period: string } } }) => find(a.where),
        create: async (a: { data: Omit<Row, "id" | "status" | "reviewedById" | "createdAt"> }) => {
          if (st.raceOnCreate) {
            st.rows.push(st.raceOnCreate);
            st.raceOnCreate = null;
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          if (st.rows.some((r) => r.kpiId === a.data.kpiId && r.userId === a.data.userId && r.period === a.data.period)) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          const row: Row = { id: `r${st.rows.length + 1}`, status: "PENDING", reviewedById: null, createdAt: new Date(), ...a.data, actualValue: a.data.actualValue ?? null, score: a.data.score ?? null };
          st.rows.push(row);
          return row;
        },
        update: async (a: { where: { kpiId_userId_period: { kpiId: string; userId: string; period: string } }; data: Partial<Row> }) => {
          const row = find(a.where)!;
          Object.assign(row, a.data);
          return row;
        },
      },
    },
  };
});

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/kpi-records", { method: "POST", body: JSON.stringify(body) }) as never);
const thisMonth = () => currentKpiPeriod();

beforeEach(() => { st.rows = []; st.events = []; st.recalcs = 0; st.raceOnCreate = null; st.kpi = { id: "kpi1", type: "QUANTITATIVE", targetValue: 100 }; });

describe("the period is a month", () => {
  it("refuses the old example, any other key and a month that has not started, saying what to send, and writes nothing", async () => {
    for (const period of ["2026-Q1", "2026-W33", "October", "2026-10-12", "2026-13", shiftKpiPeriod(thisMonth(), 2)]) {
      const res = await post({ kpiId: "kpi1", userId: "u1", period, actualValue: 5 });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: PERIOD_RULE });
    }
    expect(st.rows).toEqual([]);
    expect(st.events).toEqual([]);
  });

  it("takes this month and any month before it", async () => {
    expect((await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 5 })).status).toBe(201);
    expect((await post({ kpiId: "kpi1", userId: "u1", period: "2024-01", actualValue: 5 })).status).toBe(201);
    expect(st.events).toHaveLength(2);
  });
});

describe("a second reading for the same KPI, person and month", () => {
  it("answers 200 and changes nothing for the same number, so a retry is safe", async () => {
    await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 40 });
    const again = await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 40 });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: "r1", actualValue: 40 });
    expect(st.rows).toHaveLength(1);
    expect(st.events).toHaveLength(1);
    expect(st.recalcs).toBe(1);
  });

  it("replaces the number while the month is open, back to Pending with no reviewer, and tells subscribers", async () => {
    await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 40 });
    Object.assign(st.rows[0], { status: "APPROVED", reviewedById: "mgr" });
    const fixed = await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 55 });
    expect(fixed.status).toBe(200);
    expect(await fixed.json()).toMatchObject({ id: "r1", actualValue: 55, score: 55 });
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ actualValue: 55, status: "PENDING", reviewedById: null });
    expect(st.events).toHaveLength(2);
  });

  it("refuses a different number for a closed month with 409 and the reading's id, and keeps it", async () => {
    const closed = shiftKpiPeriod(thisMonth(), -3);
    await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 40 });
    const res = await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 41 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CLOSED_MONTH, code: "kpi_month_closed", id: "r1" });
    expect(st.rows[0].actualValue).toBe(40);
    expect(st.events).toHaveLength(1);
  });

  it("decides again against a reading another call wrote a moment before", async () => {
    st.raceOnCreate = { id: "raced", kpiId: "kpi1", userId: "u1", period: thisMonth(), targetValue: 100, actualValue: 40, score: 40, status: "PENDING", reviewedById: null, createdAt: new Date() };
    const res = await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 40 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "raced" });
  });
});

describe("the other answers", () => {
  it("answers 400 for a number that is not one, and 404 for a KPI or person outside the workspace", async () => {
    expect((await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: "lots" })).status).toBe(400);
    expect((await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 5, targetValue: "big" })).status).toBe(400);
    expect((await post({ kpiId: "kpi1", userId: "u1", period: thisMonth() })).status).toBe(400);
    expect((await post({ kpiId: "nope", userId: "u1", period: thisMonth(), actualValue: 5 })).status).toBe(404);
    expect((await post({ kpiId: "kpi1", userId: "elsewhere", period: thisMonth(), actualValue: 5 })).status).toBe(404);
    expect(st.rows).toEqual([]);
  });
});

// Docs-found fixes batch 4 (src/lib/kpi-integration.ts): a resend was
// compared with the target the integration worked out, which moves when the
// KPI's target is edited, so the same number cleared a manager's approval in
// an open month and answered 409 for every closed month; and an empty
// in-app reading (a recorder left the KPI blank) refused a backfill in a
// closed month with a 409 that said the month held a different number.
describe("what a resend is compared with, and an empty reading", () => {
  const row = (over: Partial<Row>): Row => ({ id: "r-app", kpiId: "kpi1", userId: "u1", period: thisMonth(), targetValue: 100, actualValue: 80, score: 80, status: "APPROVED", reviewedById: "mgr", createdAt: new Date(), ...over });

  it("keeps a manager's approval when the same number comes again after the KPI's target was edited", async () => {
    st.rows = [row({})];
    st.kpi = { ...st.kpi, targetValue: 120 };
    const res = await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 80 });
    expect(res.status).toBe(200);
    expect(st.rows[0]).toMatchObject({ actualValue: 80, targetValue: 100, score: 80, status: "APPROVED", reviewedById: "mgr" });
    expect(st.events).toEqual([]);
    expect(st.recalcs).toBe(0);
  });

  it("answers 200, never 409, for the same number in a closed month whose stored target differs", async () => {
    const closed = shiftKpiPeriod(thisMonth(), -3);
    st.rows = [row({ period: closed })];
    st.kpi = { ...st.kpi, targetValue: 120 };
    const res = await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 80 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "r-app", actualValue: 80, targetValue: 100 });
    // A target the caller does send is what it reported: a different one is a change.
    const sent = await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 80, targetValue: 90 });
    expect(sent.status).toBe(409);
    expect(st.rows[0]).toMatchObject({ targetValue: 100, status: "APPROVED" });
  });

  it("works out a qualitative KPI's line as the in-app recorders do, so its in-app reading resent is unchanged", async () => {
    st.kpi = { id: "kpi1", type: "QUALITATIVE", targetValue: null };
    // The in-app recorder stored the rubric ceiling as the line.
    st.rows = [row({ actualValue: 4, targetValue: 5, score: 80 })];
    expect((await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 4 })).status).toBe(200);
    expect(st.rows[0]).toMatchObject({ status: "APPROVED", reviewedById: "mgr" });
    // A new reading takes that line too.
    st.rows = [];
    const created = await post({ kpiId: "kpi1", userId: "u1", period: thisMonth(), actualValue: 4 });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ actualValue: 4, targetValue: 5, score: 80 });
  });

  it("fills an empty in-app reading in a closed month, as a create would: Pending, no reviewer, and subscribers told", async () => {
    const closed = shiftKpiPeriod(thisMonth(), -3);
    st.rows = [row({ period: closed, actualValue: null, targetValue: 0, score: null, status: "PENDING", reviewedById: null })];
    const res = await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 70 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "r-app", actualValue: 70, targetValue: 100, score: 70 });
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ actualValue: 70, status: "PENDING", reviewedById: null });
    expect(st.events).toHaveLength(1);
    // Filled, it holds a number: a different one for that closed month is refused.
    expect((await post({ kpiId: "kpi1", userId: "u1", period: closed, actualValue: 71 })).status).toBe(409);
  });
});
