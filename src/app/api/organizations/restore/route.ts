import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

/**
 * Cancel a pending tenant deletion. Only works during the soft-delete
 * grace window — once the hard-delete cron has run, restoration is
 * impossible (the data is genuinely gone).
 *
 * Required role: COMPANY_ADMIN or SUPER_ADMIN.
 */
interface OrgSettingsWithDeletion {
  cancelledAt?: string;
  cancelledById?: string;
  scheduledHardDeleteAt?: string;
  [key: string]: unknown;
}

export async function POST(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const accessLevel = (session as { user: { accessLevel?: string } }).user.accessLevel;
  if (!accessLevel || !["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel)) {
    return jsonError("Only company admins can restore the organization", 403);
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true, settings: true },
  });
  if (!org) return jsonError("Organization not found", 404);
  if (org.status !== "CANCELLED") {
    return jsonError("Organization is not pending deletion", 409);
  }

  const settings = (org.settings ?? {}) as OrgSettingsWithDeletion;
  const { cancelledAt: _ca, cancelledById: _cb, scheduledHardDeleteAt: _sh, ...rest } = settings;
  void _ca; void _cb; void _sh;

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "ACTIVE",
      settings: rest as never,
    },
  });

  logAuditEvent({
    type: "organization_deletion_cancelled",
    actorId: userId,
    organizationId: orgId,
    description: `Cancelled scheduled deletion of "${org.name}". Organization restored to ACTIVE.`,
    targetId: orgId,
    targetType: "organization",
    severity: "critical",
  });

  return jsonSuccess({
    status: "ACTIVE",
    message: "Organization restored. The scheduled hard-delete has been cancelled.",
  });
}
