// The policies a person still has to acknowledge, by the ONE rule the /policies
// page's "Needs my acknowledgement" view uses (lib/policies-list needsMyAck):
// published, requires acknowledgement, the viewer is in the audience (named
// assignee, or everyone when the policy names nobody), not acknowledged at
// the current ackVersion. The sidebar badge (boot counts.policiesToAck) and
// the Today card read this, so the badge, the pill and the list agree.
//
// The old badge counted open PolicyAssignment rows, which disagreed with the
// pill in both directions: it missed everyone-audience policies (no
// assignment row) and it kept counting an assignment that was created after
// the person had already acknowledged (the row stayed ASSIGNED for ever).
//
// Server-only: prisma.

import { prisma } from "@/lib/prisma";
import { needsMyAck, type PolicyStatus } from "@/lib/policies-list";

export interface PolicyToAck {
  policyId: string;
  title: string;
  assignmentId: string | null;
  mandatory: boolean;
  dueDate: Date | null;
  status: string;
}

export async function listPoliciesToAck(userId: string, orgId: string): Promise<PolicyToAck[]> {
  const rows = await prisma.policy.findMany({
    where: { organizationId: orgId, status: "PUBLISHED", requiresAck: true },
    select: {
      id: true, title: true, ackVersion: true, status: true, requiresAck: true,
      acknowledgments: { where: { userId }, select: { version: true } },
      assignments: { where: { userId }, select: { id: true, status: true, mandatory: true, dueDate: true } },
      _count: { select: { assignments: true } },
    },
  });
  const out: PolicyToAck[] = [];
  for (const p of rows) {
    const mine = p.assignments[0] ?? null;
    const acknowledged = p.acknowledgments.some((a) => (a.version ?? 0) >= p.ackVersion);
    const facts = { requiresAck: p.requiresAck, status: p.status as PolicyStatus, assigned: !!mine, acknowledged, hasAudience: p._count.assignments > 0 };
    if (!needsMyAck(facts)) continue;
    out.push({ policyId: p.id, title: p.title, assignmentId: mine?.id ?? null, mandatory: mine?.mandatory ?? true, dueDate: mine?.dueDate ?? null, status: mine?.status ?? "ASSIGNED" });
  }
  out.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  return out;
}

export async function countPoliciesToAck(userId: string, orgId: string): Promise<number> {
  return (await listPoliciesToAck(userId, orgId)).length;
}
