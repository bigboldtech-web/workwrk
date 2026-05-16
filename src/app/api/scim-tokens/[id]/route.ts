// Revoke / delete a SCIM token. Revocation is the safer default —
// keeps the audit row, sets revokedAt, and authenticateScim() refuses
// it on lookup. Delete is reserved for cleaning up obviously-rotted
// tokens (e.g. ones never used).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  getUserId,
  jsonError,
  jsonSuccess,
  isOrgAdmin,
} from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const token = await prisma.scimToken.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!token) return jsonError("Token not found", 404);

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.revoke === true && !token.revokedAt) {
    data.revokedAt = new Date();
  }
  if (typeof body.name === "string" && body.name.trim() !== token.name) {
    data.name = body.name.trim();
  }

  if (Object.keys(data).length === 0) return jsonError("No changes");

  const updated = await prisma.scimToken.update({ where: { id }, data });

  if (data.revokedAt) {
    logAuditEvent({
      type: "scim_token_revoked",
      actorId: getUserId(session),
      organizationId: orgId,
      description: `Revoked SCIM token "${updated.name}" (prefix ${updated.tokenPrefix})`,
      targetId: id,
      targetType: "scim_token",
      metadata: { name: updated.name, tokenPrefix: updated.tokenPrefix },
      severity: "critical",
    });
  }

  return jsonSuccess({
    id: updated.id,
    name: updated.name,
    tokenPrefix: updated.tokenPrefix,
    lastUsedAt: updated.lastUsedAt,
    expiresAt: updated.expiresAt,
    revokedAt: updated.revokedAt,
    createdAt: updated.createdAt,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isOrgAdmin(session)) return jsonError("Forbidden", 403);

  const { id } = await params;
  const orgId = getOrgId(session);

  const token = await prisma.scimToken.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!token) return jsonError("Token not found", 404);

  await prisma.scimToken.delete({ where: { id } });

  logAuditEvent({
    type: "scim_token_deleted",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Deleted SCIM token "${token.name}" (prefix ${token.tokenPrefix})`,
    targetId: id,
    targetType: "scim_token",
    metadata: { name: token.name, tokenPrefix: token.tokenPrefix, hadBeenRevoked: !!token.revokedAt },
    severity: "critical",
  });

  return jsonSuccess({ deleted: true });
}
