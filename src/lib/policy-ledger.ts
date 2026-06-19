// Builds a policy's audit ledger — one row per expected person with their
// acknowledgement evidence. Shared by the ledger API + the CSV export so both
// produce identical records.

import { prisma } from "@/lib/prisma";
import { summarizeUserAcks, ackStatusFor, daysOverdue, type AckRecord, type AckStatus } from "@/lib/policy-evidence";

export type LedgerRow = {
  userId: string;
  name: string;
  email: string | null;
  department: string;
  required: boolean; // assigned (true) vs org-wide expectation (false)
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
};

export async function buildPolicyLedger(policyId: string, orgId: string): Promise<PolicyLedger | null> {
  const now = new Date();
  const policy = await prisma.policy.findFirst({
    where: { id: policyId, organizationId: orgId },
    select: {
      id: true, title: true, version: true, ackVersion: true, status: true, category: true,
      acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true, ipAddress: true, userAgent: true, attestation: true, contentHash: true } },
      assignments: { select: { userId: true, dueDate: true } },
    },
  });
  if (!policy) return null;

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, department: { select: { name: true } } },
  });
  const activeIds = new Set(users.map((u) => u.id));

  const assignedDue = new Map<string, Date | null>();
  for (const a of policy.assignments) if (activeIds.has(a.userId)) assignedDue.set(a.userId, a.dueDate);
  const expected = assignedDue.size > 0 ? new Set(assignedDue.keys()) : new Set(activeIds);

  const acksByUser = new Map<string, AckRecord[]>();
  for (const a of policy.acknowledgments) {
    if (!activeIds.has(a.userId)) continue;
    (acksByUser.get(a.userId) ?? acksByUser.set(a.userId, []).get(a.userId)!).push(a);
  }

  let acked = 0, overdue = 0, outOfDate = 0, pending = 0;
  const rows: LedgerRow[] = users
    .filter((u) => expected.has(u.id))
    .map((u) => {
      const acks = acksByUser.get(u.id) ?? [];
      const summary = summarizeUserAcks(policy.ackVersion, acks);
      const due = assignedDue.get(u.id) ?? null;
      const status = ackStatusFor(summary, due, now);
      const rec = summary.record;
      if (status === "acked") acked++;
      else if (status === "overdue") overdue++;
      else if (status === "out-of-date") outOfDate++;
      else pending++;
      return {
        userId: u.id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email ?? null,
        department: u.department?.name || "Unassigned",
        required: assignedDue.has(u.id),
        status,
        versionAcked: summary.ackedCurrent ? (rec?.version ?? null) : (summary.hasOlderAck ? (rec?.version ?? null) : null),
        acknowledgedAt: rec?.acknowledgedAt ? new Date(rec.acknowledgedAt).toISOString() : null,
        ipAddress: rec?.ipAddress ?? null,
        userAgent: rec?.userAgent ?? null,
        attestation: rec?.attestation ?? null,
        contentHash: rec?.contentHash ?? null,
        dueDate: due ? new Date(due).toISOString() : null,
        daysOverdue: daysOverdue(due, now),
      };
    });

  // Sort: open items first (overdue, out-of-date, pending), acked last.
  const order: Record<AckStatus, number> = { overdue: 0, "out-of-date": 1, pending: 2, acked: 3 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || (b.daysOverdue - a.daysOverdue) || a.name.localeCompare(b.name));

  const total = rows.length;
  return {
    policy: { id: policy.id, title: policy.title, version: policy.version, ackVersion: policy.ackVersion, status: policy.status, category: policy.category },
    rows,
    summary: { total, acked, overdue, outOfDate, pending, rate: total > 0 ? Math.round((acked / total) * 100) : 0 },
  };
}
