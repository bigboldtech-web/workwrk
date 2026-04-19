import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

/**
 * GET /api/auth/mfa/status
 * Returns whether the current user has MFA turned on.
 */
export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, emailVerifiedAt: true },
  });
  if (!user) return jsonError("User not found", 404);

  return jsonSuccess({
    mfaEnabled: !!user.mfaEnabled,
    emailVerified: !!user.emailVerifiedAt,
  });
}
