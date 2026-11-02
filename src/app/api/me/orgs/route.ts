import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, getOrgId, jsonSuccess } from "@/lib/api-helpers";
import { accountIsLive } from "@/lib/access/workspace-anchor";
import { CLOSED_WORKSPACE_STATUSES, seatIsLive } from "@/lib/access/workspace-seat";

/**
 * List every Organization the current user can act inside, sourced
 * from OrganizationMembership rows. The user's "current" org (the
 * one their session is anchored to) is marked with `isCurrent` so
 * the topbar dropdown can highlight it without a second lookup.
 *
 * Only seats they can use (docs/plans/workspace-status.md D2): a workspace
 * that deactivated or removed them is not one to switch into, so it is not
 * listed. The seat is the account row where the account is anchored and the
 * membership everywhere else (D1): the anchored workspace's own membership
 * row, when there is one, is stale while they are anchored there, so that
 * workspace is listed as before, by the account's own status, whatever its
 * row says.
 *
 * No write side — `POST /api/me/switch-org` flips the current org.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const currentOrgId = getOrgId(session);

  const [account, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true } }),
    prisma.organizationMembership.findMany({
      // Hide workspaces that are scheduled for deletion (CANCELLED) or suspended:
      // a "deleted" workspace shouldn't linger in the switcher during its grace
      // window. The membership row survives (for a possible restore) but the org
      // is filtered out of the user-facing list.
      where: { userId, organization: { status: { notIn: [...CLOSED_WORKSPACE_STATUSES] } } },
      include: {
        organization: { select: { id: true, name: true, slug: true, logo: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const usable = memberships.filter((m) =>
    account && m.organizationId === account.organizationId ? accountIsLive(account) : seatIsLive(m),
  );

  return jsonSuccess({
    currentOrganizationId: currentOrgId,
    memberships: usable.map((m) => ({
      id: m.id,
      role: m.role,
      isPrimary: m.isPrimary,
      isCurrent: m.organizationId === currentOrgId,
      organization: m.organization,
    })),
  });
}
