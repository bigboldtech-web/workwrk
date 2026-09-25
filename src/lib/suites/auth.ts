// Shared auth helper for product-suite API routes (Marketing, Dev,
// Legal, Support, ...). Mirrors src/lib/crm/auth.ts + src/lib/itsm/auth.ts
// but generic — every new suite can import this and skip writing its own.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * The session, then the DB user row: exactly what resolveSuiteContext has
 * always read, without the HTTP responses. The Work routes' gate
 * (src/lib/work/placement-server.ts) places a doc or a canvas with it, so a
 * Work address answers with the same viewer, the same level and the same
 * gates as GET /api/docs/[id] and GET /api/whiteboards/[id].
 * Pass a session the caller already holds to skip the second read.
 */
export async function loadSuiteViewer(held?: Session | null) {
  const session = held === undefined ? await getServerSession(authOptions) : held;
  if (!session?.user) return { error: "unauthorized" as const };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { error: "unauthorized" as const };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, accessLevel: true },
  });
  if (!user?.organizationId) return { error: "no organization" as const };
  return { userId: user.id, orgId: user.organizationId, accessLevel: user.accessLevel };
}

/** The viewer every suite route gates with. */
export type SuiteViewer = Exclude<Awaited<ReturnType<typeof loadSuiteViewer>>, { error: string }>;

export async function resolveSuiteContext() {
  const viewer = await loadSuiteViewer();
  if ("error" in viewer) {
    return viewer.error === "no organization"
      ? { error: NextResponse.json({ error: "no organization" }, { status: 400 }) }
      : { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { userId: viewer.userId, orgId: viewer.orgId, accessLevel: viewer.accessLevel };
}
