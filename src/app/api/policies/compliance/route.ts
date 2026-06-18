import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess, isManager } from "@/lib/api-helpers";

// GET: Policy compliance (acknowledgement adoption) dashboard data.
// Ack-based analogue of /api/sop-assignments/compliance: every PUBLISHED
// policy that requiresAck should be acknowledged by every active org user.
export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);

  const [policies, users] = await Promise.all([
    prisma.policy.findMany({
      where: { organizationId: orgId, status: "PUBLISHED", requiresAck: true },
      select: { id: true, title: true, category: true, acknowledgments: { select: { userId: true } } },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } },
    }),
  ]);

  const userIds = new Set(users.map((u) => u.id));
  const totalUsers = users.length;
  const totalPolicies = policies.length;
  const totalRequired = totalPolicies * totalUsers;

  // policyId -> Set of active-user ids who acked
  const ackByPolicy = new Map<string, Set<string>>();
  let totalAcked = 0;
  for (const p of policies) {
    const set = new Set(p.acknowledgments.map((a) => a.userId).filter((uid) => userIds.has(uid)));
    ackByPolicy.set(p.id, set);
    totalAcked += set.size;
  }
  const orgRate = totalRequired > 0 ? Math.round((totalAcked / totalRequired) * 100) : 0;

  // Per-policy adoption (lowest first).
  const policyCompliance = policies
    .map((p) => {
      const acked = ackByPolicy.get(p.id)!.size;
      return { policyId: p.id, title: p.title, category: p.category, acked, total: totalUsers, rate: totalUsers > 0 ? Math.round((acked / totalUsers) * 100) : 0 };
    })
    .sort((a, b) => a.rate - b.rate);

  // Per-department adoption (required = users × policies).
  const deptMap = new Map<string, { name: string; total: number; acked: number }>();
  for (const u of users) {
    const dId = u.department?.id || "unassigned";
    const dName = u.department?.name || "Unassigned";
    if (!deptMap.has(dId)) deptMap.set(dId, { name: dName, total: 0, acked: 0 });
    const d = deptMap.get(dId)!;
    d.total += totalPolicies;
    for (const p of policies) if (ackByPolicy.get(p.id)!.has(u.id)) d.acked++;
  }
  const departmentCompliance = [...deptMap.entries()]
    .map(([id, d]) => ({ departmentId: id, name: d.name, total: d.total, acked: d.acked, rate: d.total > 0 ? Math.round((d.acked / d.total) * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate);

  // Per-person ack rate.
  const personScores = users
    .map((u) => {
      let acked = 0;
      for (const p of policies) if (ackByPolicy.get(p.id)!.has(u.id)) acked++;
      return { userId: u.id, name: `${u.firstName} ${u.lastName}`, department: u.department?.name || "—", total: totalPolicies, acked, rate: totalPolicies > 0 ? Math.round((acked / totalPolicies) * 100) : 0 };
    })
    .sort((a, b) => b.rate - a.rate);

  // Flat "not yet acknowledged" list (capped).
  const pending: { policyId: string; policyTitle: string; userId: string; userName: string; department: string }[] = [];
  for (const p of policies) {
    const set = ackByPolicy.get(p.id)!;
    for (const u of users) {
      if (!set.has(u.id)) pending.push({ policyId: p.id, policyTitle: p.title, userId: u.id, userName: `${u.firstName} ${u.lastName}`, department: u.department?.name || "—" });
    }
  }

  return jsonSuccess({
    overview: { totalPolicies, totalUsers, totalRequired, totalAcked, orgRate, pending: pending.length },
    policyCompliance,
    departmentCompliance,
    personScores,
    pendingList: pending.slice(0, 100),
  });
}
