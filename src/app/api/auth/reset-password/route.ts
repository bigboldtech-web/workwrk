import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { validatePassword, policyFromOrgSettings } from "@/lib/password-policy";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { logAuditEvent } from "@/lib/activity";

// POST /api/auth/reset-password { token, password }
//
// What holds here, and must keep holding (login hardening, 2026-09-08):
//   - reset tokens are stored as their SHA-256 hash, and the emailed copy
//     of the link is cleared from EmailLog once it is sent (src/lib/email.ts
//     SECRET_LINK_TEMPLATES), so a database leak yields no working link;
//   - the new password meets the account's workspace policy;
//   - tokenVersion is bumped, so every other session (an attacker's
//     included) is logged out at its next session check (five minutes at
//     most, REVALIDATE_MS in src/lib/auth.ts).
// Phase 8 adds, without loosening any of those:
//   - the token is CLAIMED atomically (used=false -> true in one statement)
//     before the password is written, so two submits of one link cannot
//     both succeed, and a racing second request gets the "not valid" answer;
//   - a per-IP rate limit (20 an hour) on guesses;
//   - passwordChangedAt and a `password_reset` security activity row, which
//     the person's own Security page lists.
// The reset link never logs anyone in; the page sends them to /login?reset=1.

const INVALID = "This reset link is not valid any more. Links work for 60 minutes and only once.";

export async function POST(req: Request) {
  try {
    const limit = rateLimit(`reset:ip:${ipFromRequest(req)}`, { max: 20, windowMs: 60 * 60 * 1000 });
    if (!limit.ok) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }

    const body = (await req.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });
    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: INVALID, code: "invalid_token" }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { email: resetToken.email, deletedAt: null },
      include: { organization: { select: { settings: true } } },
    });
    if (!user) {
      return NextResponse.json({ error: INVALID, code: "invalid_token" }, { status: 400 });
    }

    // The policy is checked BEFORE the token is spent, so a password the
    // policy refuses leaves the link usable for a second try.
    const pwError = validatePassword(password, policyFromOrgSettings(user.organization?.settings));
    if (pwError) {
      return NextResponse.json({ error: pwError, field: "password" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const changed = await prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, used: false, expiresAt: { gt: new Date() } },
        data: { used: true },
      });
      if (claim.count !== 1) return false;
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, tokenVersion: { increment: 1 }, passwordChangedAt: new Date() },
      });
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: INVALID, code: "invalid_token" }, { status: 400 });
    }

    logAuditEvent({
      type: "password_reset",
      actorId: user.id,
      organizationId: user.organizationId,
      description: "Password reset from an emailed link",
      targetType: "User",
      targetId: user.id,
      ipAddress: ipFromRequest(req),
      userAgent: req.headers.get("user-agent"),
    }).catch(() => {});

    return NextResponse.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
