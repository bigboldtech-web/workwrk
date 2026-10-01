import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashVerifyToken } from "@/lib/auth/verify-token";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

/**
 * POST /api/auth/verify-email
 * Body: { token }
 * Idempotent: verifying twice is a no-op ({ ok, alreadyVerified }).
 *
 * A used link stays recognisable. Success keeps the token's hash in the
 * column and sets only emailVerifiedAt, so opening the same email again (a
 * second tap, or a mail scanner that opened it first) finds the row and
 * answers "already verified" instead of "not valid". Keeping the hash is
 * safe: it can only confirm an address that is already confirmed,
 * request-verify never re-issues for a verified address, and
 * sendVerificationEmail replaces it whenever a new link is sent.
 * verifyExpiresAt is cleared on success and marks the link as SPENT: a row
 * with a token and no expiry is a used link, never a live one (every writer
 * sets an expiry). That matters once SCIM renames the address and clears
 * emailVerifiedAt (a renamed address is not a proven one): the old link,
 * sitting in the OLD inbox, must not confirm the new address, so a spent
 * link on an unverified row answers "invalid" and names no address.
 *
 * Tokens are stored hashed from Phase 8 (src/lib/auth/verify-token.ts). A
 * link mailed before that still holds its raw token in the column, so a
 * miss on the hash falls back to the raw value for those rows; they expire
 * within 24 hours of being sent, after which the fallback finds nothing.
 * The fallback never accepts a value shaped like a stored hash (64 hex
 * characters): old raw tokens are 32 base64url characters, so the hash read
 * out of a leaked row or a backup can never verify an address by itself.
 * Answers carry `code` so the page can pick its screen: "expired" renders
 * "This link has expired" with Send a new link; "invalid" (made up, replaced
 * by a newer link, or spent) renders "This link is not valid or was already
 * used" with Log in and Send a new link, because a person who already
 * confirmed must not be told they still need a link.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`verify-email:ip:${ipFromRequest(req)}`, { max: 30, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return Response.json({ error: "Too many requests. Try again later.", code: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 256) return Response.json({ error: "This link is not valid.", code: "invalid" }, { status: 400 });

  const select = { id: true, email: true, verifyExpiresAt: true, emailVerifiedAt: true, deletedAt: true } as const;
  const looksLikeStoredHash = /^[0-9a-f]{64}$/i.test(token);
  const user =
    (await prisma.user.findUnique({ where: { verifyToken: hashVerifyToken(token) }, select })) ??
    (looksLikeStoredHash ? null : await prisma.user.findUnique({ where: { verifyToken: token }, select }));
  // A deleted account's link is dead: its address is anonymised and must
  // not be echoed back or confirmed.
  if (!user || user.deletedAt) return Response.json({ error: "This link is not valid.", code: "invalid" }, { status: 400 });
  if (user.emailVerifiedAt) return Response.json({ ok: true, alreadyVerified: true, email: user.email });
  // No expiry on a stored token means a spent link (see above): the address
  // was confirmed with it and has since been renamed, so it proves nothing.
  if (!user.verifyExpiresAt) return Response.json({ error: "This link is not valid.", code: "invalid" }, { status: 400 });
  if (user.verifyExpiresAt < new Date()) {
    return Response.json({ error: "This link has expired.", code: "expired", email: user.email }, { status: 400 });
  }

  // Keep the token as its hash (an old raw-token row is moved to the hash
  // here too, so nothing raw stays at rest) and clear the expiry to mark it
  // spent. The emailVerifiedAt guard in `where` makes a second, racing tap
  // a no-op instead of moving the verified time.
  await prisma.user.updateMany({
    where: { id: user.id, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date(), verifyToken: hashVerifyToken(token), verifyExpiresAt: null },
  });
  return Response.json({ ok: true, email: user.email });
}
