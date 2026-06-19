import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";
import { summarizeUserAcks, ackStatusFor, daysOverdue, type AckRecord } from "@/lib/policy-evidence";

// GET: Policy compliance dashboard — acknowledgement evidence, version-aware.
// "Acked" means acked the CURRENT required version (ack.version >= ackVersion).
// Surfaces compliance RISK (overdue, out-of-date re-acks, gaps), not a leaderboard.
export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const now = new Date();

  const [policies, users] = await Promise.all([
    prisma.policy.findMany({
      where: { organizationId: orgId, status: "PUBLISHED", requiresAck: true },
      select: {
        id: true, title: true, category: true, ackVersion: true,
        acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true } },
        assignments: { select: { userId: true, dueDate: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
    }),
  ]);

  const activeIds = new Set(users.map((u) => u.id));
  const userById = new Map(users.map((u) => [u.id, u]));
  const totalUsers = users.length;
  const totalPolicies = policies.length;

  // Expected audience per policy: its assignees if assigned to anyone, else all
  // active users. Assigning narrows the obligation to the right people.
  type Row = { policyId: string; policyTitle: string; userId: string; userName: string; department: string; dueDate: Date | null; daysOverdue: number; status: string; lastAckedVersion: number | null; assigned: boolean };
  const gaps: Row[] = [];
  const deptMap = new Map<string, { name: string; total: number; acked: number }>();
  let totalRequired = 0, totalAcked = 0, overdue = 0, outOfDate = 0;

  const policyCompliance = policies.map((p) => {
    const assignedDue = new Map<string, Date | null>();
    for (const a of p.assignments) if (activeIds.has(a.userId)) assignedDue.set(a.userId, a.dueDate);
    const expected = assignedDue.size > 0 ? new Set(assignedDue.keys()) : new Set(activeIds);

    const acksByUser = new Map<string, AckRecord[]>();
    for (const a of p.acknowledgments) {
      if (!activeIds.has(a.userId)) continue;
      (acksByUser.get(a.userId) ?? acksByUser.set(a.userId, []).get(a.userId)!).push(a);
    }

    let acked = 0;
    for (const uid of expected) {
      const u = userById.get(uid);
      if (!u) continue;
      const summary = summarizeUserAcks(p.ackVersion, acksByUser.get(uid) ?? []);
      const due = assignedDue.get(uid) ?? null;
      const status = ackStatusFor(summary, due, now);

      const dId = u.department?.id || "unassigned";
      const dName = u.department?.name || "Unassigned";
      if (!deptMap.has(dId)) deptMap.set(dId, { name: dName, total: 0, acked: 0 });
      const d = deptMap.get(dId)!;
      d.total++;
      totalRequired++;

      if (status === "acked") { acked++; totalAcked++; d.acked++; }
      else {
        if (status === "overdue") overdue++;
        if (summary.hasOlderAck) outOfDate++;
        gaps.push({
          policyId: p.id, policyTitle: p.title, userId: uid, userName: `${u.firstName} ${u.lastName}`,
          department: dName, dueDate: due, daysOverdue: daysOverdue(due, now), status,
          lastAckedVersion: summary.record?.version ?? null, assigned: assignedDue.has(uid),
        });
      }
    }
    return { policyId: p.id, title: p.title, category: p.category, acked, total: expected.size, rate: expected.size > 0 ? Math.round((acked / expected.size) * 100) : 0 };
  }).sort((a, b) => a.rate - b.rate);

  const orgRate = totalRequired > 0 ? Math.round((totalAcked / totalRequired) * 100) : 0;

  const departmentCompliance = [...deptMap.entries()]
    .map(([id, d]) => ({ departmentId: id, name: d.name, total: d.total, acked: d.acked, rate: d.total > 0 ? Math.round((d.acked / d.total) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate);

  // Open gaps: overdue first (by how overdue), then out-of-date, then pending.
  const order = { overdue: 0, "out-of-date": 1, pending: 2 } as Record<string, number>;
  gaps.sort((a, b) => (order[a.status] - order[b.status]) || (b.daysOverdue - a.daysOverdue));

  return jsonSuccess({
    overview: { totalPolicies, totalUsers, totalRequired, totalAcked, orgRate, pending: gaps.length, overdue, outOfDate },
    policyCompliance,
    departmentCompliance,
    pendingList: gaps.slice(0, 100),
  });
}
