// The one payload and the one transition rule for a manager's decision on a
// weekly review (spec-teams-performance section 0 "PO-1 reconciled"):
//
//   PATCH /api/weekly-reviews/[id]/manager-review
//     { decision: "APPROVED" | "CHANGES_REQUESTED" | "REOPEN", notes }
//
// The Alignment board's inline Approve / Request changes and the
// /team/reviews queue both write through this, so a decision can never be
// written two different ways. The retired `{ action: "approve" |
// "request_changes" }` body is still READ for one release (the queue client
// shipped with it), then removed.
//
// Rules, each by its worst case:
//   - CHANGES_REQUESTED needs a note: a person told "change this" with no
//     word of what is worse off than one who was told nothing.
//   - APPROVED and CHANGES_REQUESTED act only on a SUBMITTED review.
//   - REOPEN (the toast's Undo) acts only on a decided (ACKNOWLEDGED) review
//     and returns it to SUBMITTED, awaiting a decision again. It is an Undo,
//     not a second opinion: only the person who made the decision, or the
//     People team and Admin, may reopen it, and only within a day of it. A
//     decision older than that stands (the employee has acted on it), and a
//     skip-level manager can never withdraw the direct manager's words.
//     The note it clears is kept in the activity log, never lost.
//
// Pure: no imports.

export type WeeklyDecision = "APPROVED" | "CHANGES_REQUESTED" | "REOPEN";
export type WeeklyStatus = "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED";

export type ParsedDecision =
  | { ok: true; decision: WeeklyDecision; notes: string | null }
  | { ok: false; error: string };

const LEGACY: Record<string, WeeklyDecision> = {
  approve: "APPROVED",
  request_changes: "CHANGES_REQUESTED",
  reopen: "REOPEN",
};

export const NOTES_MAX = 5000;

export function parseWeeklyDecision(body: unknown): ParsedDecision {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as { decision?: unknown; action?: unknown; notes?: unknown };
  let decision: WeeklyDecision | null = null;
  if (b.decision === "APPROVED" || b.decision === "CHANGES_REQUESTED" || b.decision === "REOPEN") decision = b.decision;
  else if (typeof b.action === "string" && LEGACY[b.action]) decision = LEGACY[b.action];
  if (!decision) return { ok: false, error: "decision must be APPROVED, CHANGES_REQUESTED or REOPEN" };
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== "string") return { ok: false, error: "notes must be text" };
  const notes = typeof b.notes === "string" ? b.notes.trim() : "";
  if (notes.length > NOTES_MAX) return { ok: false, error: `notes can be at most ${NOTES_MAX} characters` };
  if (decision === "CHANGES_REQUESTED" && !notes) return { ok: false, error: "Say what should change: a note is required to request changes" };
  return { ok: true, decision, notes: notes || null };
}

/** How long after a decision its Undo stays open. */
export const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Null when this actor may reopen this decided review now; else why not. */
export function weeklyReopenBlocked(i: {
  actorId: string;
  deciderId: string | null;
  peopleTeamOrAdmin: boolean;
  reviewedAt: Date | string | null;
  now?: Date;
}): string | null {
  if (!i.peopleTeamOrAdmin && (!i.deciderId || i.deciderId !== i.actorId)) {
    return "Only the person who made this decision can undo it";
  }
  const at = i.reviewedAt ? new Date(i.reviewedAt).getTime() : NaN;
  const now = (i.now ?? new Date()).getTime();
  if (!Number.isFinite(at) || now - at > REOPEN_WINDOW_MS) {
    return "This decision is more than a day old, so it stands";
  }
  return null;
}

/** Null when the decision may apply to a review in this status; else why not. */
export function weeklyDecisionBlocked(status: WeeklyStatus, decision: WeeklyDecision): string | null {
  if (decision === "REOPEN") return status === "ACKNOWLEDGED" ? null : "Only a decided review can be reopened";
  return status === "SUBMITTED" ? null : `Cannot act on a ${status.toLowerCase()} review`;
}
