// GET /api/auth/password-policy[?token=] (spec-account-auth `/signup`,
// `/join`, `/reset-password`): the password rules a person will be held to,
// so the checklist under the field shows them BEFORE they submit (B8).
//
//   no token          the platform default (a brand new workspace has no
//                     policy yet): /signup.
//   ?token=<invite>   the inviting workspace's policy: /join.
//   ?token=<reset>    the policy of the workspace the reset link's account
//                     belongs to, plus `valid` and the address, so
//                     /reset-password can show "For {email}" or its
//                     "not valid any more" screen before anyone types.
//
// Unauthenticated by design (these pages have no session). It reveals no
// more than the token already proves: the holder of a reset or invitation
// link is the person it was mailed to. Rate limited per IP so it is not a
// token oracle; over the limit it answers the platform default, the same
// shape as an unknown token.

import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { policyFromOrgSettings } from "@/lib/password-policy";
import { policyView } from "@/lib/auth/password-rules";
import { ipFromRequest, rateLimit } from "@/lib/rate-limit-memory";

export const dynamic = "force-dynamic";

function reply(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() || "";
  const platform = policyView();
  if (!token) return reply({ policy: platform, kind: "platform" });
  if (token.length > 256) return reply({ policy: platform, kind: "unknown", valid: false });

  const limit = rateLimit(`password-policy:ip:${ipFromRequest(req)}`, { max: 60, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return reply({ policy: platform, kind: "unknown", valid: false });

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: { accepted: true, expiresAt: true, organization: { select: { settings: true } } },
  });
  if (invitation) {
    const valid = !invitation.accepted && invitation.expiresAt > new Date();
    return reply({ policy: policyView(policyFromOrgSettings(invitation.organization?.settings)), kind: "invitation", valid });
  }

  // Reset tokens are stored hashed (src/app/api/auth/forgot-password).
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const reset = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });
  if (reset) {
    const valid = !reset.used && reset.expiresAt > new Date();
    if (!valid) return reply({ policy: platform, kind: "reset", valid: false });
    const user = await prisma.user.findFirst({
      where: { email: reset.email, deletedAt: null },
      select: { organization: { select: { settings: true } } },
    });
    return reply({
      policy: policyView(policyFromOrgSettings(user?.organization?.settings)),
      kind: "reset",
      valid: !!user,
      email: user ? reset.email : undefined,
    });
  }

  return reply({ policy: platform, kind: "unknown", valid: false });
}
