// The Alignment and Sub-teams tables' row rules (spec-goals /team/alignment,
// /team/rollup), pure so both tables and the tests agree.
//
//   weeklyReviewChip   the row's one pale chip for this week's review:
//                      Not started · Draft · Awaiting you (submitted) ·
//                      Approved · Changes requested
//   reviewUrgency      the default sort, most urgent first: awaiting you,
//                      changes requested, not started, draft, approved
//   kraWeightTotal     the sum of a person's active KRA weights
//   alignmentFilter    the Filter panel's predicate

import { complianceBand, type ComplianceBand } from "@/lib/alignment-tone";

export type WeeklyStatus = "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | null;
export type WeeklyManagerStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | null;
export type WeeklyKey = "not_started" | "draft" | "submitted" | "approved" | "changes";

export function weeklyReviewKey(r: { status: WeeklyStatus; managerStatus: WeeklyManagerStatus }): WeeklyKey {
  if (!r.status) return "not_started";
  if (r.status === "DRAFT") return "draft";
  if (r.status === "SUBMITTED") return "submitted";
  if (r.managerStatus === "CHANGES_REQUESTED") return "changes";
  return "approved";
}

export function weeklyReviewChip(r: { status: WeeklyStatus; managerStatus: WeeklyManagerStatus }, opts: { forManager?: boolean } = { forManager: true }): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  switch (weeklyReviewKey(r)) {
    case "not_started": return { label: "Not started", tone: "neutral" };
    case "draft": return { label: "Draft", tone: "neutral" };
    case "submitted": return { label: opts.forManager === false ? "Submitted" : "Awaiting you", tone: "warning" };
    case "changes": return { label: "Changes requested", tone: "danger" };
    default: return { label: "Approved", tone: "success" };
  }
}

const URGENCY: Record<WeeklyKey, number> = { submitted: 0, changes: 1, not_started: 2, draft: 3, approved: 4 };
export function reviewUrgency(r: { status: WeeklyStatus; managerStatus: WeeklyManagerStatus }): number {
  return URGENCY[weeklyReviewKey(r)];
}

export function kraWeightTotal(kras: ReadonlyArray<{ weightage: number }>): number {
  return Math.round(kras.reduce((s, k) => s + (Number.isFinite(k.weightage) ? k.weightage : 0), 0));
}

export interface AlignmentFilter {
  via: Array<"solid" | "dotted">;
  weekly: WeeklyKey[];
  kpiBands: ComplianceBand[];
  sopBands: ComplianceBand[];
  mandatoryPending: boolean;
  weightsOff: boolean;
  directOnly: boolean;
}

export const EMPTY_ALIGNMENT_FILTER: AlignmentFilter = { via: [], weekly: [], kpiBands: [], sopBands: [], mandatoryPending: false, weightsOff: false, directOnly: false };

export function alignmentFilterCount(f: AlignmentFilter): number {
  return f.via.length + f.weekly.length + f.kpiBands.length + f.sopBands.length + (f.mandatoryPending ? 1 : 0) + (f.weightsOff ? 1 : 0) + (f.directOnly ? 1 : 0);
}

export function matchesAlignmentFilter(m: {
  via: "solid" | "dotted";
  direct?: boolean;
  activeKras: ReadonlyArray<{ weightage: number }>;
  kpiPct: number | null;
  sopPct: number | null;
  mandatoryPending: number;
  weekly: { status: WeeklyStatus; managerStatus: WeeklyManagerStatus };
}, f: AlignmentFilter): boolean {
  if (f.via.length && !f.via.includes(m.via)) return false;
  if (f.weekly.length && !f.weekly.includes(weeklyReviewKey(m.weekly))) return false;
  if (f.kpiBands.length && !f.kpiBands.includes(complianceBand(m.kpiPct))) return false;
  if (f.sopBands.length && !f.sopBands.includes(complianceBand(m.sopPct))) return false;
  if (f.mandatoryPending && m.mandatoryPending <= 0) return false;
  if (f.weightsOff && (m.activeKras.length === 0 || kraWeightTotal(m.activeKras) === 100)) return false;
  if (f.directOnly && m.direct === false) return false;
  return true;
}
