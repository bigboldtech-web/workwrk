import { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { isMissingUpdatesTable, processDueTalkUpdates } from "@/lib/talk-updates-server";

/**
 * Cron endpoint: post the scheduled AI updates in Talk that are due (Batch 8).
 *
 * Each due update is claimed by ONE compare-and-swap on its nextRunAt and run
 * under the reach of everyone who reads the conversation
 * (src/lib/talk-updates-server.ts), so an overlapping or retried tick finds
 * the instant already taken and posts nothing.
 *
 * FAIL-CLOSED, like /api/cron/report-schedules: it posts into conversations
 * and sends task content to the AI provider, so with no CRON_SECRET it
 * answers 503 and runs nothing, never for whoever can reach the URL. The
 * secret is compared in constant time. The answer is counts only: no
 * workspace, conversation or person is named. The row is in
 * scripts/CRON-SETUP.md ("Scheduled AI updates in Talk"), NOT INSTALLED
 * until the founder adds it; installing it also sets TALK_UPDATES_CRON=on.
 */
function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  if (!provided || !sameSecret(provided, cronSecret)) return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const result = await processDueTalkUpdates(new Date(), { limit: 25, budgetMs: 240_000 });
    return Response.json(result);
  } catch (err) {
    if (isMissingUpdatesTable(err)) return Response.json({ error: "not_ready" }, { status: 503 });
    throw err;
  }
}
