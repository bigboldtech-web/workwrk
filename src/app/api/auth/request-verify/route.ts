import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

/**
 * POST /api/auth/request-verify
 * Body: { email? }
 *
 * Generates a fresh verification token, stores it, sends the email.
 * If called with an active session and no email body, uses the
 * signed-in user's email. Always returns 200 (prevents email
 * enumeration) regardless of whether the account exists.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };

  let email: string | null = body.email?.toLowerCase().trim() || null;
  if (!email) {
    const session = await getServerSession(authOptions);
    email = (session?.user?.email || "").toLowerCase().trim() || null;
  }
  if (!email) return Response.json({ ok: true }); // silent

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, firstName: true, emailVerifiedAt: true },
  });

  if (!user || user.emailVerifiedAt) return Response.json({ ok: true });

  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  await prisma.user.update({
    where: { id: user.id },
    data: { verifyToken: token, verifyExpiresAt: expires },
  });

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const verifyUrl = `${base}/verify-email?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your WorkwrK email",
    html: verifyEmailHtml({ firstName: user.firstName, verifyUrl }),
    template: "verify-email",
    userId: user.id,
    category: "verify",
  }).catch(() => {}); // silent

  return Response.json({ ok: true });
}

function verifyEmailHtml(p: { firstName: string; verifyUrl: string }): string {
  return `<!doctype html>
<html><body style="background:#0a0a0a;margin:0;padding:40px 20px;font-family:-apple-system,system-ui,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px;color:#fafafa;">
    <div style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#d4ff2e;margin-bottom:20px;"></div>
    <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.03em;margin:0 0 12px;">Verify your email, ${escapeHtml(p.firstName)}.</h1>
    <p style="font-size:14px;color:#a0a0a0;line-height:1.55;margin:0 0 24px;">
      Click the button below to confirm <strong style="color:#fafafa">${escapeHtml("it's you")}</strong>. The link expires in 24 hours.
    </p>
    <a href="${p.verifyUrl}" style="display:inline-block;background:#d4ff2e;color:#0a0a0a;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;">Verify email →</a>
    <p style="font-size:12px;color:#707070;margin:32px 0 0;line-height:1.5;">
      If the button doesn't work, paste this into your browser:<br>
      <code style="font-size:11px;color:#d4ff2e;word-break:break-all;">${p.verifyUrl}</code>
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
