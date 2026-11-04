// The people who hold a job title HERE, with the Rule 1 facts the SOP step
// owner rule needs (src/lib/sop-step-owner.ts): removed or not, their
// status, and whether the row is an AI agent rather than a person. It lives
// in the engine's directory because the agent fact is read off the access
// mirror (effectiveIsAgent), which nothing outside src/lib/access/ reads.
// Server only: prisma.
//
// A holder is read at their seat here (docs/plans/workspace-status-2.md E15,
// step 8): someone anchored here by their account's job title, someone here
// through a membership by the job title that membership holds, each with
// that seat's status, removal and level (the level held here decides the
// Agent fact), two indexed halves. Before, the people anchored here only, so
// a step owned by B's Designer title never went to Pat, a Designer on her B
// membership. A task is work given here (as step 6 assigns a task to her),
// never a KRA or an SOP assignment, which stay with the people anchored here
// (the step 5 review M1).

import { prisma } from "@/lib/prisma";
import { effectiveIsAgent } from "./org-role";
import { anchoredHereWhere, membershipHereWhere } from "./seated-here";
import { ENDED_STATUS } from "./workspace-seat";

export interface JobTitleHolder {
  id: string;
  name: string;
  roleId: string;
  status: string;
  isAgent: boolean;
  deletedAt: Date | null;
  presenceStatus: string | null;
  presenceUntil: Date | null;
}

const PERSON = { id: true, firstName: true, lastName: true, email: true, status: true, deletedAt: true, presenceStatus: true, presenceUntil: true } as const;

const nameOf = (r: { firstName: string | null; lastName: string | null; email: string }) => `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email;

/** Every person (removed ones included, for the rule to drop) holding any of these job titles here, by id order. */
export async function jobTitleHolders(organizationId: string, roleIds: string[]): Promise<JobTitleHolder[]> {
  const ids = [...new Set(roleIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({
      where: { ...anchoredHereWhere(organizationId, "any"), roleId: { in: ids } },
      select: { ...PERSON, roleId: true, accessLevel: true },
      orderBy: { id: "asc" },
    }),
    prisma.organizationMembership.findMany({
      where: { ...membershipHereWhere(organizationId, "any"), roleId: { in: ids } },
      select: { roleId: true, role: true, status: true, removedAt: true, user: { select: PERSON } },
      orderBy: { userId: "asc" },
    }),
  ]);
  const out: JobTitleHolder[] = [];
  for (const r of anchored) {
    if (!r.roleId) continue;
    out.push({
      id: r.id,
      name: nameOf(r),
      roleId: r.roleId,
      status: String(r.status),
      // The mirror, never the stored column (org-role.ts effectiveIsAgent).
      isAgent: effectiveIsAgent(r.accessLevel),
      deletedAt: r.deletedAt,
      presenceStatus: r.presenceStatus,
      presenceUntil: r.presenceUntil,
    });
  }
  for (const m of members) {
    if (!m.roleId || !m.user) continue;
    // The seat here decides: its status (an account ended where it is
    // anchored ends this seat too, D12) and its removal, and the level the
    // membership holds here for the Agent fact. Presence is the account's.
    const ended = m.user.deletedAt != null || String(m.user.status) === ENDED_STATUS;
    out.push({
      id: m.user.id,
      name: nameOf(m.user),
      roleId: m.roleId,
      status: ended ? ENDED_STATUS : String(m.status),
      isAgent: effectiveIsAgent(m.role),
      deletedAt: m.removedAt ?? m.user.deletedAt,
      presenceStatus: m.user.presenceStatus,
      presenceUntil: m.user.presenceUntil,
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
