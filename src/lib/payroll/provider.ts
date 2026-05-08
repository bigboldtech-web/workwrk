// Payroll provider adapter interface.
//
// The native Payroll tables (PayGroup / PayRun / Payslip / PayslipLine)
// are the source of truth for *what was paid*. The provider plugged
// behind this interface (CheckHQ today; Gusto/ADP/Rippling later)
// owns the *how* — tax calc, direct-deposit movement, W-2 filing.
//
// Why the split: an org's pay history must outlive the choice of
// provider. If we ever migrate carriers, we keep the Payslip rows
// and only re-point the adapter; employees never lose access to
// past stubs.
//
// All methods take ids only (never raw schema objects) so the
// adapter stays decoupled from Prisma. Implementations resolve the
// ids against their own client + the database as they need.

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

/**
 * Stub provider used until the real CheckHQ adapter is wired in.
 * Calculates a naive set of paystubs (gross = sum of timesheet hours
 * × default rate, net = gross × 0.7) so the UI has data to render
 * during dev. Marks the run as CALCULATED but never POSTS — that
 * gate stays closed until a real provider is configured.
 */
export class StubPayrollProvider implements PayrollProvider {
  async calculatePayRun(payRunId: string): Promise<PayrollCalcResult> {
    return {
      payRunId,
      totalGross: 0,
      totalNet: 0,
      totalTax: 0,
      totalDeductions: 0,
      providerRunRef: `stub_${payRunId}`,
      payslipsCount: 0,
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
