// The four-role strip's live counts (settings-architecture 5.6, Members'
// count strip): Owners, Admins, Members, Guests and the People team, over
// the step-0 mapping (org-role.ts spec 2.1, ownerIdsOf for Owners). Live
// people only (not deleted, not deactivated). Server-only (prisma).

import { prisma } from "@/lib/prisma";
import { ownerIdsOf } from "@/lib/admin/companies-list";
import { parseAccessSettings } from "./settings";

export interface RoleCounts {
  owners: number;
  admins: number;
  members: number;
  guests: number;
  peopleTeam: number;
}

export async function roleCountsFor(organizationId: string): Promise<RoleCounts> {
  const live = { organizationId, deletedAt: null, status: { not: "INACTIVE" as const } };
  const [admins, total, hr, org] = await Promise.all([
    prisma.user.findMany({ where: { ...live, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } }, select: { id: true, accessLevel: true, createdAt: true } }),
    prisma.user.count({ where: live }),
    prisma.user.findMany({ where: { ...live, accessLevel: "HR" }, select: { id: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
  ]);
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  const configured = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access).peopleTeamUserIds;
  // The People team is the configured list when there is one, else everyone
  // at HR (access step 0: "People team = users at HR until toggle 6 exists").
  const peopleTeam = new Set(configured.length > 0 ? configured : hr.map((h) => h.id));
  return {
    owners: owners.length,
    admins: admins.length - owners.length,
    members: total - admins.length,
    guests: 0,
    peopleTeam: peopleTeam.size,
  };
}

/** "N of M admins enrolled" on Security > Sign-in policy, and whether the viewer is. */
export async function adminEnrolment(organizationId: string, viewerId: string): Promise<{ admins: number; enrolled: number; everyone: number; everyoneEnrolled: number; viewerEnrolled: boolean }> {
  const live = { organizationId, deletedAt: null, status: { not: "INACTIVE" as const } };
  const [admins, enrolled, everyone, everyoneEnrolled, me] = await Promise.all([
    prisma.user.count({ where: { ...live, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } } }),
    prisma.user.count({ where: { ...live, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] }, mfaEnabled: true } }),
    prisma.user.count({ where: live }),
    prisma.user.count({ where: { ...live, mfaEnabled: true } }),
    prisma.user.findUnique({ where: { id: viewerId }, select: { mfaEnabled: true } }),
  ]);
  return { admins, enrolled, everyone, everyoneEnrolled, viewerEnrolled: !!me?.mfaEnabled };
}
