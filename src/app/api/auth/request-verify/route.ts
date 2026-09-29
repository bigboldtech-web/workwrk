import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";
import { sendVerificationEmail } from "@/lib/auth/send-verification";

/**
 * POST /api/auth/request-verify
 * Body: { email? }
 *
 * Sends a fresh "Confirm your email" link (spec-account-auth `/verify-email`
 * states 4 and 5). Signed out, it takes { email } from the body (the
 * /verify-email?resend=1 screen and an expired link); signed in with no
 * body, it uses the session's own address (My settings).
 *
 * Always answers 200 { ok: true }, whether or not the address has an
 * account, is already verified or is over its limit, so it never tells a
 * stranger which addresses exist. Rate limited per address (3 an hour) and
 * per IP (10 an hour); over either limit nothing is sent. The token is
 * stored hashed (src/lib/auth/verify-token.ts) and replaces any older one.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };

  let email: string | null = typeof body.email === "string" ? body.email.toLowerCase().trim() || null : null;
  if (!email) {
    const session = await getServerSession(authOptions);
    email = (session?.user?.email || "").toLowerCase().trim() || null;
  }
  if (!email || !email.includes("@") || email.length > 254) return Response.json({ ok: true });

  const perIp = rateLimit(`verify:ip:${ipFromRequest(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
  const perEmail = rateLimit(`verify:email:${email}`, { max: 3, windowMs: 60 * 60 * 1000 });
  if (!perIp.ok || !perEmail.ok) return Response.json({ ok: true });

  // Addresses are stored as typed; match case-insensitively so the person
  // who signed up as "Priya@Co.com" and types "priya@co.com" still gets it.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, firstName: true, organizationId: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return Response.json({ ok: true });

  await sendVerificationEmail(user).catch((err) => console.error("[request-verify] send failed", err));
  return Response.json({ ok: true });
}
