import { NextRequest } from "next/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getUserId,
  getOrgId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { generateBackupCodes, mfaCodeKind, normaliseMfaInput } from "@/lib/auth/mfa-codes";
import { selfAccountFacts } from "@/lib/access/self-facts";
import { mfaRequiredFor } from "@/lib/auth/security-policy";

// One 30-second step of leeway on either side to absorb clock drift.
const VERIFY_TOLERANCE: [number, number] = [1, 1];

function checkCode(code: string, secret: string): boolean {
  try {
    const res = verifySync({ token: code, secret, epochTolerance: VERIFY_TOLERANCE });
    return !!res?.valid;
  } catch {
    return false;
  }
}

/**
 * GET /api/auth/mfa/enroll
 * Returns a fresh unconfirmed TOTP secret + QR-code data URL. The
 * secret is NOT persisted yet — only stored on the user after the
 * caller proves they can produce a valid code via /verify below.
 */
export async function GET(_req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, mfaEnabled: true, organization: { select: { name: true } } },
  });
  if (!user) return jsonError("User not found", 404);
  if (user.mfaEnabled) {
    return jsonError("Two step verification is already on. Turn it off first to set it up again.", 409);
  }

  const secret = generateSecret();
  const otpauth = generateURI({
    issuer: "WorkwrK",
    label: `${user.organization.name} (${user.email})`,
    secret,
  });
  const qr = await QRCode.toDataURL(otpauth);

  // Return the secret in plaintext — client will send it back with the
  // confirmation code. We never store it until enrolment succeeds.
  return jsonSuccess({ secret, qr, otpauth });
}

/**
 * POST /api/auth/mfa/enroll
 * Body: { secret, code }
 * Confirms enrolment by validating the code. On success, persists the
 * secret, generates 8 one-time backup codes (plaintext returned once,
 * bcrypt-hashed in storage), flips mfaEnabled = true.
 */
export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const body = (await req.json().catch(() => ({}))) as {
    secret?: string;
    code?: string;
  };
  if (!body.secret || !body.code) return jsonError("secret and code are required");
  const guard = rateLimit(`mfa-enrol:${userId}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!guard.ok) return jsonError(`Too many attempts. Try again in ${Math.ceil(guard.retryAfter / 60)} minutes.`, 429);
  if (!checkCode(normaliseMfaInput(body.code), body.secret)) {
    return jsonError("That code is not right. Codes change every 30 seconds.", 400);
  }

  // A session alone never replaces a live secret: re-enrolling means turning
  // it off first, which needs a valid code.
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
  if (current?.mfaEnabled) return jsonError("Two step verification is already on.", 409);

  const { backupCodes, hashedCodes } = await generateBackupCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecret: body.secret,
      mfaBackupCodes: hashedCodes,
    },
  });

  void logAuditEvent({
    type: "mfa_enabled",
    actorId: userId,
    organizationId: getOrgId(session),
    description: "Two-factor authentication enabled",
    ipAddress: ipFromRequest(req),
    userAgent: req.headers.get("user-agent"),
    severity: "warning",
  });

  return jsonSuccess({
    enabled: true,
    backupCodes,
    message:
      "These one-time backup codes will work if you lose your authenticator. Copy them now — they're only shown once.",
  });
}

/**
 * DELETE /api/auth/mfa/enroll
 * Disable MFA. Requires current session + a valid TOTP code or backup code.
 * The code travels in the JSON body ({ code }) so it never lands in a proxy
 * log; `?code=` is still accepted for one release so an open tab on the old
 * dialog keeps working. Refused (403) when the org requires two step
 * verification for this person's role, and rate limited per person so the
 * six digits cannot be walked.
 */
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const rawCode = typeof body?.code === "string" ? body.code : new URL(req.url).searchParams.get("code");
  if (!rawCode) return jsonError("code required");
  const code = normaliseMfaInput(rawCode);

  const facts = await selfAccountFacts(userId, getOrgId(session));
  const org = await prisma.organization.findUnique({ where: { id: getOrgId(session) }, select: { name: true, settings: true } });
  if (facts && org && mfaRequiredFor(org.settings, facts.orgRole)) {
    return jsonError(`Required by ${org.name}`, 403);
  }
  const guard = rateLimit(`mfa-disable:${userId}`, { max: 10, windowMs: 15 * 60 * 1000 });
  if (!guard.ok) return jsonError(`Too many attempts. Try again in ${Math.ceil(guard.retryAfter / 60)} minutes.`, 429);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaBackupCodes: true },
  });
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return jsonError("Two step verification is off.", 400);
  }

  const ok =
    (mfaCodeKind(code) === "totp" && checkCode(code, user.mfaSecret)) ||
    (mfaCodeKind(code) === "backup" && (await verifyBackupCode(code, user.mfaBackupCodes)));
  if (!ok) return jsonError("That code is not right.", 400);

  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
  });

  void logAuditEvent({
    type: "mfa_disabled",
    actorId: userId,
    organizationId: getOrgId(session),
    description: "Two-factor authentication disabled",
    ipAddress: ipFromRequest(req),
    userAgent: req.headers.get("user-agent"),
    severity: "warning",
  });

  return jsonSuccess({ disabled: true });
}

async function verifyBackupCode(code: string, hashed: string[]): Promise<boolean> {
  const bcrypt = await import("bcryptjs");
  for (const h of hashed) {
    if (await bcrypt.compare(code, h)) return true;
  }
  return false;
}

