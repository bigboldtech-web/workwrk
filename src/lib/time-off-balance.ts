// Time-off balance computation. Pulled out so the list page, the
// request validator, and any future cron all use the same arithmetic.
//
// Balance = annualHours (per policy, for the current calendar year)
//   minus pending requests that overlap the current year
//   minus approved requests that overlap the current year
//
// We don't currently model accrual (linear hours-per-pay-period) or
// carryover application — annualHours is the total available for the
// year. Both are documented v2 work.

export type PolicyForBalance = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  annualHours: number;
};

export type RequestForBalance = {
  policyId: string;
  status: string;
  hours: number;
  startDate: Date;
};

export type Balance = PolicyForBalance & {
  pendingHours: number;
  usedHours: number;
  remainingHours: number;
};

export function computeBalances(
  policies: PolicyForBalance[],
  requests: RequestForBalance[],
  yearAnchor: Date = new Date(),
): Balance[] {
  const yearStart = new Date(Date.UTC(yearAnchor.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(yearAnchor.getUTCFullYear() + 1, 0, 1));

  const inYear = requests.filter(
    (r) => r.startDate >= yearStart && r.startDate < yearEnd,
  );

  return policies.map((p) => {
    const my = inYear.filter((r) => r.policyId === p.id);
    const pending = my
      .filter((r) => r.status === "PENDING")
      .reduce((acc, r) => acc + r.hours, 0);
    const used = my
      .filter((r) => r.status === "APPROVED")
      .reduce((acc, r) => acc + r.hours, 0);
    return {
      ...p,
      pendingHours: pending,
      usedHours: used,
      remainingHours: Math.max(0, p.annualHours - pending - used),
    };
  });
}
