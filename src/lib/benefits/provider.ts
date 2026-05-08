// Benefits carrier adapter interface.
//
// Native rows (BenefitPlan / BenefitTier / OpenEnrollment / BenefitEnrollment
// / Dependent / LifeEvent) capture every election the org has made.
// The carrier behind this interface (Sequoia / Plansource / direct
// integrations) confirms enrollments, updates coverage state, and
// returns its own reference id — which we stamp onto BenefitEnrollment.
// Same portability story as payroll.

export type EnrollmentSubmitResult = {
  enrollmentId: string;
  providerRef: string;
  // Some carriers confirm same-day; others queue and we backfill via
  // webhook. `confirmed` flips to true when the carrier acknowledges.
  confirmed: boolean;
};

export type EnrollmentCancelResult = {
  enrollmentId: string;
  cancelledAt: Date;
};

export interface BenefitsProvider {
  /**
   * Submit a DRAFT enrollment to the carrier. Adapter is responsible
   * for stamping providerRef + flipping status to SUBMITTED.
   */
  submitEnrollment(enrollmentId: string): Promise<EnrollmentSubmitResult>;

  /**
   * Cancel an ACTIVE enrollment (employee leaves, OE rollback, etc.).
   * Adapter handles carrier cancellation + flips status to CANCELLED.
   */
  cancelEnrollment(enrollmentId: string, reason: string): Promise<EnrollmentCancelResult>;

  isReady(): Promise<boolean>;
}

export class StubBenefitsProvider implements BenefitsProvider {
  async submitEnrollment(enrollmentId: string): Promise<EnrollmentSubmitResult> {
    return {
      enrollmentId,
      providerRef: `stub_${enrollmentId}`,
      confirmed: true,
    };
  }

  async cancelEnrollment(enrollmentId: string, _reason: string): Promise<EnrollmentCancelResult> {
    return { enrollmentId, cancelledAt: new Date() };
  }

  async isReady(): Promise<boolean> {
    return false;
  }
}

let _provider: BenefitsProvider | null = null;

export function getBenefitsProvider(): BenefitsProvider {
  if (_provider) return _provider;
  _provider = new StubBenefitsProvider();
  return _provider;
}
