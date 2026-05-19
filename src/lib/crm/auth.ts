// Shared auth helper for /api/crm/* routes. Returns the active user's
// orgId or a 401/400 NextResponse to short-circuit.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function resolveCrmContext() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user?.organizationId) {
    return { error: NextResponse.json({ error: "no organization" }, { status: 400 }) };
  }
  return { userId: user.id, orgId: user.organizationId, accessLevel: user.accessLevel };
}
