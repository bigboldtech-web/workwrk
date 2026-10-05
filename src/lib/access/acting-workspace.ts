// The workspace a signed-in session acts in, and the level it holds there.
//
// A person can belong to several workspaces. User.organizationId is only the
// one they are anchored to: the last one they switched to, on any device. A
// token on another device keeps acting in the workspace it was in for as long
// as that workspace is healthy and the person still holds a membership there
// (the jwt revalidation, src/lib/auth.ts). Every read of "the viewer" has to
// follow that same rule, or one device opens a doc in one workspace and its
// sharing dialog, block comments or uploads in another.
//
// Read fresh from the database, so a stale token never widens anyone: the
// anchored workspace at User.accessLevel, or the session's own workspace at
// the role its membership holds now, never the anchor's level there. With no
// membership in the session's workspace, the anchored one.

import type { AccessLevel } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

export interface ActingWorkspace {
  organizationId: string;
  accessLevel: AccessLevel;
}

export async function actingWorkspace(
  user: { id: string; organizationId: string; accessLevel: AccessLevel },
  sessionOrganizationId: string | null | undefined,
): Promise<ActingWorkspace> {
  if (sessionOrganizationId && sessionOrganizationId !== user.organizationId) {
    const held = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: sessionOrganizationId } },
      select: { role: true },
    });
    if (held) return { organizationId: sessionOrganizationId, accessLevel: held.role };
  }
  return { organizationId: user.organizationId, accessLevel: user.accessLevel };
}

/**
 * The level a person holds in ONE workspace, read fresh: their own level
 * where they are anchored, the role their membership there holds anywhere
 * else, and null where they hold neither. Never the anchored workspace's
 * level in another one: a person who is an Admin of a workspace they just
 * created, and works in a company where they are a Member, is a Member there.
 * Pass the anchored row when the caller already read it.
 */
export async function levelHeldIn(
  userId: string,
  organizationId: string,
  anchored?: { organizationId: string; accessLevel: AccessLevel } | null,
): Promise<AccessLevel | null> {
  const row = anchored ?? (await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true } }));
  if (!row) return null;
  if (row.organizationId === organizationId) return row.accessLevel;
  const held = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return held?.role ?? null;
}
