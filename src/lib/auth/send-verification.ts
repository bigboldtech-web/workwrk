// Send (or re-send) the "Confirm your email" message to one account. The one
// writer of User.verifyToken: a fresh token replaces any earlier one, so
// only the newest link works. Used by POST /api/auth/register (the first
// email, B11) and POST /api/auth/request-verify (resend). Server-only.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { verifyEmailTemplate } from "@/lib/email-templates";
import { newVerifyToken } from "./verify-token";

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export async function sendVerificationEmail(user: { id: string; email: string; firstName: string; organizationId?: string | null }): Promise<void> {
  const token = newVerifyToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyToken: token.hash, verifyExpiresAt: token.expiresAt },
  });
  const verifyUrl = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token.raw)}`;
  const { subject, html } = verifyEmailTemplate({ firstName: user.firstName, verifyUrl });
  await sendEmail({
    to: user.email,
    subject,
    html,
    template: "verify-email",
    userId: user.id,
    organizationId: user.organizationId ?? undefined,
    category: "verify",
  });
}
