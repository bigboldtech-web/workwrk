// POST /api/auth/mfa/backup-codes: a new set of backup codes
// (spec-account-auth "Backup codes dialog").
//
// Body: { code } where code is a FRESH authenticator code (six digits). A
// backup code is refused here on purpose: a person holding only a stolen
// backup code must not be able to mint eight more. On success the old set
// is replaced in one write (so every old code stops working at once), the
// eight new codes are returned exactly once, and `mfa_backup_codes_regenerated`
// is logged. Rate limited per person so the six digits cannot be walked.

import { NextRequest } from "next/server";
import { verifySync } from "otplib";
import { prisma } from "@/lib/prisma";
import { getOrgId, getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { generateBackupCodes, mfaCodeKind, normaliseMfaInput } from "@/lib/auth/mfa-codes";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? normaliseMfaInput(body.code) : "";
  if (mfaCodeKind(code) !== "totp") return jsonError("Enter the 6 digit code from your authenticator app.", 400);

  const guard = rateLimit(`mfa-backup:${userId}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!guard.ok) return jsonError(`Too many attempts. Try again in ${Math.ceil(guard.retryAfter / 60)} minutes.`, 429);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true, mfaSecret: true } });
  if (!user?.mfaEnabled || !user.mfaSecret) return jsonError("Two step verification is off.", 400);

  let valid = false;
  try {
    valid = !!verifySync({ token: code, secret: user.mfaSecret, epochTolerance: [1, 1] })?.valid;
  } catch {
    valid = false;
  }
  if (!valid) return jsonError("That code is not right. Codes change every 30 seconds.", 400);

  const { backupCodes, hashedCodes } = await generateBackupCodes();
  await prisma.user.update({ where: { id: userId }, data: { mfaBackupCodes: hashedCodes } });

  void logAuditEvent({
    type: "mfa_backup_codes_regenerated",
    actorId: userId,
    organizationId: getOrgId(session),
    description: "New backup codes created; the old set stopped working",
    ipAddress: ipFromRequest(req),
    userAgent: req.headers.get("user-agent"),
    severity: "warning",
  });

  return jsonSuccess({ backupCodes });
}
