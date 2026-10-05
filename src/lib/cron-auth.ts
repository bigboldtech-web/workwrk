// The one door every scheduled job opens with: each route under /api/cron,
// plus /api/email/send-reminders, which the crontab also calls, and
// /api/email/process, which is not scheduled (scripts/CRON-SETUP.md).
// Server-only (node:crypto).
//
// FAIL-CLOSED. With no CRON_SECRET in the environment (or only whitespace) a
// job answers 503 and runs nothing. Before this file, 11 of the routes under
// /api/cron skipped the check entirely when the secret was unset
// (`if (cronSecret) { ... }`), and 4 more did outside production, so a
// server started without it ran hard deletes and email sends for anybody who
// found the URL. Three routes fell back to NEXTAUTH_SECRET, the key that
// signs every session, as a bearer token (with both unset, two of them
// accepted "Bearer undefined"). And /api/cron/run-due-agents let ANY
// signed-in workspace admin fire every workspace's due agents. Production has CRON_SECRET set (2026-10-04: the
// fail-closed talk-updates route answers 403, not 503, to a request with no
// header), so an installed crontab row sees no change.
//
// CONSTANT TIME. Both sides are hashed to 32 bytes and compared with
// timingSafeEqual, so neither the secret's length nor a matching prefix shows
// in the response time.
//
// EVERY HEADER A ROUTE ACCEPTED BEFORE: `x-cron-secret: <secret>` (what
// scripts/CRON-SETUP.md sends) or `Authorization: Bearer <secret>`. Three
// routes compared a trimmed secret and the rest the raw one, so both forms of
// the configured value are accepted.

import { createHash, timingSafeEqual } from "node:crypto";

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** True when `provided` is the secret, compared in constant time. */
export function cronSecretMatches(provided: string, secret: string): boolean {
  return timingSafeEqual(digest(provided), digest(secret));
}

/** The secret a request carries, or "" when it carries none. */
export function providedCronSecret(headers: Headers): string {
  const header = headers.get("x-cron-secret") ?? headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "");
}

/**
 * Null when the request may run the job; otherwise the response to send
 * (503 with no secret configured, 403 for a missing or wrong one). `env` is a
 * parameter so a test can set it.
 */
export function cronRefusal(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): Response | null {
  const raw = env.CRON_SECRET ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return Response.json({ error: "CRON_SECRET is not set, so scheduled jobs do not run." }, { status: 503 });
  const provided = providedCronSecret(req.headers);
  // Both checks always run, so the time taken never says which form matched.
  const matchesRaw = cronSecretMatches(provided, raw);
  const matchesTrimmed = cronSecretMatches(provided, trimmed);
  if (!provided || !(matchesRaw || matchesTrimmed)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
