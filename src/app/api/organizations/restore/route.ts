import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshMayManageOwnerPage, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { writeOrgSettingsKeys } from "@/lib/org-settings-write";

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

  // Owner only (settings spec Identity > Danger zone); every Admin until
  // the Owner and Admin split is approved (SETTINGS_OWNER_SPLIT, default OFF).
  if (!freshMayManageOwnerPage(await freshWorkspaceActor(session))) {
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

  // The status and the removal of the three deletion keys together; only
  // those keys of the shared settings column are touched.
  const clear: Record<keyof Pick<OrgSettingsWithDeletion, "cancelledAt" | "cancelledById" | "scheduledHardDeleteAt">, null> = {
    cancelledAt: null,
    cancelledById: null,
    scheduledHardDeleteAt: null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: orgId }, data: { status: "ACTIVE" } });
    await writeOrgSettingsKeys(orgId, clear, tx);
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
