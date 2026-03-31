import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { passwordResetTemplate } from "@/lib/email-templates";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      message: "If an account with that email exists, we've sent a password reset link.",
    });

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, firstName: true, email: true, organizationId: true },
    });

    if (!user) return successResponse;

    // Invalidate any existing tokens for this email
    await prisma.passwordResetToken.updateMany({
      where: { email, used: false },
      data: { used: true },
    });

    // Create new token (1 hour expiry)
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        token,
        email,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const resetLink = `${baseUrl}/reset-password?token=${token}`;
    const { subject, html } = passwordResetTemplate({
      resetLink,
      firstName: user.firstName,
    });

    sendEmail({
      to: email,
      subject,
      html,
      template: "password-reset",
      variables: { resetLink, firstName: user.firstName },
      organizationId: user.organizationId,
      category: "invitation", // Always send, bypass preferences
    });

    return successResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
