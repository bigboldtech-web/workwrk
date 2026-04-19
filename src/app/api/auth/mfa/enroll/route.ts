import { NextRequest } from "next/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getUserId,
  jsonError,
  jsonSuccess,
} from "@/lib/api-helpers";

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
    return jsonError("MFA is already enabled. Disable it first to re-enrol.", 409);
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
  if (!checkCode(body.code, body.secret)) {
    return jsonError("Incorrect code. Try the next 30-second cycle.", 400);
  }

  const bcrypt = await import("bcryptjs");
  const backupCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = randomCode();
    backupCodes.push(raw);
    hashedCodes.push(await bcrypt.hash(raw, 10));
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecret: body.secret,
      mfaBackupCodes: hashedCodes,
    },
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
 * Disable MFA. Requires current session + a valid TOTP code or backup code
 * (passed as ?code=).
 */
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return jsonError("code required");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaBackupCodes: true },
  });
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    return jsonError("MFA not enabled on this account", 400);
  }

  const ok =
    checkCode(code, user.mfaSecret) ||
    (await verifyBackupCode(code, user.mfaBackupCodes));
  if (!ok) return jsonError("Invalid code", 401);

  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
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

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
