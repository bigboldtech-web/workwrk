import { NextRequest } from "next/server";
import { cronRefusal } from "@/lib/cron-auth";
import { isMissingUpdatesTable, processDueTalkUpdates } from "@/lib/talk-updates-server";
import { cronJob } from "@/lib/cron-result";

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
 * secret is compared in constant time (src/lib/cron-auth.ts, the door every
 * scheduled job shares). The answer is counts only: no
 * workspace, conversation or person is named. The row is in
 * scripts/CRON-SETUP.md ("Scheduled AI updates in Talk"), NOT INSTALLED
 * until the founder adds it; installing it also sets TALK_UPDATES_CRON=on.
 */
async function handle(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  try {
    const result = await processDueTalkUpdates(new Date(), { limit: 25, budgetMs: 240_000 });
    return Response.json(result);
  } catch (err) {
    if (isMissingUpdatesTable(err)) return Response.json({ error: "not_ready" }, { status: 503 });
    throw err;
  }
}

// Any throw answers 500 and alerts like a failed run (src/lib/cron-result.ts).
export const POST = cronJob("talk-updates", handle);
