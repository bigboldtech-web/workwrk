import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// The security-relevant slice of ActivityLog for the current user.
const SECURITY_TYPES = [
  "login",
  "logout",
  "password_changed",
  "mfa_enabled",
  "mfa_disabled",
  "signed_out_all_devices",
];

/** GET /api/me/security-activity → the signed-in user's recent security events. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const events = await prisma.activityLog.findMany({
    where: { actorId: userId, type: { in: SECURITY_TYPES } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      description: true,
      ipAddress: true,
      severity: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ events });
}
