import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

/**
 * Schedule a tenant for deletion. Soft-delete with a 30-day grace
 * period — the org goes into status=CANCELLED, sign-in is blocked
 * (enforced in the auth layer), and a sibling cron will hard-delete
 * once the grace window elapses.
 *
 * Body: `{ confirmName: string, confirmPhrase: "DELETE" }`
 *   confirmName     — must equal the org name (case-sensitive)
 *   confirmPhrase   — must be the literal word "DELETE"
 *
 * Required role: COMPANY_ADMIN or SUPER_ADMIN.
 *
 * Two-key confirm exists because tenant deletion is irreversible
 * after the 30-day window — one slip-up wipes everyone's data. The
 * matching org name catches typos; the DELETE phrase catches "I
 * didn't realize that button was destructive."
 *
 * Logged as a critical audit event so the deletion is forensically
 * findable on review.
 */
const GRACE_DAYS = 30;

interface OrgSettingsWithDeletion {
  cancelledAt?: string;
  cancelledById?: string;
  scheduledHardDeleteAt?: string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const accessLevel = (session as { user: { accessLevel?: string } }).user.accessLevel;
  if (!accessLevel || !["COMPANY_ADMIN", "SUPER_ADMIN"].includes(accessLevel)) {
    return jsonError("Only company admins can delete the organization", 403);
  }

  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const body = await req.json().catch(() => ({}));
  const confirmName = typeof body.confirmName === "string" ? body.confirmName : "";
  const confirmPhrase = typeof body.confirmPhrase === "string" ? body.confirmPhrase : "";

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true, settings: true },
  });
  if (!org) return jsonError("Organization not found", 404);

  if (org.status === "CANCELLED") {
    const existing = (org.settings ?? {}) as OrgSettingsWithDeletion;
    return jsonError(
      `This organization is already scheduled for deletion${existing.scheduledHardDeleteAt ? ` on ${new Date(existing.scheduledHardDeleteAt).toISOString().slice(0, 10)}` : ""}. Use the Restore action to cancel.`,
      409,
    );
  }

  if (confirmName !== org.name) {
    return jsonError("Organization name does not match. Type it exactly to confirm.");
  }
  if (confirmPhrase !== "DELETE") {
    return jsonError("Type the word DELETE in the confirm box to proceed.");
  }

  const now = new Date();
  const scheduledHardDeleteAt = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

  const nextSettings: OrgSettingsWithDeletion = {
    ...((org.settings as OrgSettingsWithDeletion) ?? {}),
    cancelledAt: now.toISOString(),
    cancelledById: userId,
    scheduledHardDeleteAt: scheduledHardDeleteAt.toISOString(),
  };

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "CANCELLED",
      settings: nextSettings as never,
    },
  });

  logAuditEvent({
    type: "organization_scheduled_deletion",
    actorId: userId,
    organizationId: orgId,
    description: `Scheduled organization "${org.name}" for deletion on ${scheduledHardDeleteAt.toISOString().slice(0, 10)} (${GRACE_DAYS}-day grace).`,
    targetId: orgId,
    targetType: "organization",
    metadata: { graceDays: GRACE_DAYS, scheduledHardDeleteAt: scheduledHardDeleteAt.toISOString() },
    severity: "critical",
  });

  return jsonSuccess({
    status: "CANCELLED",
    scheduledHardDeleteAt: scheduledHardDeleteAt.toISOString(),
    graceDays: GRACE_DAYS,
    message: `Organization scheduled for deletion. You have ${GRACE_DAYS} days to cancel — call POST /api/organizations/restore to undo.`,
  });
}
