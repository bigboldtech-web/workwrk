import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { passwordResetTemplate } from "@/lib/email-templates";
import { rateLimit, ipFromRequest } from "@/lib/rate-limit-memory";
import { pickAccountForEmail } from "@/lib/auth";
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

    // Abuse guard: cap reset requests per target email and per source IP so
    // nobody can bomb a victim's inbox with reset mail. Over the limit we return
    // the SAME success message but send nothing — no signal, no email.
    const ip = ipFromRequest(req);
    const perEmail = rateLimit(`forgot:email:${email.toLowerCase()}`, { max: 5, windowMs: 15 * 60 * 1000 });
    const perIp = rateLimit(`forgot:ip:${ip}`, { max: 20, windowMs: 60 * 60 * 1000 });
    if (!perEmail.ok || !perIp.ok) {
      return successResponse;
    }

    // Case-insensitive, like log in (pickAccountForEmail in src/lib/auth.ts):
    // signup keeps the address as typed, so "priya@co.com" must find the
    // account stored as "Priya@Co.com". The exact-case lookup answered
    // "check your inbox" and sent nothing.
    const user = pickAccountForEmail(
      await prisma.user.findMany({
        where: { email: { equals: String(email).trim(), mode: "insensitive" }, deletedAt: null },
        select: { id: true, firstName: true, email: true, organizationId: true },
        take: 10,
      }),
      String(email),
    );

    if (!user) return successResponse;

    // From here on the address is the STORED spelling, never the typed one:
    // reset-password and the password-policy check find the account again
    // with an exact match on the token's email, so a token carrying the
    // typed case would open a link that then says it is invalid.
    // Invalidate any existing tokens for this email
    await prisma.passwordResetToken.updateMany({
      where: { email: user.email, used: false },
      data: { used: true },
    });

    // Create new token (1 hour expiry). Only the SHA-256 HASH is persisted —
    // the raw token lives solely in the emailed link. So a DB leak yields
    // useless hashes, never working reset links (the raw 256-bit value can't
    // be recovered from its hash). reset-password hashes the submitted token
    // the same way to look it up.
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.passwordResetToken.create({
      data: {
        token: tokenHash,
        email: user.email,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;
    const { subject, html } = passwordResetTemplate({
      resetLink,
      firstName: user.firstName,
    });

    try {
      await sendEmail({
        to: user.email,
        subject,
        html,
        template: "password-reset",
        variables: { resetLink, firstName: user.firstName },
        organizationId: user.organizationId,
        category: "invitation", // Always send, bypass preferences
      });
    } catch (emailErr) {
      console.error("[ForgotPassword] Email send failed:", emailErr);
    }

    return successResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
