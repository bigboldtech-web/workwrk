// The KPI record status rule (spec-goals section 2 /team/kpi-reviews, "The
// KPI review loop, end to end"), in one pure function that every writer of
// a KPIRecord asks: POST /api/kpi-records (the manager's Record on behalf
// and the profile recorder's single save), POST /api/kpi-records/batch and
// POST /api/kpi-records/self-report.
//
//   Employee records their own number        -> SUBMITTED (awaits approval);
//                                               no number yet -> PENDING
//   Employee resubmits a Changes-requested    -> SUBMITTED
//   Manager records on behalf (Can edit on    -> APPROVED, reviewedById =
//   the person, never themselves)               the manager: a number the
//                                               manager typed does not wait
//                                               in the manager's own queue
//   Manager saves a row with no number        -> the row keeps its status
//                                               (never downgraded to PENDING)
//
// Before this rule a manager-typed number landed SUBMITTED and waited for
// the manager's own approval, and re-saving an APPROVED record silently set
// it back to SUBMITTED. The upsert key (kpiId, userId, period) is unchanged.
//
// Pure: no Prisma.

export type KpiStatus = "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";

export interface KpiWriteDecision {
  status: KpiStatus;
  /** undefined = leave the column as it is; null = clear it. */
  reviewedById: string | null | undefined;
}

export function kpiWriteStatus(args: {
  actorId: string;
  subjectId: string;
  actual: number | null;
  existing: { status: KpiStatus; reviewedById?: string | null } | null;
}): KpiWriteDecision {
  const isSelf = args.actorId === args.subjectId;
  if (isSelf) {
    if (args.actual == null) {
      // Clearing your own number: back to not recorded unless a manager
      // already decided on the row, which a blank save must never undo.
      if (args.existing && (args.existing.status === "APPROVED" || args.existing.status === "REJECTED")) {
        return { status: args.existing.status, reviewedById: undefined };
      }
      return { status: "PENDING", reviewedById: null };
    }
    return { status: "SUBMITTED", reviewedById: null };
  }
  // Manager (or People team, Admin) acting on someone else's number.
  if (args.actual == null) {
    return { status: args.existing?.status ?? "PENDING", reviewedById: undefined };
  }
  return { status: "APPROVED", reviewedById: args.actorId };
}

/** The one vocabulary people read (spec-goals: "Statuses shown to people"). */
export function kpiStatusLabel(status: string, opts: { forManager?: boolean; recordedByManager?: boolean } = {}): string {
  switch (status) {
    case "SUBMITTED": return opts.forManager ? "Awaiting you" : "Awaiting approval";
    case "APPROVED": return opts.recordedByManager && !opts.forManager ? "Recorded by manager" : "Approved";
    case "REJECTED": return "Changes requested";
    default: return "Not recorded";
  }
}

export function kpiStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  return status === "APPROVED" ? "success" : status === "SUBMITTED" ? "warning" : status === "REJECTED" ? "danger" : "neutral";
}

/**
 * A person's chip on the KPI reviews people list, from their counts for
 * the month. Attention first: anything awaiting the manager wins, then
 * changes requested, then not recorded, then approved.
 */
export function personKpiChip(c: { pending: number; submitted: number; approved: number; rejected: number; total: number }): {
  key: "awaiting" | "changes" | "notRecorded" | "approved" | "noKpis";
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  needsYou: boolean;
} {
  if (c.total === 0) return { key: "noKpis", label: "No KPIs", tone: "neutral", needsYou: false };
  if (c.submitted > 0) return { key: "awaiting", label: `Awaiting you · ${c.submitted}`, tone: "warning", needsYou: true };
  if (c.rejected > 0) return { key: "changes", label: "Changes requested", tone: "danger", needsYou: false };
  if (c.pending > 0 || c.approved < c.total) return { key: "notRecorded", label: "Not recorded", tone: "neutral", needsYou: true };
  return { key: "approved", label: "Approved", tone: "success", needsYou: false };
}
