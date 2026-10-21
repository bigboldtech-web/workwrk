// The OAuth server's retention (docs/plans/mcp-server.md 5.3, 5.4), run by
// the rate-limit cleanup cron (src/app/api/cron/ratelimit-cleanup, nightly
// at 03:00 per scripts/CRON-SETUP.md).
//
//   requests        once expired (a decision deletes its own at once);
//   codes           a day after they expire;
//   tokens          a day after they expire (rotation prunes as it goes);
//   grants          an unrevoked one past endsBy is revoked `expired`; a
//                   revoked one is deleted 90 days after, with its codes,
//                   tokens and daily counts (CASCADE);
//   usage days      after 90 days;
//   clients         never granted: 24 hours after registering; granted once:
//                   once no grant of theirs is left and 30 days after their
//                   last consent (lastUsedAt), so a client's counts outlive
//                   it by no less than its grants' 90 days. Never one touched
//                   in the last hour (an authorization request made for it),
//                   and each delete re-checks under the client's lock
//                   (73_052), the lock a consent landing on it holds, so a
//                   consent can never lose its client between the person's
//                   Allow and the grant (review of step 1). Run before the
//                   requests are swept, so a request that just expired still
//                   counts as a touch. More than 10,000 unused clients in one
//                   run logs a surge line.
// Each step is its own short statement; a step that fails is logged by code
// and never stops the next, nor the cron's own cleanup.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { CLIENT_LOCK_CLASS, revokeGrantRows } from "./grants";

const DAY_MS = 86_400_000;
const CLIENT_BATCH = 1000;
const CLIENT_SURGE = 10_000;

export interface OAuthSweepCounts {
  requests: number;
  codes: number;
  tokens: number;
  expired: number;
  grants: number;
  usageDays: number;
  clients: number;
}

async function step(name: string, run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch {
    console.warn(`[oauth] sweep ${name}_failed`);
    return 0;
  }
}

const unusedWhere = (bornBefore: Date, usedBefore: Date) => ({ createdAt: { lt: bornBefore }, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: usedBefore } }] });

/**
 * Clients with no grant row at all, registered before `bornBefore`, last
 * consented before `usedBefore` (or never), and with no authorization request
 * made since `touchedSince`. Each is deleted in its own short transaction
 * under its lock, after the same checks again.
 */
async function sweepClients(bornBefore: Date, usedBefore: Date, touchedSince: Date): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.oAuthClient.findMany({
      where: { ...unusedWhere(bornBefore, usedBefore), ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: CLIENT_BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    const ids = batch.map((c) => c.id);
    const held = new Set((await prisma.oAuthGrant.findMany({ where: { clientId: { in: ids } }, select: { clientId: true }, distinct: ["clientId"] })).map((g) => g.clientId));
    const touched = new Set(
      (await prisma.oAuthAuthorizationRequest.findMany({ where: { clientId: { in: ids }, createdAt: { gt: touchedSince } }, select: { clientId: true }, distinct: ["clientId"] })).map((r) => r.clientId),
    );
    for (const id of ids.filter((x) => !held.has(x) && !touched.has(x))) {
      removed += await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLIENT_LOCK_CLASS}::int, hashtext(${id}))`;
        if ((await tx.oAuthGrant.count({ where: { clientId: id } })) > 0) return 0;
        if ((await tx.oAuthAuthorizationRequest.count({ where: { clientId: id, createdAt: { gt: touchedSince } } })) > 0) return 0;
        return (await tx.oAuthClient.deleteMany({ where: { id, ...unusedWhere(bornBefore, usedBefore) } })).count;
      });
    }
    if (batch.length < CLIENT_BATCH) break;
  }
  return removed;
}

export async function sweepOAuth(now: Date = new Date()): Promise<OAuthSweepCounts> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const ninetyAgo = new Date(now.getTime() - 90 * DAY_MS);
  const thirtyAgo = new Date(now.getTime() - 30 * DAY_MS);
  const ninetyDay = ninetyAgo.toISOString().slice(0, 10);

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  // Clients first: a request that just expired still marks its client as touched.
  const clients = await step("clients", () => sweepClients(dayAgo, thirtyAgo, hourAgo));
  const requests = await step("requests", async () => (await prisma.oAuthAuthorizationRequest.deleteMany({ where: { expiresAt: { lte: now } } })).count);
  const codes = await step("codes", async () => (await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } })).count);
  const tokens = await step("tokens", async () => (await prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } })).count);
  const expired = await step("expired", async () => {
    const past = await prisma.oAuthGrant.findMany({
      where: { revokedAt: null, endsBy: { lte: now } },
      select: { id: true, clientId: true, organizationId: true, userId: true, appName: true, redirectHost: true },
      take: 5000,
    });
    return (await revokeGrantRows(past, "expired", null, now)).length;
  });
  const grants = await step("grants", async () => (await prisma.oAuthGrant.deleteMany({ where: { revokedAt: { lt: ninetyAgo } } })).count);
  const usageDays = await step("usage", async () => (await prisma.mcpUsageDay.deleteMany({ where: { day: { lt: ninetyDay } } })).count);
  if (clients > CLIENT_SURGE) console.warn("[oauth] surge clients_swept");
  return { requests, codes, tokens, expired, grants, usageDays, clients };
}
