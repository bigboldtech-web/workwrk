import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashVerifyToken } from "@/lib/auth/verify-token";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

/**
 * POST /api/auth/verify-email
 * Body: { token }
 * Idempotent: verifying twice is a no-op ({ ok, alreadyVerified }).
 *
 * Tokens are stored hashed from Phase 8 (src/lib/auth/verify-token.ts). A
 * link mailed before that still holds its raw token in the column, so a
 * miss on the hash falls back to the raw value for those rows; they expire
 * within 24 hours of being sent, after which the fallback finds nothing.
 * Answers carry `code` so the page can pick its screen: "invalid" or
 * "expired" (both render "This link has expired" with Send a new link).
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`verify-email:ip:${ipFromRequest(req)}`, { max: 30, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return Response.json({ error: "Too many requests. Try again later.", code: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 256) return Response.json({ error: "This link is not valid.", code: "invalid" }, { status: 400 });

  const select = { id: true, email: true, verifyExpiresAt: true, emailVerifiedAt: true } as const;
  const user =
    (await prisma.user.findUnique({ where: { verifyToken: hashVerifyToken(token) }, select })) ??
    (await prisma.user.findUnique({ where: { verifyToken: token }, select }));
  if (!user) return Response.json({ error: "This link is not valid.", code: "invalid" }, { status: 400 });
  if (user.emailVerifiedAt) return Response.json({ ok: true, alreadyVerified: true, email: user.email });
  if (user.verifyExpiresAt && user.verifyExpiresAt < new Date()) {
    return Response.json({ error: "This link has expired.", code: "expired", email: user.email }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), verifyToken: null, verifyExpiresAt: null },
  });
  return Response.json({ ok: true, email: user.email });
}
