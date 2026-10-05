import { NextRequest } from "next/server";
import { processEmailQueue } from "@/lib/email";
import { jsonSuccess } from "@/lib/api-helpers";
import { cronRefusal } from "@/lib/cron-auth";

// POST: Process the email queue (can be called by cron or manually)
// Secured by a simple API key check
export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const result = await processEmailQueue();
  return jsonSuccess(result);
}
