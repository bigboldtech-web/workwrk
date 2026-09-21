// /policies/compliance (spec-process section 2): the pure half of the
// dashboard page and its API. Views, the search rule over the two tables the
// page shows, and the StatRow figures, so the route and the page cannot
// disagree on what "Required" or "Open gaps" means. No imports.

export type PolicyComplianceView = "overview" | "people" | "policies" | "gaps";
export const POLICY_COMPLIANCE_VIEWS: readonly PolicyComplianceView[] = ["overview", "people", "policies", "gaps"];
export const POLICY_COMPLIANCE_VIEW_LABEL: Record<PolicyComplianceView, string> = {
  overview: "Overview",
  people: "By person",
  policies: "By policy",
  gaps: "Open gaps",
};
export function parsePolicyComplianceView(raw: string | null | undefined): PolicyComplianceView {
  return POLICY_COMPLIANCE_VIEWS.includes(raw as PolicyComplianceView) ? (raw as PolicyComplianceView) : "overview";
}

export type Period = "month" | "30d" | "quarter" | "all";
export const PERIODS: ReadonlyArray<{ key: Period; label: string }> = [
  { key: "all", label: "All time" },
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
];
export function parsePeriod(raw: string | null | undefined): Period {
  return PERIODS.some((p) => p.key === raw) ? (raw as Period) : "all";
}
/** The earliest instant a row must fall after to be inside the period, or null for all time. */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  const q = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), q, 1);
}

export interface PolicyComplianceOverview {
  totalPolicies: number;
  totalUsers: number;
  totalRequired: number;
  totalAcked: number;
  orgRate: number;
  pending: number;
  overdue: number;
  outOfDate: number;
}

/** The four StatRow cards: Required, Acknowledged, Pending, Overdue. */
export function policyComplianceStats(o: PolicyComplianceOverview) {
  return [
    { label: "Required", value: String(o.totalRequired), sub: `${o.totalPolicies} ${o.totalPolicies === 1 ? "policy" : "policies"} · ${o.totalUsers} people` },
    { label: "Acknowledged", value: `${o.totalAcked} of ${o.totalRequired}`, sub: `${o.orgRate}%` },
    { label: "Pending", value: String(o.pending), sub: o.outOfDate > 0 ? `${o.outOfDate} need re-acknowledgement` : undefined },
    { label: "Overdue", value: String(o.overdue), sub: o.overdue > 0 ? "overdue" : "nothing overdue", dot: o.overdue > 0 ? ("danger" as const) : undefined },
  ];
}

export interface GapRowLike {
  policyTitle: string;
  userName: string;
  department: string;
}
export interface PersonRowLike {
  name: string;
  department: string;
}
export interface PolicyRowLike {
  title: string;
  category: string | null;
}

/** `q` matches the person's name and the policy title, in whichever table the view shows. */
export function matchesGap(row: GapRowLike, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${row.policyTitle} ${row.userName} ${row.department}`.toLowerCase().includes(s);
}
export function matchesPerson(row: PersonRowLike, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${row.name} ${row.department}`.toLowerCase().includes(s);
}
export function matchesPolicy(row: PolicyRowLike, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${row.title} ${row.category ?? ""}`.toLowerCase().includes(s);
}

/** The "3 days late" / "Due {date}" / "Re-acknowledge" word for an open gap row. */
export function gapStatusWord(status: string, daysOverdue: number): string {
  if (status === "overdue") return daysOverdue > 0 ? `${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} late` : "Overdue";
  if (status === "out-of-date") return "Re-acknowledge";
  return "Pending";
}
