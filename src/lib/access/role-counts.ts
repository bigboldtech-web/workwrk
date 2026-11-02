// The four-role strip's live counts (settings-architecture 5.6, Members'
// count strip): Owners, Admins, Members, Guests and the People team, over
// the step-0 mapping (org-role.ts spec 2.1, ownerIdsOf for Owners). Live
// people only (not deleted, not deactivated). Server-only (prisma).
//
// Everyone who belongs here (docs/plans/workspace-status.md D11, D12): the
// people anchored here, and the people who work here through a membership,
// at the role that membership holds, while their seat here is live and their
// account is not ended. The Owners and Admins are membership.ts
// liveAdminsOf's, the set the last-Owner guard counts; the Overview's member
// count is liveMembersHere, the same people.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { ownerIdsOf } from "@/lib/admin/companies-list";
import { parseAccessSettings } from "./settings";
import { liveAdminsOf } from "./membership";
import { liveSeatWhere } from "./workspace-seat";

/** A membership here that counts as a live person here (D12): the seat live, the account anchored elsewhere and not ended (and `user`, any more about it). */
function liveMembershipHere(organizationId: string, user: Prisma.UserWhereInput = {}): Prisma.OrganizationMembershipWhereInput {
  return { organizationId, ...liveSeatWhere(), user: { ...user, organizationId: { not: organizationId }, deletedAt: null, status: { not: "INACTIVE" } } };
}

/** How many live people belong here: anchored here, and through a membership here (the Overview's member count). */
export async function liveMembersHere(organizationId: string): Promise<number> {
  const [anchored, members] = await Promise.all([
    prisma.user.count({ where: { organizationId, deletedAt: null, status: { not: "INACTIVE" } } }),
    prisma.organizationMembership.count({ where: liveMembershipHere(organizationId) }),
  ]);
  return anchored + members;
}

export interface RoleCounts {
  owners: number;
  admins: number;
  members: number;
  guests: number;
  peopleTeam: number;
}

export async function roleCountsFor(organizationId: string): Promise<RoleCounts> {
  const live = { organizationId, deletedAt: null, status: { not: "INACTIVE" as const } };
  const [admins, total, hr, hrMembers, org] = await Promise.all([
    liveAdminsOf(prisma, organizationId),
    liveMembersHere(organizationId),
    prisma.user.findMany({ where: { ...live, accessLevel: "HR" }, select: { id: true } }),
    prisma.organizationMembership.findMany({ where: { ...liveMembershipHere(organizationId), role: "HR" }, select: { userId: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
  ]);
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  const configured = parseAccessSettings((org?.settings as { access?: unknown } | null)?.access).peopleTeamUserIds;
  // The People team is the configured list when there is one, else everyone
  // at HR (access step 0: "People team = users at HR until toggle 6 exists"),
  // a membership at HR here included.
  const peopleTeam = new Set(configured.length > 0 ? configured : [...hr.map((h) => h.id), ...hrMembers.map((h) => h.userId)]);
  return {
    owners: owners.length,
    admins: admins.length - owners.length,
    members: total - admins.length,
    guests: 0,
    peopleTeam: peopleTeam.size,
  };
}

/**
 * "N of M admins enrolled" on Security > Sign-in policy, and whether the
 * viewer is. Over the same people as the counts above (D11, D12): anchored
 * here and live, and through a membership whose seat here is live, each at
 * the level held here (membership.ts liveAdminsOf for the admins). Two step
 * verification is the account's, whichever workspace asks. Before, only the
 * people anchored here were counted, so an Admin here through a membership
 * with no second factor was never among the ones the rule waits for.
 */
export async function adminEnrolment(organizationId: string, viewerId: string): Promise<{ admins: number; enrolled: number; everyone: number; everyoneEnrolled: number; viewerEnrolled: boolean }> {
  const live = { organizationId, deletedAt: null, status: { not: "INACTIVE" as const } };
  const [adminRows, everyone, anchoredEnrolled, membersEnrolled, me] = await Promise.all([
    liveAdminsOf(prisma, organizationId),
    liveMembersHere(organizationId),
    prisma.user.count({ where: { ...live, mfaEnabled: true } }),
    prisma.organizationMembership.count({ where: liveMembershipHere(organizationId, { mfaEnabled: true }) }),
    prisma.user.findUnique({ where: { id: viewerId }, select: { mfaEnabled: true } }),
  ]);
  const adminIds = adminRows.map((a) => a.id);
  const enrolled = adminIds.length ? await prisma.user.count({ where: { id: { in: adminIds }, mfaEnabled: true } }) : 0;
  return { admins: adminIds.length, enrolled, everyone, everyoneEnrolled: anchoredEnrolled + membersEnrolled, viewerEnrolled: !!me?.mfaEnabled };
}
