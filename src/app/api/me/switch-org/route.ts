import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { reanchorUser } from "@/lib/access/workspace-anchor";

/**
 * Switch the caller's current organization to one of their existing
 * OrganizationMembership rows. We re-anchor the user by updating
 * `User.organizationId` to the chosen org: the JWT callback in
 * src/lib/auth.ts will pick this up on the next token refresh (or
 * the client calling `session.update()` will force the refresh
 * immediately).
 *
 * Guardrails:
 * - The target org MUST be one the user already has a membership in.
 *   Cross-org probing is refused with 403.
 * - We don't bump `isPrimary` here; that is a separate concept (the
 *   "home" org) from the actively-viewed org. A future column on
 *   User (`activeOrganizationId`) could split these cleanly; for
 *   now we overload `organizationId` since nothing else uses it as
 *   a stable home.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const body = await req.json().catch(() => null);
  const target = body?.organizationId;
  if (typeof target !== "string" || !target) {
    return jsonError("organizationId is required");
  }

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId: target } },
    select: { role: true, organization: { select: { status: true } } },
  });
  if (!membership) {
    return jsonError("You are not a member of that organization", 403);
  }
  // A suspended or cancelled workspace is not one anyone can work in. The
  // session check in lib/auth.ts would move the token straight back out;
  // refusing here keeps User.organizationId off an unusable workspace.
  const targetStatus = membership.organization?.status;
  if (targetStatus === "SUSPENDED" || targetStatus === "CANCELLED") {
    return jsonError(
      targetStatus === "SUSPENDED"
        ? "That workspace is suspended. Please contact WorkwrK support."
        : "That workspace is closed. Please contact WorkwrK support.",
      403,
    );
  }

  const previousOrgId = getOrgId(session);

  // The level the person holds in the workspace they leave is kept on its
  // membership (so they can come back to it, as themselves), and they take
  // the level their membership in the target holds (src/lib/workspace-anchor.ts).
  const moved = await reanchorUser({ userId, to: { organizationId: target, role: membership.role } });
  if (!moved) return jsonSuccess({ switched: false, organizationId: target });

  // Security-sensitive: org switches show up in the audit trail of
  // BOTH the leaving org (severity warning) and the entering org so
  // ops can correlate cross-tenant activity.
  const ipAddress = clientIpFromHeaders(req.headers);
  const userAgent = req.headers.get("user-agent") ?? null;
  await Promise.all([
    logAuditEvent({
      type: "org.switch.out",
      actorId: userId,
      organizationId: previousOrgId,
      description: `User switched away to a different organization`,
      targetType: "Organization",
      targetId: target,
      metadata: { from: previousOrgId, to: target },
      ipAddress,
      userAgent,
    }),
    logAuditEvent({
      type: "org.switch.in",
      actorId: userId,
      organizationId: target,
      description: `User switched into this organization`,
      targetType: "Organization",
      targetId: previousOrgId,
      metadata: { from: previousOrgId, to: target },
      ipAddress,
      userAgent,
    }),
  ]);

  return jsonSuccess({
    switched: true,
    organizationId: target,
    // The client should call NextAuth's `session.update()` after this
    // returns so the JWT picks up the new org without waiting for the
    // refresh interval.
    refreshRequired: true,
  });
}
