// Contract test for POST /api/kpi-records/self-report: which rows a save
// writes.
//
// The recorder resends every KPI of the month on each save, the blanks as
// actualValue null. A blank KPI with no row yet used to be created as a
// PENDING row with no value, so typing one number and pressing Save all
// toasted "Saved 2 KPI records" and History gained a "Not recorded" row the
// person never touched. The database is mocked; the test reads which upserts
// the route hands the transaction.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { kpiId: string; status: string; reviewedById: string | null; actualValue: number | null; notes: string | null; evidence: string | null };
let existing: Row[] = [];
const upserts: Array<{ where: { kpiId_userId_period: { kpiId: string } }; create: { status: string; actualValue: number | null } }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kRAAssignment: {
      findMany: async () => [{
        kra: {
          kpis: [
            { id: "k-typed", type: "QUANTITATIVE", targetValue: 5, direction: "LOWER", lowerIsBetter: true },
            { id: "k-blank", type: "QUANTITATIVE", targetValue: 95, direction: "HIGHER", lowerIsBetter: false },
            { id: "k-noted", type: "QUANTITATIVE", targetValue: 3, direction: "HIGHER", lowerIsBetter: false },
          ],
        },
      }],
    },
    kPIRecord: {
      findMany: async () => existing,
      upsert: (args: (typeof upserts)[number]) => { upserts.push(args); return args; },
    },
    $transaction: async (ops: Array<(typeof upserts)[number]>) =>
      ops.map((o) => ({ kpiId: o.where.kpiId_userId_period.kpiId, status: o.create.status })),
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: {} } }),
  getOrgId: () => "org-1",
  getUserId: () => "u-me",
  jsonError: (message: string, status = 400) => ({ message, status }),
  jsonSuccess: (data: unknown) => data,
}));

vi.mock("@/lib/kpi-review.server", () => ({
  notifyKpiSubmitted: async () => undefined,
  notifyKpiDecision: async () => undefined,
}));

vi.mock("@/lib/kpi-period", () => ({
  isKpiPeriodWritableAnyZone: () => true,
}));

import { POST } from "./route";

function post(records: unknown[]) {
  const req = { json: async () => ({ period: "2026-09", records }) };
  return POST(req as never) as unknown as Promise<{ saved: number; skipped: number }>;
}

beforeEach(() => {
  existing = [];
  upserts.length = 0;
});

describe("self-report, a blank KPI with no row", () => {
  it("writes only the typed number, and saved counts it alone", async () => {
    const res = await post([
      { kpiId: "k-typed", actualValue: 4, notes: null },
      { kpiId: "k-blank", actualValue: null, notes: null },
    ]);
    expect(upserts.map((u) => u.where.kpiId_userId_period.kpiId)).toEqual(["k-typed"]);
    expect(upserts[0].create.status).toBe("SUBMITTED");
    expect(res.saved).toBe(1);
  });

  it("an all-blank save writes nothing", async () => {
    const res = await post([
      { kpiId: "k-typed", actualValue: null },
      { kpiId: "k-blank", actualValue: "" },
    ]);
    expect(upserts).toHaveLength(0);
    expect(res.saved).toBe(0);
  });

  it("a blank number with a note still keeps the note", async () => {
    await post([{ kpiId: "k-noted", actualValue: null, notes: "Waiting on the Q3 export" }]);
    expect(upserts.map((u) => u.where.kpiId_userId_period.kpiId)).toEqual(["k-noted"]);
  });

  it("clearing a number that has a row still reaches the row", async () => {
    existing = [{ kpiId: "k-typed", status: "SUBMITTED", reviewedById: null, actualValue: 4, notes: null, evidence: null }];
    await post([{ kpiId: "k-typed", actualValue: null }]);
    // kpiWriteStatus: an undecided number cleared by its owner goes back to
    // not recorded, so the row is rewritten, never skipped.
    expect(upserts.map((u) => u.where.kpiId_userId_period.kpiId)).toEqual(["k-typed"]);
  });
});
