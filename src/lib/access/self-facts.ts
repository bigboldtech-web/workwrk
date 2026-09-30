// What the personal door (My settings) needs to know about the signed-in
// person's own place in the workspace, answered inside src/lib/access so no
// page or route reads a level itself (the G7 lint rule).
//
//   orgRole     the four-role word for the Profile card and the policy
//               checks (Owner, Admin, Member, Guest; labels.ts renders it)
//   isAgent     the Agent flag on a Member
//   isLastAdmin true when this person is the only active Owner or Admin
//               left in the workspace. Delete my account refuses that case
//               (spec-account-auth "Delete my account": the last Owner is a
//               refusal with its own copy), because a workspace with nobody
//               who can reach Members is one nobody can repair.
//
// Server only (prisma).

import { prisma } from "@/lib/prisma";
import { LEGACY_ADMIN_LEVELS } from "./legacy-levels";
import { isAgentOf, orgRoleOf } from "./org-role";
import type { OrgRole } from "./types";

export interface SelfAccountFacts {
  orgRole: OrgRole;
  isAgent: boolean;
  isLastAdmin: boolean;
}

/** Pure: the last-admin rule over the counts (tested). */
export function isLastAdminOf(selfIsAdmin: boolean, otherActiveAdmins: number): boolean {
  return selfIsAdmin && otherActiveAdmins <= 0;
}

export async function selfAccountFacts(userId: string, organizationId: string): Promise<SelfAccountFacts | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { accessLevel: true } });
  if (!me) return null;
  const level = me.accessLevel ?? null;
  const selfIsAdmin = !!level && LEGACY_ADMIN_LEVELS.has(level);
  let others = 1;
  if (selfIsAdmin) {
    others = await prisma.user.count({
      where: {
        organizationId,
        id: { not: userId },
        deletedAt: null,
        status: { not: "INACTIVE" },
        accessLevel: { in: [...LEGACY_ADMIN_LEVELS] as ("SUPER_ADMIN" | "COMPANY_ADMIN")[] },
      },
    });
  }
  return {
    orgRole: orgRoleOf({ accessLevel: level }),
    isAgent: isAgentOf(level),
    isLastAdmin: isLastAdminOf(selfIsAdmin, others),
  };
}
