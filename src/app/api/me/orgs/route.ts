import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, getOrgId, jsonSuccess } from "@/lib/api-helpers";

/**
 * List every Organization the current user can act inside, sourced
 * from OrganizationMembership rows. The user's "current" org (the
 * one their session is anchored to) is marked with `isCurrent` so
 * the topbar dropdown can highlight it without a second lookup.
 *
 * No write side — `POST /api/me/switch-org` flips the current org.
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const currentOrgId = getOrgId(session);

  const memberships = await prisma.organizationMembership.findMany({
    // Hide workspaces that are scheduled for deletion (CANCELLED) or suspended —
    // a "deleted" workspace shouldn't linger in the switcher during its grace
    // window. The membership row survives (for a possible restore) but the org
    // is filtered out of the user-facing list.
    where: { userId, organization: { status: { notIn: ["CANCELLED", "SUSPENDED"] } } },
    include: {
      organization: { select: { id: true, name: true, slug: true, logo: true } },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return jsonSuccess({
    currentOrganizationId: currentOrgId,
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      isPrimary: m.isPrimary,
      isCurrent: m.organizationId === currentOrgId,
      organization: m.organization,
    })),
  });
}
