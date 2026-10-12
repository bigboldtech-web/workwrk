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

import type { AccessLevel, Prisma, PrismaClient } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

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
 * Pass the anchored row when the caller already read it, and `db` when the
 * read must run inside the caller's transaction.
 */
export async function levelHeldIn(
  userId: string,
  organizationId: string,
  anchored?: { organizationId: string; accessLevel: AccessLevel } | null,
  db: Db = prisma,
): Promise<AccessLevel | null> {
  const row = anchored ?? (await db.user.findUnique({ where: { id: userId }, select: { organizationId: true, accessLevel: true } }));
  if (!row) return null;
  if (row.organizationId === organizationId) return row.accessLevel;
  const held = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return held?.role ?? null;
}

/**
 * The Prisma `where` for "holds a level in this workspace" (anchored here, or
 * a membership here), for a single query that must stay one (a count, a
 * first match). Spread it where the `where` has no OR of its own.
 */
export function inWorkspaceWhere(organizationId: string): { OR: Prisma.UserWhereInput[] } {
  return { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] };
}

/**
 * levelHeldIn for many people at once, in at most two reads: the level each
 * holds in this one workspace. Absent from the answer: anyone who holds
 * neither a row anchored here nor a membership here (or has no row). The
 * membership read runs only for people anchored somewhere else.
 */
export async function levelsHeldIn(organizationId: string, userIds: readonly string[], db: Db = prisma): Promise<Map<string, AccessLevel>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, accessLevel: true } });
  return levelsHeldFor(organizationId, rows, db);
}

/**
 * levelsHeldIn for rows the caller already read (each with its anchored
 * workspace and level), in at most one more read: the memberships of the
 * people anchored somewhere else. THE answer to "is this person in this
 * workspace, and at what level" for every read of reporting lines and the
 * people they count (docs-found fixes batch 5): User.organizationId is only
 * the workspace a person last switched to, on any device, so "anchored here"
 * alone drops everyone who works here and was last somewhere else.
 */
export async function levelsHeldFor(
  organizationId: string,
  rows: ReadonlyArray<{ id: string; organizationId: string; accessLevel: AccessLevel }>,
  db: Db = prisma,
): Promise<Map<string, AccessLevel>> {
  const out = new Map<string, AccessLevel>();
  const elsewhere: string[] = [];
  for (const r of rows) {
    if (r.organizationId === organizationId) out.set(r.id, r.accessLevel);
    else elsewhere.push(r.id);
  }
  if (elsewhere.length > 0) {
    const held = await db.organizationMembership.findMany({ where: { organizationId, userId: { in: [...new Set(elsewhere)] } }, select: { userId: true, role: true } });
    for (const h of held) out.set(h.userId, h.role);
  }
  return out;
}
