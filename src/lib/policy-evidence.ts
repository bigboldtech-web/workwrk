// Shared policy-acknowledgement evidence logic — used by the compliance
// dashboard API, the per-policy audit ledger, and the CSV export so the three
// surfaces never drift on what "acked / out-of-date / overdue / pending" means.

export type AckRecord = {
  version: number | null;
  acknowledgedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  attestation?: string | null;
  contentHash?: string | null;
};

export type AckStatus = "acked" | "overdue" | "out-of-date" | "pending";

export type AckSummary = {
  ackedCurrent: boolean; // acknowledged at or beyond the required version
  hasOlderAck: boolean; // acknowledged only a prior version (must re-ack)
  record: AckRecord | null; // the most relevant ack row (current if any, else newest older)
};

// Reduce one user's ack rows against the version acks are measured against.
export function summarizeUserAcks(ackVersion: number, acks: AckRecord[]): AckSummary {
  let current: AckRecord | null = null;
  let older: AckRecord | null = null;
  for (const a of acks) {
    const v = a.version ?? 0;
    if (v >= ackVersion) {
      if (!current || (a.version ?? 0) > (current.version ?? 0)) current = a;
    } else if (!older || (a.version ?? 0) > (older.version ?? 0)) {
      older = a;
    }
  }
  return { ackedCurrent: !!current, hasOlderAck: !current && !!older, record: current ?? older ?? null };
}

// Single categorical status for a (policy, user), priority acked > overdue >
// out-of-date > pending. `dueDate` is the user's assignment due date if any.
export function ackStatusFor(summary: AckSummary, dueDate: Date | null | undefined, now: Date): AckStatus {
  if (summary.ackedCurrent) return "acked";
  if (dueDate && dueDate.getTime() < now.getTime()) return "overdue";
  if (summary.hasOlderAck) return "out-of-date";
  return "pending";
}

export function daysOverdue(dueDate: Date | null | undefined, now: Date): number {
  if (!dueDate) return 0;
  const ms = now.getTime() - dueDate.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}
