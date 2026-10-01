// The people who hold a job title (User.roleId), with the Rule 1 facts the
// SOP step owner rule needs (src/lib/sop-step-owner.ts): removed or not,
// their status, and whether the row is an AI agent rather than a person. It
// lives in the engine's directory because the agent fact is read off the
// access mirror (effectiveIsAgent), which nothing outside src/lib/access/
// reads. Server only: prisma.

import { prisma } from "@/lib/prisma";
import { effectiveIsAgent } from "./org-role";

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

/** Every person (removed ones included, for the rule to drop) holding any of these job titles, by id order. */
export async function jobTitleHolders(organizationId: string, roleIds: string[]): Promise<JobTitleHolder[]> {
  const ids = [...new Set(roleIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { organizationId, roleId: { in: ids } },
    select: {
      id: true, firstName: true, lastName: true, email: true, roleId: true, status: true,
      accessLevel: true, deletedAt: true, presenceStatus: true, presenceUntil: true,
    },
    orderBy: { id: "asc" },
  });
  return rows
    .filter((r): r is typeof r & { roleId: string } => !!r.roleId)
    .map((r) => ({
      id: r.id,
      name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email,
      roleId: r.roleId,
      status: String(r.status),
      // The mirror, never the stored column (org-role.ts effectiveIsAgent).
      isAgent: effectiveIsAgent(r.accessLevel),
      deletedAt: r.deletedAt,
      presenceStatus: r.presenceStatus,
      presenceUntil: r.presenceUntil,
    }));
}
