// The people half of the Apps page's "N people lose access" preview: every
// live person of the workspace with the facts keepsApp reads. Server-only.

import { prisma } from "@/lib/prisma";
import { loadOrgFacts } from "./facts";
import { orgRoleOf } from "./org-role";
import { tiersOfLevel } from "./viewer-tiers";
import type { ImpactPerson } from "./app-floor-impact";

export async function loadImpactPeople(organizationId: string): Promise<ImpactPerson[]> {
  const [users, org, dotted] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, managerId: true },
      take: 20000,
    }),
    loadOrgFacts(organizationId),
    prisma.userDottedLine.findMany({ where: { user: { organizationId, deletedAt: null } }, select: { managerId: true } }),
  ]);
  const managers = new Set<string>();
  for (const u of users) if (u.managerId) managers.add(u.managerId);
  for (const d of dotted) managers.add(d.managerId);
  const peopleTeam = new Set(org.peopleTeamIds);
  return users.map((u) => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Someone",
    orgRole: orgRoleOf({ accessLevel: u.accessLevel }),
    peopleTeam: peopleTeam.has(u.id),
    hasReports: managers.has(u.id),
    tiers: tiersOfLevel(u.accessLevel),
  }));
}
