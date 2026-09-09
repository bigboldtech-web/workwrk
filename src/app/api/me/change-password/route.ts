import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validatePassword, policyFromOrgSettings } from "@/lib/password-policy";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest } from "@/lib/rate-limit-memory";

/**
 * POST /api/me/change-password  { currentPassword, newPassword }
 * Self-service password change for a signed-in user. Verifies the current
 * password, enforces the org policy, and bumps tokenVersion so every OTHER
 * session is signed out. THIS session survives because the client calls
 * session.update() afterward (the jwt "update" branch re-syncs tokenVersion).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json().catch(() => ({}));
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { settings: true } } },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentOk) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
  }

  const pwError = validatePassword(newPassword, policyFromOrgSettings(user.organization?.settings));
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "New password must be different from your current one." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  void logAuditEvent({
    type: "password_changed",
    actorId: userId,
    organizationId: user.organizationId,
    description: "Password changed",
    ipAddress: ipFromRequest(req),
    userAgent: req.headers.get("user-agent"),
    severity: "warning",
  });

  return NextResponse.json({
    ok: true,
    message: "Password updated. Your other devices have been signed out.",
  });
}
