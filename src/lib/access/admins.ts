// Who can turn a module on or grant what a viewer lacks: the org's Owners
// and Admins, for the "Ask an admin" line on ModuleOff / AppOff and for an
// access request with no object owner (access-model-spec 5.5 items 5 and
// 6). A read-only helper; it decides nothing.
//
// Server-only (prisma).

import { prisma } from "../prisma";
import { ADMIN_ACCESS_LEVEL, OWNER_ACCESS_LEVEL } from "./org-role";

export interface OrgAdmin {
  id: string;
  name: string;
  avatar: string | null;
  /** So "Ask an admin" can be acted on: the avatars are mailto links
   *  (spec-talk 2.0). Null when the row has no address on file. */
  email: string | null;
}

export async function listOrgAdmins(organizationId: string, limit = 5): Promise<OrgAdmin[]> {
  const rows = await prisma.user.findMany({
    where: {
      organizationId,
      deletedAt: null,
      accessLevel: { in: [OWNER_ACCESS_LEVEL, ADMIN_ACCESS_LEVEL] },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, firstName: true, lastName: true, avatar: true, email: true },
  });
  return rows.map((u) => ({
    id: u.id,
    name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Admin",
    avatar: u.avatar ?? null,
    email: u.email ?? null,
  }));
}
