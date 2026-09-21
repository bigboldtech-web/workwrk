// The Policy compliance dashboard's data (spec-process section 2
// `/policies/compliance`), shared by the JSON route and the CSV export so
// the figures on the page and in the file are the same rows. Server-only.
//
// Scope: `scopeUserIds` narrows the audience to the people the viewer may
// see (their chain); null means everyone. Filters: `q` matches a person's
// name and a policy title, `departmentId` one department, `policyId` one
// policy, `period` the acknowledgement window.

import { prisma } from "@/lib/prisma";
import { summarizeUserAcks, ackStatusFor, daysOverdue, type AckRecord } from "@/lib/policy-evidence";
import { matchesGap, matchesPerson, matchesPolicy, periodStart, type Period } from "@/lib/policy-compliance-view";

export interface PolicyComplianceQuery {
  q?: string | null;
  departmentId?: string | null;
  policyId?: string | null;
  period?: Period;
}

export type GapRow = { policyId: string; policyTitle: string; userId: string; userName: string; avatar: string | null; department: string; assignmentId: string | null; dueDate: string | null; daysOverdue: number; status: string; lastAckedVersion: number | null; assigned: boolean };
export type PersonRow = { userId: string; name: string; avatar: string | null; department: string; required: number; acked: number; pending: number; overdue: number; rate: number };
export type PolicyRow = { policyId: string; title: string; category: string | null; acked: number; total: number; overdue: number; rate: number };
export type DeptRow = { departmentId: string; name: string; people: number; total: number; acked: number; overdue: number; rate: number };

export interface PolicyComplianceData {
  overview: { totalPolicies: number; totalUsers: number; totalRequired: number; totalAcked: number; orgRate: number; pending: number; overdue: number; outOfDate: number };
  departmentCompliance: DeptRow[];
  policyCompliance: PolicyRow[];
  personCompliance: PersonRow[];
  pendingList: GapRow[];
  departments: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; title: string }>;
}

export async function buildPolicyCompliance(orgId: string, scopeUserIds: Set<string> | null, query: PolicyComplianceQuery = {}): Promise<PolicyComplianceData> {
  const now = new Date();
  const since = periodStart(query.period ?? "all", now);
  const q = (query.q ?? "").trim();

  const [policies, users] = await Promise.all([
    prisma.policy.findMany({
      where: { organizationId: orgId, status: "PUBLISHED", requiresAck: true, ...(query.policyId ? { id: query.policyId } : {}) },
      select: {
        id: true, title: true, category: true, ackVersion: true,
        acknowledgments: { select: { userId: true, version: true, acknowledgedAt: true } },
        assignments: { select: { id: true, userId: true, dueDate: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, deletedAt: null, ...(scopeUserIds ? { id: { in: Array.from(scopeUserIds) } } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}) },
      select: { id: true, firstName: true, lastName: true, avatar: true, department: { select: { id: true, name: true } } },
    }),
  ]);

  const activeIds = new Set(users.map((u) => u.id));
  const userById = new Map(users.map((u) => [u.id, u]));
  const deptMap = new Map<string, DeptRow & { peopleSet: Set<string> }>();
  const personMap = new Map<string, PersonRow>();
  const gaps: GapRow[] = [];
  let totalRequired = 0, totalAcked = 0, overdue = 0, outOfDate = 0;

  const policyRows: PolicyRow[] = [];
  for (const p of policies) {
    if (q && !matchesPolicy({ title: p.title, category: p.category }, q) && !users.some((u) => matchesPerson({ name: `${u.firstName} ${u.lastName}`, department: u.department?.name ?? "" }, q))) continue;
    const assigned = new Map<string, { id: string; dueDate: Date | null }>();
    for (const a of p.assignments) if (activeIds.has(a.userId)) assigned.set(a.userId, { id: a.id, dueDate: a.dueDate });
    const anyAssignment = p.assignments.length > 0;
    const expected = anyAssignment ? new Set(assigned.keys()) : new Set(activeIds);

    const acksByUser = new Map<string, AckRecord[]>();
    for (const a of p.acknowledgments) {
      if (!activeIds.has(a.userId)) continue;
      if (since && new Date(a.acknowledgedAt).getTime() < since.getTime()) continue;
      (acksByUser.get(a.userId) ?? acksByUser.set(a.userId, []).get(a.userId)!).push(a);
    }

    let acked = 0, pOverdue = 0;
    for (const uid of expected) {
      const u = userById.get(uid);
      if (!u) continue;
      const name = `${u.firstName} ${u.lastName}`;
      const dName = u.department?.name || "Unassigned";
      const summary = summarizeUserAcks(p.ackVersion, acksByUser.get(uid) ?? []);
      const a = assigned.get(uid) ?? null;
      const due = a?.dueDate ?? null;
      const status = ackStatusFor(summary, due, now);
      const rowMatches = !q || matchesGap({ policyTitle: p.title, userName: name, department: dName }, q);
      if (!rowMatches) continue;

      const dId = u.department?.id || "unassigned";
      const d = deptMap.get(dId) ?? { departmentId: dId, name: dName, people: 0, total: 0, acked: 0, overdue: 0, rate: 0, peopleSet: new Set<string>() };
      d.peopleSet.add(uid);
      d.total++;
      deptMap.set(dId, d);
      const person = personMap.get(uid) ?? { userId: uid, name, avatar: u.avatar ?? null, department: dName, required: 0, acked: 0, pending: 0, overdue: 0, rate: 0 };
      person.required++;
      personMap.set(uid, person);
      totalRequired++;

      if (status === "acked") { acked++; totalAcked++; d.acked++; person.acked++; }
      else {
        person.pending++;
        if (status === "overdue") { overdue++; pOverdue++; d.overdue++; person.overdue++; }
        if (summary.hasOlderAck) outOfDate++;
        gaps.push({
          policyId: p.id, policyTitle: p.title, userId: uid, userName: name, avatar: u.avatar ?? null, department: dName,
          assignmentId: a?.id ?? null, dueDate: due ? due.toISOString() : null, daysOverdue: daysOverdue(due, now), status,
          lastAckedVersion: summary.record?.version ?? null, assigned: !!a,
        });
      }
    }
    const total = Array.from(expected).filter((uid) => userById.has(uid) && (!q || matchesGap({ policyTitle: p.title, userName: `${userById.get(uid)!.firstName} ${userById.get(uid)!.lastName}`, department: userById.get(uid)!.department?.name ?? "" }, q))).length;
    policyRows.push({ policyId: p.id, title: p.title, category: p.category, acked, total, overdue: pOverdue, rate: total > 0 ? Math.round((acked / total) * 100) : 0 });
  }

  const departmentCompliance: DeptRow[] = Array.from(deptMap.values())
    .map(({ peopleSet, ...d }) => ({ ...d, people: peopleSet.size, rate: d.total > 0 ? Math.round((d.acked / d.total) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate);
  const personCompliance = Array.from(personMap.values())
    .map((p) => ({ ...p, rate: p.required > 0 ? Math.round((p.acked / p.required) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
  const order: Record<string, number> = { overdue: 0, "out-of-date": 1, pending: 2 };
  gaps.sort((a, b) => (order[a.status] - order[b.status]) || (b.daysOverdue - a.daysOverdue));

  const orgRate = totalRequired > 0 ? Math.round((totalAcked / totalRequired) * 100) : 0;
  const allDepts = await prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  return {
    overview: { totalPolicies: policyRows.length, totalUsers: users.length, totalRequired, totalAcked, orgRate, pending: gaps.length, overdue, outOfDate },
    departmentCompliance,
    policyCompliance: policyRows.sort((a, b) => a.rate - b.rate),
    personCompliance,
    pendingList: gaps,
    departments: allDepts,
    policies: policies.map((p) => ({ id: p.id, title: p.title })),
  };
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
