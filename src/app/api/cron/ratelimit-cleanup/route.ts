import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

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
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

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

  return Response.json({
    ran: true,
    at: now.toISOString(),
    deleted: { minute: minutes.count, day: days.count },
  });
}
