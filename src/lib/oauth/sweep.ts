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
//                   it by no less than its grants' 90 days. More than 10,000
//                   unused clients in one run logs a surge line.
// Each step is its own short statement; a step that fails is logged by code
// and never stops the next, nor the cron's own cleanup.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { revokeGrantRows } from "./grants";

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

/** Clients with no grant row at all, registered before `bornBefore` and last consented before `usedBefore` (or never). */
async function sweepClients(bornBefore: Date, usedBefore: Date): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.oAuthClient.findMany({
      where: { createdAt: { lt: bornBefore }, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: usedBefore } }], ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: CLIENT_BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    const ids = batch.map((c) => c.id);
    const held = new Set((await prisma.oAuthGrant.findMany({ where: { clientId: { in: ids } }, select: { clientId: true }, distinct: ["clientId"] })).map((g) => g.clientId));
    const gone = ids.filter((id) => !held.has(id));
    if (gone.length > 0) removed += (await prisma.oAuthClient.deleteMany({ where: { id: { in: gone } } })).count;
    if (batch.length < CLIENT_BATCH) break;
  }
  return removed;
}

export async function sweepOAuth(now: Date = new Date()): Promise<OAuthSweepCounts> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const ninetyAgo = new Date(now.getTime() - 90 * DAY_MS);
  const thirtyAgo = new Date(now.getTime() - 30 * DAY_MS);
  const ninetyDay = ninetyAgo.toISOString().slice(0, 10);

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
  const clients = await step("clients", () => sweepClients(dayAgo, thirtyAgo));
  if (clients > CLIENT_SURGE) console.warn("[oauth] surge clients_swept");
  return { requests, codes, tokens, expired, grants, usageDays, clients };
}
