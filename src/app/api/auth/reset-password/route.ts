import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { validatePassword, policyFromOrgSettings } from "@/lib/password-policy";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    // Tokens are stored hashed (see forgot-password) — hash the submitted raw
    // token the same way to find its row. An attacker with raw DB access holds
    // only hashes, which don't produce a usable reset link.
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: { email: resetToken.email, deletedAt: null },
      include: { organization: { select: { settings: true } } },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Enforce the org's password policy on the new password.
    const pwError = validatePassword(password, policyFromOrgSettings(user.organization?.settings));
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Update password and mark token as used. Bump tokenVersion so any session
    // still holding the OLD credentials (e.g. an attacker who triggered the
    // reset scenario) is invalidated the moment the password changes.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    });

    return NextResponse.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
