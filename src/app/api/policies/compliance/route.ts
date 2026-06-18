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
      select: {
        id: true, title: true, category: true,
        acknowledgments: { select: { userId: true } },
        assignments: { select: { userId: true } },
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

  // For each policy: the EXPECTED audience — its assignees if it's been
  // assigned to anyone, otherwise all active users — and who acked. Compliance
  // is acked-vs-expected, so assigning narrows the obligation to the right people.
  const expectedByPolicy = new Map<string, Set<string>>();
  const ackByPolicy = new Map<string, Set<string>>();
  for (const p of policies) {
    const assigned = new Set(p.assignments.map((a) => a.userId).filter((uid) => activeIds.has(uid)));
    expectedByPolicy.set(p.id, assigned.size > 0 ? assigned : new Set(activeIds));
    ackByPolicy.set(p.id, new Set(p.acknowledgments.map((a) => a.userId).filter((uid) => activeIds.has(uid))));
  }

  let totalRequired = 0;
  let totalAcked = 0;
  for (const p of policies) {
    const exp = expectedByPolicy.get(p.id)!;
    const ack = ackByPolicy.get(p.id)!;
    totalRequired += exp.size;
    for (const uid of exp) if (ack.has(uid)) totalAcked++;
  }
  const orgRate = totalRequired > 0 ? Math.round((totalAcked / totalRequired) * 100) : 0;

  const policyCompliance = policies
    .map((p) => {
      const exp = expectedByPolicy.get(p.id)!;
      const ack = ackByPolicy.get(p.id)!;
      let acked = 0;
      for (const uid of exp) if (ack.has(uid)) acked++;
      return { policyId: p.id, title: p.title, category: p.category, acked, total: exp.size, rate: exp.size > 0 ? Math.round((acked / exp.size) * 100) : 0 };
    })
    .sort((a, b) => a.rate - b.rate);

  // Per-department + per-person + pending, iterating each policy's expected set.
  const deptMap = new Map<string, { name: string; total: number; acked: number }>();
  const personMap = new Map<string, { total: number; acked: number }>();
  const pending: { policyId: string; policyTitle: string; userId: string; userName: string; department: string }[] = [];
  for (const p of policies) {
    const exp = expectedByPolicy.get(p.id)!;
    const ack = ackByPolicy.get(p.id)!;
    for (const uid of exp) {
      const u = userById.get(uid);
      if (!u) continue;
      const dId = u.department?.id || "unassigned";
      const dName = u.department?.name || "Unassigned";
      if (!deptMap.has(dId)) deptMap.set(dId, { name: dName, total: 0, acked: 0 });
      if (!personMap.has(uid)) personMap.set(uid, { total: 0, acked: 0 });
      const d = deptMap.get(dId)!;
      const pm = personMap.get(uid)!;
      d.total++; pm.total++;
      if (ack.has(uid)) { d.acked++; pm.acked++; }
      else pending.push({ policyId: p.id, policyTitle: p.title, userId: uid, userName: `${u.firstName} ${u.lastName}`, department: dName });
    }
  }

  const departmentCompliance = [...deptMap.entries()]
    .map(([id, d]) => ({ departmentId: id, name: d.name, total: d.total, acked: d.acked, rate: d.total > 0 ? Math.round((d.acked / d.total) * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate);

  const personScores = [...personMap.entries()]
    .map(([uid, pm]) => {
      const u = userById.get(uid)!;
      return { userId: uid, name: `${u.firstName} ${u.lastName}`, department: u.department?.name || "—", total: pm.total, acked: pm.acked, rate: pm.total > 0 ? Math.round((pm.acked / pm.total) * 100) : 0 };
    })
    .sort((a, b) => b.rate - a.rate);

  return jsonSuccess({
    overview: { totalPolicies, totalUsers, totalRequired, totalAcked, orgRate, pending: pending.length },
    policyCompliance,
    departmentCompliance,
    personScores,
    pendingList: pending.slice(0, 100),
  });
}
