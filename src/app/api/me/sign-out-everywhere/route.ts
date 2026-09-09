import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/activity";
import { ipFromRequest } from "@/lib/rate-limit-memory";

/**
 * POST /api/me/sign-out-everywhere
 * Bumps tokenVersion, which revokes EVERY live session for this user (other
 * devices, copied cookies, this browser) on their next re-check. The client
 * then signs out locally and returns to /login.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
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
