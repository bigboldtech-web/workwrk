import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { lockOrgRoles } from "@/lib/access/membership";
import { lockWorkspaceSeats } from "@/lib/seats";
import { ownerIdsFor } from "@/lib/admin/company-detail";
import { LIVE_PERSON } from "@/lib/admin/companies-list";
import { logActivity } from "@/lib/activity";

/**
 * DELETE /api/organization/memberships/[userId]
 *
 * Take a person who is in this workspace through a membership (their account
 * belongs to another workspace) out of this one. They keep their own
 * workspace and account; they lose this workspace, and its seat is freed.
 *
 * WHY. Such a person holds one of this workspace's seats (src/lib/seats.ts),
 * but Members lists only the people whose account is here, and the people
 * routes look a person up by this workspace, so nobody could deactivate or
 * remove them: a seat held for good by someone who had left.
 *
 * The Members rule (Owners and Admins), the actor re-read. Never an Owner,
 * and never the workspace's last Admin. Under the roles lock, then the seat
 * lock (the order every role and seat change takes them in).
 */
const ADMIN_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN"] as const;

class Refused extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const gate = await settingsWriteGate(session, "members");
  if (!gate.ok) return gate.response;
  const orgId = getOrgId(session);
  const actorId = getUserId(session);
  const { userId } = await params;
  if (userId === actorId) return jsonError("You can't remove yourself here. Switch to your own workspace to leave this one.", 400);

  let removed: { name: string; email: string };
  try {
    removed = await prisma.$transaction(async (tx) => {
      await lockOrgRoles(tx, orgId);
      await lockWorkspaceSeats(tx, orgId);
      const membership = await tx.organizationMembership.findUnique({
        where: { userId_organizationId: { userId, organizationId: orgId } },
        select: { id: true, role: true, user: { select: { organizationId: true, firstName: true, lastName: true, email: true } } },
      });
      // Only someone whose account is elsewhere: a person anchored here is
      // removed or deactivated from Members.
      if (!membership || membership.user.organizationId === orgId) throw new Refused(404, "This person is not in this workspace through another one.");
      if ((await ownerIdsFor(orgId)).includes(userId)) throw new Refused(409, "This person is an Owner of this workspace, so they can't be removed here.");
      if ((ADMIN_LEVELS as readonly string[]).includes(String(membership.role))) {
        const [anchoredAdmins, memberAdmins] = await Promise.all([
          tx.user.count({ where: { organizationId: orgId, ...LIVE_PERSON, accessLevel: { in: [...ADMIN_LEVELS] }, id: { not: userId } } }),
          tx.organizationMembership.count({
            where: { organizationId: orgId, role: { in: [...ADMIN_LEVELS] }, userId: { not: userId }, user: { ...LIVE_PERSON, organizationId: { not: orgId } } },
          }),
        ]);
        if (anchoredAdmins + memberAdmins === 0) throw new Refused(409, "This person is the workspace's only Admin. Make someone else an Admin first.");
      }
      await tx.organizationMembership.delete({ where: { id: membership.id } });
      return { name: `${membership.user.firstName ?? ""} ${membership.user.lastName ?? ""}`.trim() || membership.user.email, email: membership.user.email };
    });
  } catch (e) {
    if (e instanceof Refused) return jsonError(e.message, e.status);
    throw e;
  }

  logActivity({
    type: "membership_removed",
    actorId,
    organizationId: orgId,
    description: `Removed ${removed.name} (in through another workspace) from this workspace`,
    targetId: userId,
    targetType: "user",
  });
  return jsonSuccess({ removed: true });
}
