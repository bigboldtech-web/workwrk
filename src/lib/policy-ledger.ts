// Builds a policy's acknowledgement ledger: one row per expected person with
// their acknowledgement evidence. Shared by the ledger API and the CSV export
// so both produce identical records.
//
// `scopeUserIds` (spec-process section 1: "hasReports over their chain,
// rows filtered by can(view, person)") narrows the rows and the summary to
// the people the viewer may see; null means everyone in the org.

import { prisma } from "@/lib/prisma";
import { summarizeUserAcks, ackStatusFor, daysOverdue, type AckRecord, type AckStatus } from "@/lib/policy-evidence";

export type LedgerRow = {
  userId: string;
  assignmentId: string | null;
  name: string;
  email: string | null;
  avatar: string | null;
  department: string;
  required: boolean; // assigned (true) vs org-wide expectation (false)
  mandatory: boolean;
  status: AckStatus;
  versionAcked: number | null;
  acknowledgedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  attestation: string | null;
  contentHash: string | null;
  dueDate: string | null;
  daysOverdue: number;
};

export type PolicyLedger = {
  policy: { id: string; title: string; version: number; ackVersion: number; status: string; category: string | null };
  rows: LedgerRow[];
  summary: { total: number; acked: number; overdue: number; outOfDate: number; pending: number; rate: number };
  /** Every department name seen, for the Filter panel. */
  departments: string[];
  /** Every version acknowledged so far, for the Filter panel. */
  versions: number[];
};

export async function buildPolicyLedger(policyId: string, orgId: string, scopeUserIds: Set<string> | null = null): Promise<PolicyLedger | null> {
  const now = new Date();
  const policy = await prisma.policy.findFirst({
    where: { id: policyId, organizationId: orgId },
    select: {
      id: true, title: true, version: true, ackVersion: true, status: true, category: true,
      acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true, ipAddress: true, userAgent: true, attestation: true, contentHash: true } },
      assignments: { select: { id: true, userId: true, dueDate: true, mandatory: true } },
    },
  });
  if (!policy) return null;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null, ...(scopeUserIds ? { id: { in: Array.from(scopeUserIds) } } : {}) },
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true, department: { select: { name: true } } },
  });
  const activeIds = new Set(users.map((u) => u.id));

  const assigned = new Map<string, { id: string; dueDate: Date | null; mandatory: boolean }>();
  for (const a of policy.assignments) assigned.set(a.userId, { id: a.id, dueDate: a.dueDate, mandatory: a.mandatory });
  // Assigned to anyone at all: the audience is the assignees; otherwise, for
  // a PUBLISHED policy, everyone. A draft or archived policy that names
  // nobody has no audience (nobody has been asked), so the ledger answers
  // the empty row rather than one Pending row per person at the org.
  const anyAssignment = policy.assignments.length > 0;
  const expected = anyAssignment
    ? new Set(policy.assignments.map((a) => a.userId).filter((id) => activeIds.has(id)))
    : policy.status === "PUBLISHED" ? new Set(activeIds) : new Set<string>();

  const acksByUser = new Map<string, AckRecord[]>();
  for (const a of policy.acknowledgments) {
    if (!activeIds.has(a.userId)) continue;
    (acksByUser.get(a.userId) ?? acksByUser.set(a.userId, []).get(a.userId)!).push(a);
  }

  let acked = 0, overdue = 0, outOfDate = 0, pending = 0;
  const versions = new Set<number>();
  const rows: LedgerRow[] = users
    .filter((u) => expected.has(u.id))
    .map((u) => {
      const acks = acksByUser.get(u.id) ?? [];
      const summary = summarizeUserAcks(policy.ackVersion, acks);
      const a = assigned.get(u.id) ?? null;
      const due = a?.dueDate ?? null;
      const status = ackStatusFor(summary, due, now);
      const rec = summary.record;
      if (status === "acked") acked++;
      else if (status === "overdue") overdue++;
      else if (status === "out-of-date") outOfDate++;
      else pending++;
      const versionAcked = rec?.version ?? null;
      if (versionAcked !== null) versions.add(versionAcked);
      return {
        userId: u.id,
        assignmentId: a?.id ?? null,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email ?? null,
        avatar: u.avatar ?? null,
        department: u.department?.name || "Unassigned",
        required: !!a,
        mandatory: a?.mandatory ?? false,
        status,
        versionAcked,
        acknowledgedAt: rec?.acknowledgedAt ? new Date(rec.acknowledgedAt).toISOString() : null,
        ipAddress: rec?.ipAddress ?? null,
        userAgent: rec?.userAgent ?? null,
        attestation: rec?.attestation ?? null,
        contentHash: rec?.contentHash ?? null,
        dueDate: due ? new Date(due).toISOString() : null,
        daysOverdue: daysOverdue(due, now),
      };
    });

  const order: Record<AckStatus, number> = { overdue: 0, "out-of-date": 1, pending: 2, acked: 3 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || (b.daysOverdue - a.daysOverdue) || a.name.localeCompare(b.name));

  const total = rows.length;
  return {
    policy: { id: policy.id, title: policy.title, version: policy.version, ackVersion: policy.ackVersion, status: policy.status, category: policy.category },
    rows,
    summary: { total, acked, overdue, outOfDate, pending, rate: total > 0 ? Math.round((acked / total) * 100) : 0 },
    departments: Array.from(new Set(rows.map((r) => r.department))).sort(),
    versions: Array.from(versions).sort((a, b) => b - a),
  };
}
