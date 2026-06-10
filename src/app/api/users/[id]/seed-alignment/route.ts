// POST /api/users/[id]/seed-alignment — manually (re)seed a user's KRA/SOP
// defaults from their current role's templates. Auto-seeding only fires on
// hire / role-change, so this covers backfilling existing people and
// re-applying after a role's templates change. Idempotent (skipDuplicates).

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { seedAlignmentForUser } from "@/lib/alignment-assign";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const { id } = await params;

  const target = await prisma.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, roleId: true },
  });
  if (!target) return jsonError("User not found", 404);
  if (!target.roleId) return jsonError("User has no role to seed from", 400);

  const result = await seedAlignmentForUser({
    userId: id,
    roleId: target.roleId,
    organizationId: orgId,
    assignedBy: getUserId(session),
  });

  return jsonSuccess(result);
}
