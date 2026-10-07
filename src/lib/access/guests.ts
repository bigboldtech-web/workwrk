// Whether any of these people is a Guest in this workspace now, at the
// level each holds HERE: their own row's when this is their home
// workspace, else their membership's (someone in through a second
// workspace can be a Guest here and a Member at home). A home person the
// stored org role names a Guest is one too, whatever their level says (the
// Guest invitation writes that column; Guest is not a level, org-role.ts
// effectiveOrgRole). It is read here with or without ACCESS_V2_TABLES: it
// can only refuse more, never widen. A person whose level cannot be read
// counts as a Guest. Two reads, however many people.
//
// AI teammates are never asked in Talk where a Guest reads
// (docs/plans/ai-teammates-phase2.md Decision 8).

import { prisma } from "@/lib/prisma";
import { orgRoleOf } from "./org-role";

export async function anyGuestHere(organizationId: string, userIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return false;
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, accessLevel: true, orgRole: true } });
  if (rows.length < ids.length) return true;
  const visitors = rows.filter((r) => r.organizationId !== organizationId).map((r) => r.id);
  const held = visitors.length
    ? await prisma.organizationMembership.findMany({ where: { organizationId, userId: { in: visitors } }, select: { userId: true, role: true } })
    : [];
  const roleOf = new Map(held.map((h) => [h.userId, h.role]));
  return rows.some((r) => {
    const home = r.organizationId === organizationId;
    if (home && r.orgRole === "GUEST") return true;
    return orgRoleOf({ accessLevel: home ? r.accessLevel : (roleOf.get(r.id) ?? null) }) === "GUEST";
  });
}
