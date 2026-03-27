import { NextRequest } from "next/server";
import { processEmailQueue } from "@/lib/email";
import { jsonSuccess, jsonError } from "@/lib/api-helpers";

// POST: Process the email queue (can be called by cron or manually)
// Secured by a simple API key check
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", 401);
  }

  const result = await processEmailQueue();
  return jsonSuccess(result);
}
