// My settings, Calendar & connections, AI apps (docs/plans/mcp-server.md
// 6.2, 3.9, 5.3): the person's own connections, their changes, and
// Disconnect. Read by /api/me/connected-apps and its [id] routes.
//
// ONLY LIVE GRANTS ARE SHOWN, AND ONLY THE PERSON'S OWN. liveGrantsOf reads
// the person's unrevoked grants and puts each through the bearer check's own
// standing (src/lib/oauth/eligibility.ts enforceStanding, 3.8 steps 3 to
// 10): a grant past its endsBy, of a disabled client, refused by the switch
// or the allowed apps, in a closed workspace, left behind by a tokenVersion
// bump (sessions_ended), for a person who left or may not use AI apps there,
// or older than a password change or a Sign everyone out, is revoked with
// its reason (and its audit row) and never listed. A grant AI off or a hold
// only blocks stays listed, saying so.
//
// ITS CHANGES are the app's audit rows (src/lib/mcp/registry.ts auditWrite):
// type mcp.tool.<tool>, the person as actor, metadata.grantId the grant.
// Counted and listed by those, so the count and the list always agree. Never
// a title or what was written: the row holds neither.
//
// EACH GRANT IS JUDGED FROM A FRESH READ, taken just before its check, and a
// revocation lands only on the row as it was judged (review of step 4, M2):
// a log out in another browser or a reconnect a moment before the check is
// judged again, never revoked as an ended connection.
//
// DISCONNECT revokes the person's own grant (reason "person"): under the
// person's lock (73_050, the lock a consent and the ordinary log out hold),
// the grant is read again and revoked with its tokens in one transaction,
// so a reconnect never lands half way through it; then, once committed, one
// mcp.app.revoked audit row, which the person's security activity lists.
// Another person's grant, or one already ended, is not found.
//
// Server-only.

import { PERSON_LOCK_CLASS, auditRevocations, revokeWhereOn } from "@/lib/oauth/grants";
import { STANDING_GRANT_SELECT, enforceStanding, type StandingGrant } from "@/lib/oauth/eligibility";
import { prisma } from "@/lib/prisma";

/** At most this many of the person's unrevoked grants are checked in one read (20 can be live; the rest are ended as they are read). */
export const CONNECTED_READ_MAX = 100;
/** "Show changes" lists at most this many, newest first. */
export const CHANGES_SHOWN_MAX = 50;

export interface ConnectedApp {
  id: string;
  /** The label frozen at consent (src/lib/oauth/app-label.ts). */
  app: string;
  workspace: { id: string; name: string };
  access: "read" | "write";
  connectedAt: string;
  lastUsedAt: string | null;
  /** How many changes it made: its mcp.tool.* audit rows. */
  changes: number;
  /** What stops it working now without ending it (AI off, a hold). */
  blocked: "ai_off" | "mfa" | "password" | null;
}

export interface ConnectedAppChange {
  id: string;
  tool: string;
  description: string;
  at: string;
  /** Where the person can open what it changed, when that is a task or a doc. */
  href: string | null;
}

/** The audit rows of one grant's changes, the person's own. */
function changesWhere(userId: string, grantId: string) {
  return { actorId: userId, actorType: "mcp", type: { startsWith: "mcp.tool." }, metadata: { path: ["grantId"], equals: grantId } };
}

/**
 * The person's live connections, newest consent first, each read through the
 * bearer check's standing: a grant that no longer stands is revoked with its
 * reason and left out (see the header).
 */
export async function liveGrantsOf(userId: string, now: Date = new Date()): Promise<ConnectedApp[]> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ authorizedAt: "desc" }, { id: "asc" }],
    take: CONNECTED_READ_MAX,
    select: { id: true, clientId: true },
  });
  if (rows.length === 0) return [];
  const clients = await prisma.oAuthClient.findMany({ where: { id: { in: [...new Set(rows.map((g) => g.clientId))] } }, select: { id: true, disabledAt: true } });
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const standing: Array<{ grant: StandingGrant; blocked: ConnectedApp["blocked"] }> = [];
  for (const { id, clientId } of rows) {
    const client = clientById.get(clientId);
    // A grant's client goes only with it (the foreign key cascades): none means none to show.
    if (!client) continue;
    // Read fresh, just before its check (M2): never a row read before the checks of the ones ahead of it.
    const read = await prisma.oAuthGrant.findUnique({ where: { id }, select: STANDING_GRANT_SELECT });
    if (!read || read.revokedAt || read.userId !== userId) continue;
    const s = await enforceStanding(read, client, now);
    // The grant as it was judged, read again if it moved since.
    if (s.ok) standing.push({ grant: s.grant, blocked: s.blocked });
  }
  if (standing.length === 0) return [];
  // Newest consent first, by the grants as they were judged (a reconnect a moment ago moves to the top).
  standing.sort((a, b) => b.grant.authorizedAt.getTime() - a.grant.authorizedAt.getTime() || (a.grant.id < b.grant.id ? -1 : a.grant.id > b.grant.id ? 1 : 0));

  const orgs = await prisma.organization.findMany({ where: { id: { in: [...new Set(standing.map((x) => x.grant.organizationId))] } }, select: { id: true, name: true } });
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const counts = await Promise.all(standing.map(({ grant }) => prisma.activityLog.count({ where: changesWhere(userId, grant.id) })));
  return standing.map(({ grant, blocked }, i) => ({
    id: grant.id,
    app: grant.appName,
    workspace: { id: grant.organizationId, name: orgName.get(grant.organizationId)?.trim() || "" },
    access: grant.scopes.includes("mcp:write") ? "write" : "read",
    connectedAt: grant.authorizedAt.toISOString(),
    lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
    changes: counts[i],
    blocked,
  }));
}

/** One of the person's own unrevoked grants, or null (another person's id, or one already ended). */
async function ownGrant(userId: string, grantId: string): Promise<{ id: string } | null> {
  if (!grantId || grantId.length > 200) return null;
  return prisma.oAuthGrant.findFirst({ where: { id: grantId, userId, revokedAt: null }, select: { id: true } });
}

/** Where the person opens what a change touched: a task or a doc; nothing else has a page of its own. */
function hrefOf(targetType: string | null, targetId: string | null): string | null {
  if (!targetId) return null;
  if (targetType === "item") return `/item/${encodeURIComponent(targetId)}`;
  if (targetType === "doc") return `/work/docs/${encodeURIComponent(targetId)}`;
  return null;
}

/** "Show changes": the newest CHANGES_SHOWN_MAX changes of one of the person's own connections, or null when it is not theirs. */
export async function connectedAppChanges(userId: string, grantId: string): Promise<{ changes: ConnectedAppChange[]; more: boolean } | null> {
  const grant = await ownGrant(userId, grantId);
  if (!grant) return null;
  const rows = await prisma.activityLog.findMany({
    where: changesWhere(userId, grant.id),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHANGES_SHOWN_MAX + 1,
    select: { id: true, type: true, description: true, targetType: true, targetId: true, createdAt: true },
  });
  return {
    changes: rows.slice(0, CHANGES_SHOWN_MAX).map((r) => ({
      id: r.id,
      tool: r.type.slice("mcp.tool.".length),
      description: r.description,
      at: r.createdAt.toISOString(),
      href: hrefOf(r.targetType, r.targetId),
    })),
    more: rows.length > CHANGES_SHOWN_MAX,
  };
}

/**
 * Disconnect: the person's own grant revoked ("person"), with its tokens, read
 * again and revoked under the person's lock in one transaction (review of
 * step 4, L1), then its one audit row once committed. False when it is not
 * theirs or already ended.
 */
export async function disconnectApp(userId: string, grantId: string): Promise<boolean> {
  if (!grantId || grantId.length > 200) return false;
  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERSON_LOCK_CLASS}::int, hashtext(${userId}))`;
    return revokeWhereOn(tx, { id: grantId, userId }, "person", userId, now);
  });
  await auditRevocations(done, "person", userId);
  return done.length === 1;
}
