// What the personal door (My settings) needs to know about the signed-in
// person's own place in the workspace, answered inside src/lib/access so no
// page or route reads a level itself (the G7 lint rule).
//
//   orgRole     the four-role word for the Profile card and the policy
//               checks (Owner, Admin, Member, Guest; labels.ts renders it)
//   isAgent     the Agent flag on a Member
//   isLastAdmin true when this person is the only active Owner or Admin
//               left in ANY workspace they belong to (soleAdminWorkspaces). Delete my account refuses that case
//               (spec-account-auth "Delete my account": the last Owner is a
//               refusal with its own copy), because a workspace with nobody
//               who can reach Members is one nobody can repair.
//
// Server only (prisma).

import { prisma } from "@/lib/prisma";
import { LEGACY_ADMIN_LEVELS } from "./legacy-levels";
import { isAgentOf, orgRoleOf } from "./org-role";
import type { OrgRole } from "./types";
import { levelHeldIn } from "./acting-workspace";

export interface SelfAccountFacts {
  orgRole: OrgRole;
  isAgent: boolean;
  isLastAdmin: boolean;
}

/** Pure: the last-admin rule over the counts (tested). */
export function isLastAdminOf(selfIsAdmin: boolean, otherActiveAdmins: number): boolean {
  return selfIsAdmin && otherActiveAdmins <= 0;
}

type Db = Pick<typeof prisma, "user" | "organizationMembership">;
const ADMIN_LEVELS = [...LEGACY_ADMIN_LEVELS] as ("SUPER_ADMIN" | "COMPANY_ADMIN")[];

/**
 * Every workspace where this person is an Owner or Admin and nobody else
 * active is. Deleting the account anonymises the ONE User row, so it leaves
 * every workspace at once: the check covers the anchored workspace AND every
 * OrganizationMembership the person holds, and it counts another admin of a
 * workspace whether that admin is anchored there (User.accessLevel) or holds
 * it as a membership (OrganizationMembership.role), so an admin anchored
 * elsewhere is never missed (no false refusal) and a sole admin of a second
 * workspace is never missed either (no orphaned workspace).
 *
 * Pass the transaction client to re-check under the delete's lock.
 */
export async function soleAdminWorkspaces(userId: string, db: Db = prisma): Promise<string[]> {
  const [me, memberships] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { accessLevel: true, organizationId: true } }),
    db.organizationMembership.findMany({ where: { userId }, select: { organizationId: true, role: true } }),
  ]);
  if (!me) return [];
  const adminOf = new Set<string>();
  if (me.accessLevel && LEGACY_ADMIN_LEVELS.has(me.accessLevel)) adminOf.add(me.organizationId);
  for (const m of memberships) {
    // The anchored workspace's level is the one that holds there (reanchorUser
    // keeps the membership row in step); a stale membership row does not
    // override it.
    if (m.organizationId === me.organizationId) continue;
    if (LEGACY_ADMIN_LEVELS.has(m.role)) adminOf.add(m.organizationId);
  }
  const sole: string[] = [];
  for (const orgId of adminOf) {
    const active = { deletedAt: null, status: { not: "INACTIVE" as const } };
    const [anchored, viaMembership] = await Promise.all([
      db.user.count({ where: { organizationId: orgId, id: { not: userId }, ...active, accessLevel: { in: ADMIN_LEVELS } } }),
      db.organizationMembership.count({
        where: {
          organizationId: orgId,
          userId: { not: userId },
          role: { in: ADMIN_LEVELS },
          // Anchored there, the User row already answered (and may have
          // been demoted since); anchored elsewhere, the membership holds.
          user: { ...active, organizationId: { not: orgId } },
        },
      }),
    ]);
    if (isLastAdminOf(true, anchored + viaMembership)) sole.push(orgId);
  }
  return sole.sort();
}

export async function selfAccountFacts(userId: string, organizationId: string): Promise<SelfAccountFacts | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { accessLevel: true, organizationId: true } });
  if (!me) return null;
  // The level held in the workspace asked about, never the anchored one's there.
  const level = await levelHeldIn(userId, organizationId, me);
  const sole = await soleAdminWorkspaces(userId);
  return {
    orgRole: orgRoleOf({ accessLevel: level }),
    isAgent: isAgentOf(level),
    isLastAdmin: sole.length > 0,
  };
}
