// Shared auth helper for product-suite API routes (Marketing, Dev,
// Legal, Support, ...). Mirrors src/lib/crm/auth.ts + src/lib/itsm/auth.ts
// but generic — every new suite can import this and skip writing its own.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { actingWorkspace } from "@/lib/access/acting-workspace";

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
  // The workspace this session is ACTING in (src/lib/access/acting-workspace.ts,
  // the rule the jwt revalidation applies). Without it, a person signed in to
  // two workspaces on two devices had the docs, timers and uploads of one
  // workspace while every other route served the other, and an upload was
  // stamped with the wrong company.
  const sessionOrgId = (session.user as { organizationId?: string }).organizationId ?? null;
  const acting = await actingWorkspace(user, sessionOrgId);
  // sessionOrgId is the workspace the token names: it differs from orgId only
  // when the person holds no place there any more (src/app/api/upload tells
  // that apart from a tab left on another workspace).
  return { userId: user.id, orgId: acting.organizationId, accessLevel: acting.accessLevel, sessionOrgId };
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
  return { userId: viewer.userId, orgId: viewer.orgId, accessLevel: viewer.accessLevel, sessionOrgId: viewer.sessionOrgId };
}
