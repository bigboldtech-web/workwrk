import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/auth/verify-email
 * Body: { token }
 * Idempotent — verifying twice is a no-op.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return Response.json({ error: "token required" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { verifyToken: body.token },
    select: { id: true, verifyExpiresAt: true, emailVerifiedAt: true },
  });
  if (!user) return Response.json({ error: "Invalid or expired token" }, { status: 400 });
  if (user.emailVerifiedAt) return Response.json({ ok: true, alreadyVerified: true });
  if (user.verifyExpiresAt && user.verifyExpiresAt < new Date()) {
    return Response.json({ error: "Token expired — request a new link" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      verifyToken: null,
      verifyExpiresAt: null,
    },
  });
  return Response.json({ ok: true });
}
