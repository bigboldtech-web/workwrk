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
//                                               and its number
//   Anyone resends an unchanged number        -> the row keeps its status
//                                               and reviewer
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
  /**
   * true = leave the stored number and score exactly as they are (a blank
   * that must not erase a number). The row's notes may still be written.
   */
  keepValue: boolean;
  /** true when this save actually changes the stored number. */
  valueChanged: boolean;
}

/** The existing row as the rule needs it. `actualValue` undefined = not read. */
export interface KpiExistingRow {
  status: KpiStatus;
  reviewedById?: string | null;
  actualValue?: number | null;
}

function sameNumber(a: number | null | undefined, b: number | null): boolean {
  if (a === undefined) return false;
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 1e-9;
}

/**
 * Every recorder posts the whole month (the profile recorder autosaves all
 * rows two seconds after any keystroke), so the rule works per row and asks
 * whether THIS row changed:
 *
 *   Unchanged number                         -> the row keeps its status and
 *                                               reviewer (a resend is not a
 *                                               new submission, and a manager
 *                                               resending an employee's
 *                                               number has not approved it)
 *   Blank on a row that holds a number       -> manager: nothing changes.
 *                                               Employee: a decided row
 *                                               keeps its number; an
 *                                               undecided one goes back to
 *                                               not recorded
 *   Employee changes a number                -> SUBMITTED, reviewer cleared
 *   Employee changes only the note on a      -> SUBMITTED (the resubmit the
 *   Changes-requested row                      manager asked for)
 *   Manager changes a number                 -> APPROVED, reviewer = manager
 */
export function kpiWriteStatus(args: {
  actorId: string;
  subjectId: string;
  actual: number | null;
  existing: KpiExistingRow | null;
  /** Self only: the person's note changed on this save. */
  noteChanged?: boolean;
}): KpiWriteDecision {
  const isSelf = args.actorId === args.subjectId;
  const ex = args.existing;
  const decided = ex?.status === "APPROVED" || ex?.status === "REJECTED";
  const unchanged = ex != null && sameNumber(ex.actualValue, args.actual);
  const keep = (): KpiWriteDecision => ({ status: ex?.status ?? "PENDING", reviewedById: undefined, keepValue: true, valueChanged: false });

  if (args.actual == null) {
    if (!ex) return { status: "PENDING", reviewedById: isSelf ? null : undefined, keepValue: false, valueChanged: false };
    // A manager's blank never erases a stored number: a recorder opened
    // before the person submitted must not wipe what they typed.
    if (!isSelf) return keep();
    // Clearing your own number: a decided row keeps its number and status.
    if (decided) return keep();
    if (ex.actualValue === null) return keep();
    return { status: "PENDING", reviewedById: null, keepValue: false, valueChanged: true };
  }

  if (isSelf) {
    if (unchanged) {
      // A Changes-requested row the person answers with a new note is the
      // resubmission the manager asked for.
      if (ex!.status === "REJECTED" && args.noteChanged) {
        return { status: "SUBMITTED", reviewedById: null, keepValue: true, valueChanged: false };
      }
      if (ex!.status === "PENDING") return { status: "SUBMITTED", reviewedById: null, keepValue: true, valueChanged: false };
      return keep();
    }
    return { status: "SUBMITTED", reviewedById: null, keepValue: false, valueChanged: true };
  }

  // Manager (or People team, Admin) acting on someone else's number.
  if (unchanged) return keep();
  return { status: "APPROVED", reviewedById: args.actorId, keepValue: false, valueChanged: true };
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
