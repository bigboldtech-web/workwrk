// /api/auth/mfa/enrol-at-login: turn two step verification on from the
// login card, with no session (spec-account-auth `/login` step 2b).
//
// Reached only with the ticket `authorize` hands back as
// MFA_ENROL_REQUIRED:<ticket>, which proves the person typed the right
// password within the last ten minutes (src/lib/auth/mfa-enrol-ticket.ts).
//
//   POST { ticket }                   -> { secret, qr } (nothing stored)
//   POST { ticket, secret, code }     -> { backupCodes } (enabled)
//
// It never issues a session: the login form then submits email, password
// and a live code through the normal authorize. Refused once the account is
// enrolled, so a replayed ticket cannot replace a live secret. Rate limited
// per person and per IP.

import { NextRequest } from "next/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { enrolTicketUserId, verifyEnrolTicket } from "@/lib/auth/mfa-enrol-ticket";
import { generateBackupCodes, mfaCodeKind, normaliseMfaInput } from "@/lib/auth/mfa-codes";

const WINDOW = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req);
  const ipGuard = rateLimit(`mfa-enrol-login-ip:${ip}`, { max: 30, windowMs: WINDOW });
  if (!ipGuard.ok) return jsonError("Too many attempts. Try again in a few minutes.", 429);

  const body = (await req.json().catch(() => null)) as { ticket?: unknown; secret?: unknown; code?: unknown } | null;
  const userId = enrolTicketUserId(body?.ticket);
  // One refusal for every bad ticket, so the route says nothing about who exists.
  const expired = () => jsonError("That set-up link has expired. Log in again to start over.", 410);
  if (!userId) return expired();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, tokenVersion: true, mfaEnabled: true, organizationId: true, status: true, deletedAt: true, organization: { select: { name: true } } },
  });
  if (!user || user.deletedAt || user.status === "INACTIVE") return expired();
  if (!verifyEnrolTicket(body?.ticket, { userId: user.id, tokenVersion: user.tokenVersion ?? 0 })) return expired();
  if (user.mfaEnabled) return jsonError("Two step verification is already on. Log in with your code.", 409);

  const guard = rateLimit(`mfa-enrol-login:${user.id}`, { max: 10, windowMs: WINDOW });
  if (!guard.ok) return jsonError(`Too many attempts. Try again in ${Math.ceil(guard.retryAfter / 60)} minutes.`, 429);

  // Phase 1: a fresh secret and its QR, not stored.
  if (typeof body?.secret !== "string" || typeof body?.code !== "string") {
    const secret = generateSecret();
    const otpauth = generateURI({ issuer: "WorkwrK", label: `${user.organization.name} (${user.email})`, secret });
    const qr = await QRCode.toDataURL(otpauth);
    return jsonSuccess({ secret, qr });
  }

  // Phase 2: verify the code against the secret the client holds, then enable.
  const code = normaliseMfaInput(body.code);
  if (mfaCodeKind(code) !== "totp") return jsonError("Enter the 6 digit code from your authenticator app.", 400);
  let valid = false;
  try {
    valid = !!verifySync({ token: code, secret: body.secret, epochTolerance: [1, 1] })?.valid;
  } catch {
    valid = false;
  }
  if (!valid) return jsonError("That code is not right. Codes change every 30 seconds.", 400);

  const { backupCodes, hashedCodes } = await generateBackupCodes();
  // updateMany with mfaEnabled:false in the filter: two tabs racing the same
  // ticket cannot both write a secret; the loser gets the 409.
  const res = await prisma.user.updateMany({
    where: { id: user.id, mfaEnabled: false },
    data: { mfaEnabled: true, mfaSecret: body.secret, mfaBackupCodes: hashedCodes },
  });
  if (res.count !== 1) return jsonError("Two step verification is already on. Log in with your code.", 409);

  void logAuditEvent({
    type: "mfa_enabled",
    actorId: user.id,
    organizationId: user.organizationId,
    description: "Two step verification turned on while logging in",
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    severity: "warning",
  });

  return jsonSuccess({ enabled: true, backupCodes });
}
