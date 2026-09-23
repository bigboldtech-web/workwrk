// The server half of the announcement rules: one viewer, loaded once.
//
// The pure rules live in src/lib/announcement-access.ts, which has no
// imports and is unit-tested. This module is the thin layer that turns a
// session into the facts those rules take, so the list route, the detail
// route, the acknowledge roster and the remind route cannot disagree about
// who somebody is.
//
// It is also where the ONE behaviour change of the announcements rebuild is
// enforced: the oversight read is Owner, Admin, the People team and the
// author. Before Phase 4, `isManager(session)` let anybody with a legacy
// manager level read every announcement in the workspace, including posts
// aimed at one department. A team lead with one report is an ordinary reader
// now, and only sees a post the audience names them in.

import { orgRoleOf } from "@/lib/access/org-role";
import { hasPermission } from "@/lib/api-helpers";
import type { AnnouncementOrgRole, AnnouncementViewerFacts } from "@/lib/announcement-access";
import { prisma } from "@/lib/prisma";

/** Build the viewer facts the pure rules take, from a NextAuth session. */
export async function announcementViewer(session: {
  user: { id: string; organizationId: string; accessLevel?: string | null };
}): Promise<AnnouncementViewerFacts> {
  const userId = session.user.id;
  const orgRole = orgRoleOf({ accessLevel: session.user.accessLevel ?? null }) as AnnouncementOrgRole;
  // The People team, as the permission matrix defines it. A read failure is
  // a denial, never a grant: an unreadable matrix must not hand somebody the
  // org-wide audiences.
  let canCreate = false;
  try {
    canCreate = await hasPermission(session, "announcements", "create");
  } catch {
    canCreate = false;
  }
  return { userId, orgRole, canCreate };
}

/**
 * Does this person hold Full access on any Space? That is the one thing that
 * lets somebody who is not an Owner, an Admin or on the People team post at
 * all, and it caps them at the "People in {Space}" audience.
 *
 * SpaceRole OWNER or ADMIN is the Full holder in the Space membership store.
 */
export async function holdsAnySpaceFullAccess(orgId: string, userId: string): Promise<boolean> {
  try {
    const row = await prisma.spaceMember.findFirst({
      where: {
        userId,
        role: { in: ["OWNER", "ADMIN"] },
        space: { organizationId: orgId, archivedAt: null },
      },
      select: { id: true },
    });
    return Boolean(row);
  } catch {
    return false;
  }
}

/** The Space ids this person holds Full access on, for the composer's picker. */
export async function spaceIdsWithFullAccess(orgId: string, userId: string): Promise<string[]> {
  try {
    const rows = await prisma.spaceMember.findMany({
      where: {
        userId,
        role: { in: ["OWNER", "ADMIN"] },
        space: { organizationId: orgId, archivedAt: null },
      },
      select: { spaceId: true },
    });
    return rows.map((r) => r.spaceId);
  } catch {
    return [];
  }
}
