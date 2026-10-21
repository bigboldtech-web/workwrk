import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronRefusal } from "@/lib/cron-auth";
import { cronJob } from "@/lib/cron-result";
import { sweepOAuth } from "@/lib/oauth/sweep";

/**
 * Cron endpoint — trims stale rate-limit buckets.
 *
 * `enforceRateLimit` upserts one `ApiKeyRateBucket` row per
 * (apiKey, windowKind, windowKey) tuple. Minute buckets go stale after
 * 60 seconds; day buckets after 24 hours. Left alone, the table grows
 * by one row per API call per minute forever.
 *
 * Deletion policy — conservative, favours cheap:
 *   • MINUTE buckets whose windowKey is older than 24 h
 *     (keeps today's for quick lookups / debugging).
 *   • DAY buckets whose windowKey is older than 30 days
 *     (retained for simple usage history without building a separate
 *     analytics table).
 *
 * Both queries are indexed on `(apiKeyId, windowKind, windowKey)` via
 * the composite unique constraint, so they stay fast even as the table
 * grows between cleanups.
 *
 * Guard with CRON_SECRET in production.
 *
 * It also carries the MCP server's OAuth retention (src/lib/oauth/sweep.ts,
 * docs/plans/mcp-server.md 5.4): expired requests, codes and tokens, grants
 * past their end, revoked grants after 90 days, usage days after 90 days and
 * clients nobody uses. Each of its steps is caught on its own, so a failure
 * there never fails this cleanup (no crontab row of its own).
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  const minuteCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const dayCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [minutes, days] = await Promise.all([
    prisma.apiKeyRateBucket.deleteMany({
      where: { windowKind: "MINUTE", windowKey: { lt: minuteCutoff } },
    }),
    prisma.apiKeyRateBucket.deleteMany({
      where: { windowKind: "DAY", windowKey: { lt: dayCutoff } },
    }),
  ]);

  const oauth = await sweepOAuth(now).catch(() => null);

  return Response.json({
    ran: true,
    at: now.toISOString(),
    deleted: { minute: minutes.count, day: days.count },
    oauth,
  });
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("ratelimit-cleanup", handle);
