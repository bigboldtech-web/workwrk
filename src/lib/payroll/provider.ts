// Payroll provider adapter interface.
//
// The native Payroll tables (PayGroup / PayRun / Payslip / PayslipLine)
// are the source of truth for *what was paid*. The provider plugged
// behind this interface (CheckHQ today; Gusto/ADP/Rippling later)
// owns the *how* — tax calc, direct-deposit movement, W-2 filing.
//
// The split keeps an org's pay history portable: if we ever migrate
// vendors, we keep the Payslip rows and just re-point the adapter.
//
// All methods take ids only (never raw schema objects) so the
// adapter stays decoupled from Prisma. Implementations resolve the
// ids against their own client + the database as they need.

import { prisma } from "@/lib/prisma";
import {
  computeWeeklyOvertime,
  defaultUsFlsaPolicy,
  type OtPolicy,
  type OtEntry,
} from "@/lib/overtime/engine";

export type PayrollCalcResult = {
  payRunId: string;
  totalGross: number;
  totalNet: number;
  totalTax: number;
  totalDeductions: number;
  // Provider's run id — opaque to us; we store it on PayRun.providerRef.
  providerRunRef: string;
  // Per-payslip totals — adapter is responsible for upserting the
  // PayslipLine rows under each Payslip in the database. We just
  // surface the summary so the UI can show "calculated".
  payslipsCount: number;
};

export type PayrollPostResult = {
  payRunId: string;
  postedAt: Date;
  paystubsPosted: number;
};

export interface PayrollProvider {
  /**
   * Trigger calculation for an open PayRun. Adapter:
   *   1. Pulls timesheets + earnings + deductions for the period.
   *   2. Calls the provider's tax engine.
   *   3. Writes Payslip + PayslipLine rows.
   *   4. Updates PayRun.totals + status=CALCULATED.
   *
   * Idempotent — safe to retry on failure.
   */
  calculatePayRun(payRunId: string): Promise<PayrollCalcResult>;

  /**
   * Post a CALCULATED PayRun. Once posted, the run is immutable and
   * the funds are released.
   */
  postPayRun(payRunId: string): Promise<PayrollPostResult>;

  /**
   * Cancel a PayRun in DRAFT or CALCULATED state. POSTED runs can't
   * be cancelled — those need a manual reversal.
   */
  cancelPayRun(payRunId: string, reason: string): Promise<void>;

  /**
   * Provider-side capability check. Lets the UI decide whether to
   * surface "Sync to provider" buttons before a run is wired up.
   */
  isReady(): Promise<boolean>;
}

// ────────────────────────────────────────────────────────────────
// Stub provider — runs the OT engine over the real timesheets in
// the period and writes Payslip + PayslipLine rows. No tax calc
// (gross is faithful but tax is a flat 22% placeholder, deductions
// a flat 0). Lets admins preview the *shape* of payroll today and
// gives the dev team realistic data to render the UI against. The
// `post` action stays disabled until a real provider is wired —
// can't release money against placeholder tax math.
// ────────────────────────────────────────────────────────────────

const STUB_TAX_RATE = 0.22;             // 22% — federal+state placeholder
const STUB_DEFAULT_RATE = 25;           // $25/hr if a user has no rate on file

export class StubPayrollProvider implements PayrollProvider {
  async calculatePayRun(payRunId: string): Promise<PayrollCalcResult> {
    const run = await prisma.payRun.findUnique({
      where: { id: payRunId },
      include: { payGroup: { select: { id: true, currency: true } } },
    });
    if (!run) throw new Error("PayRun not found");

    const orgId = run.organizationId;
    const policy = await loadActiveOtPolicy(orgId);

    // Pull every TimeEntry whose `day` falls inside the run period.
    // We aggregate per (user × ISO-week) so OT thresholds compute
    // correctly across week boundaries inside the run.
    const entries = await prisma.timeEntry.findMany({
      where: {
        organizationId: orgId,
        day: { gte: run.periodStart, lte: run.periodEnd },
      },
      select: {
        userId: true,
        day: true,
        hours: true,
      },
    });

    // Group by user → week → entries.
    const byUser = new Map<string, Map<string, OtEntry[]>>();
    for (const e of entries) {
      if (e.hours === null) continue;
      const wk = isoWeekKey(e.day);
      let weekMap = byUser.get(e.userId);
      if (!weekMap) { weekMap = new Map(); byUser.set(e.userId, weekMap); }
      const arr = weekMap.get(wk) ?? [];
      arr.push({ day: e.day, hours: Number(e.hours) });
      weekMap.set(wk, arr);
    }

    // Existing payslips for this run — update rather than duplicate.
    const existing = await prisma.payslip.findMany({
      where: { payRunId, organizationId: orgId },
      select: { id: true, subjectId: true },
    });
    const existingBySubject = new Map(existing.map((p) => [p.subjectId, p.id]));

    // Earning code resolution — make sure REG / OT / DT exist for
    // the org so PayslipLine can reference them. Created lazily
    // because most orgs won't have a code catalog up front.
    const codes = await ensureEarningCodes(orgId);

    let totalGross = 0;
    let totalNet = 0;
    let totalTax = 0;
    let payslipsCount = 0;

    for (const [userId, weekMap] of byUser) {
      // Aggregate weekly OT computations into one paystub for the
      // employee in this run.
      let regHours = 0;
      let otHours = 0;
      let dtHours = 0;
      for (const weekEntries of weekMap.values()) {
        const { regular, overtime, doubletime } = computeWeeklyOvertime(weekEntries, policy);
        regHours += regular;
        otHours += overtime;
        dtHours += doubletime;
      }
      const totalHours = regHours + otHours + dtHours;
      if (totalHours === 0) continue;

      const rate = STUB_DEFAULT_RATE;
      const regPay = regHours * rate;
      const otPay = otHours * rate * 1.5;
      const dtPay = dtHours * rate * 2;
      const gross = regPay + otPay + dtPay;
      const tax = round2(gross * STUB_TAX_RATE);
      const net = round2(gross - tax);

      // Upsert payslip.
      const existingId = existingBySubject.get(userId);
      const slip = existingId
        ? await prisma.payslip.update({
            where: { id: existingId },
            data: {
              gross: round2(gross),
              net,
              tax,
              deductions: 0,
              hoursWorked: round2(totalHours),
            },
            select: { id: true },
          })
        : await prisma.payslip.create({
            data: {
              organizationId: orgId,
              payRunId,
              payGroupId: run.payGroupId,
              subjectId: userId,
              gross: round2(gross),
              net,
              tax,
              deductions: 0,
              hoursWorked: round2(totalHours),
              payMethod: "DIRECT_DEPOSIT",
            },
            select: { id: true },
          });

      // Replace lines (simpler than diff-based update).
      await prisma.payslipLine.deleteMany({ where: { payslipId: slip.id } });
      const lines: Array<{
        kind: "EARNING" | "DEDUCTION" | "TAX";
        earningCodeId?: string | null;
        hours?: number | null;
        rate?: number | null;
        taxLabel?: string | null;
        amount: number;
      }> = [];
      if (regHours > 0) {
        lines.push({
          kind: "EARNING",
          earningCodeId: codes.REG,
          hours: round2(regHours),
          rate,
          amount: round2(regPay),
        });
      }
      if (otHours > 0) {
        lines.push({
          kind: "EARNING",
          earningCodeId: codes.OT,
          hours: round2(otHours),
          rate: rate * 1.5,
          amount: round2(otPay),
        });
      }
      if (dtHours > 0) {
        lines.push({
          kind: "EARNING",
          earningCodeId: codes.DT,
          hours: round2(dtHours),
          rate: rate * 2,
          amount: round2(dtPay),
        });
      }
      if (tax > 0) {
        lines.push({
          kind: "TAX",
          taxLabel: "Estimated tax (placeholder 22%)",
          amount: tax,
        });
      }
      if (lines.length > 0) {
        await prisma.payslipLine.createMany({
          data: lines.map((l) => ({
            payslipId: slip.id,
            kind: l.kind,
            earningCodeId: l.earningCodeId ?? null,
            deductionCodeId: null,
            hours: l.hours ?? null,
            rate: l.rate ?? null,
            taxLabel: l.taxLabel ?? null,
            amount: l.amount,
          })),
        });
      }

      totalGross += gross;
      totalNet += net;
      totalTax += tax;
      payslipsCount += 1;
    }

    return {
      payRunId,
      totalGross: round2(totalGross),
      totalNet: round2(totalNet),
      totalTax: round2(totalTax),
      totalDeductions: 0,
      providerRunRef: `stub_${payRunId}`,
      payslipsCount,
    };
  }

  async postPayRun(_payRunId: string): Promise<PayrollPostResult> {
    throw new Error("Stub payroll provider can't post — wire CheckHQ first.");
  }

  async cancelPayRun(_payRunId: string, _reason: string): Promise<void> {
    // No-op for the stub.
  }

  async isReady(): Promise<boolean> {
    return false;
  }
}

let _provider: PayrollProvider | null = null;

export function getPayrollProvider(): PayrollProvider {
  if (_provider) return _provider;
  // Real selection (env var → CheckHQ / Gusto / ADP) lands when the
  // vendor decision ships. For now, every call returns the stub.
  _provider = new StubPayrollProvider();
  return _provider;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

async function loadActiveOtPolicy(orgId: string): Promise<OtPolicy> {
  const row = await prisma.overtimePolicy.findFirst({
    where: { organizationId: orgId, active: true },
    select: {
      dailyOtAfter: true,
      dailyDtAfter: true,
      weeklyOtAfter: true,
      seventhDayOt: true,
    },
  });
  if (!row) return defaultUsFlsaPolicy();
  return {
    dailyOtAfter: row.dailyOtAfter ? Number(row.dailyOtAfter) : null,
    dailyDtAfter: row.dailyDtAfter ? Number(row.dailyDtAfter) : null,
    weeklyOtAfter: row.weeklyOtAfter ? Number(row.weeklyOtAfter) : null,
    seventhDayOt: row.seventhDayOt,
  };
}

async function ensureEarningCodes(orgId: string): Promise<{ REG: string; OT: string; DT: string }> {
  const codes = await prisma.earningCode.findMany({
    where: { organizationId: orgId, code: { in: ["REG", "OT", "DT"] } },
    select: { id: true, code: true },
  });
  const map = new Map(codes.map((c) => [c.code, c.id]));
  for (const [code, name] of [
    ["REG", "Regular hours"],
    ["OT", "Overtime"],
    ["DT", "Double time"],
  ] as const) {
    if (!map.has(code)) {
      const created = await prisma.earningCode.create({
        data: { organizationId: orgId, code, name, taxable: true },
        select: { id: true },
      });
      map.set(code, created.id);
    }
  }
  return { REG: map.get("REG")!, OT: map.get("OT")!, DT: map.get("DT")! };
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Set to Thursday of the same week (ISO week numbering trick).
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
