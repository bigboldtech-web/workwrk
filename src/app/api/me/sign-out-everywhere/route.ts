import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest } from "@/lib/rate-limit-memory";
import { revokeAllGrantsOf } from "@/lib/oauth/grants";

/**
 * POST /api/me/sign-out-everywhere
 * Bumps tokenVersion, which revokes EVERY live session for this user (other
 * devices, copied cookies, this browser) on their next re-check. The client
 * then signs out locally and returns to /login.
 *
 * AI apps (docs/plans/mcp-server.md 3.9, H1): every app the person connected
 * ends too. The bump alone would end them at their next request (the grant
 * no longer holds the account's tokenVersion); they are revoked here at once
 * as well, so nothing they do lands in between, and the client's own sign
 * out after this (the ordinary signOut event, which carries grants that
 * still match) has none left to carry.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  await revokeAllGrantsOf(user.id, "sessions_ended", user.id).catch(() => {
    console.warn("[oauth] sign_out_everywhere revoke_failed");
  });

  if (user.organizationId) {
    void logAuditEvent({
      type: "signed_out_all_devices",
      actorId: user.id,
      organizationId: user.organizationId,
      description: "Signed out of all devices",
      ipAddress: ipFromRequest(req),
      userAgent: req.headers.get("user-agent"),
      severity: "warning",
    });
  }

  return NextResponse.json({ ok: true });
}
