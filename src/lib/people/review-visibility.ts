// What one review row shows to the person looking at it (the cycle GET,
// /api/reviews/[id]). Pure, so the rules are tested without a database.
//
// Worst cases this closes:
//  - The subject must never read their manager's autosaved draft (the
//    managerAssessment JSON carries the recommendation, PIP or exit), the
//    calibration fields or the 9-box potential (DECIDED: the employee does
//    not see their own 9-box placement). Before the review is COMPLETED the
//    manager's rating, comments, score and outcome stay back too; after it,
//    the subject sees the final score, outcome and comments, as before.
//  - A peer asked for feedback who is not otherwise in the cycle sees the
//    header (who the feedback is about) and their own peer rows, nothing
//    of the review itself.

export type ReviewLens = "full" | "subject" | "peer";

/** Fields no subject ever reads on their own row. */
const NEVER_FOR_SUBJECT = [
  "managerAssessment",
  "calibratedScore",
  "calibrationNotes",
  "calibratedById",
  "calibratedAt",
  "potential",
  "peerRating",
  "compositeScore",
] as const;

/** Manager-written fields the subject reads only once the review is COMPLETED. */
const SUBJECT_AFTER_COMPLETE = [
  "managerRating",
  "managerComments",
  "overallScore",
  "outcome",
  "strengths",
  "improvements",
] as const;

/** Nulls a list of fields present on the row (never adds a key that was absent). */
function nulled<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (k in out) out[k] = null;
  return out as T;
}

export function reviewLens(opts: {
  callerId: string;
  hrAdmin: boolean;
  subjectId: string;
  reviewerId: string;
  /** The caller's chain, the caller included. */
  inTree: boolean;
}): ReviewLens {
  if (opts.hrAdmin) return "full";
  if (opts.subjectId === opts.callerId) return "subject";
  if (opts.reviewerId === opts.callerId || opts.inTree) return "full";
  return "peer";
}

/** The subject's own row: calibration and potential always stripped. */
export function subjectRowView<T extends Record<string, unknown> & { status?: unknown; reviewerId?: unknown }>(
  row: T,
  callerId: string,
): T {
  let out = nulled(row, NEVER_FOR_SUBJECT);
  // A self-reviewer (no manager) wrote the manager fields themselves.
  const ownReviewer = row.reviewerId === callerId;
  if (!ownReviewer && row.status !== "COMPLETED") out = nulled(out, SUBJECT_AFTER_COMPLETE);
  return out;
}

/** A peer respondent's view of a row they only give feedback on. */
export function peerRowView<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const keep = ["id", "cycleId", "subjectId", "reviewerId", "status", "createdAt", "updatedAt", "subject", "reviewer", "peerFeedback"];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in row) out[k] = row[k];
  const subject = row.subject as Record<string, unknown> | undefined;
  if (subject && typeof subject === "object") out.subject = { ...subject, email: undefined };
  out.peerOnly = true;
  return out;
}
