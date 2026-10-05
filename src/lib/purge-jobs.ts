// The two clean-up jobs that are NOT installed until the founder turns them
// on (scripts/CRON-SETUP.md): emptying Trash after its window, and clearing
// read Inbox items after the person's chosen days. Until each is on, the
// product never promises what it does: Trash shows no countdown, no "Under 7
// days left" filter and no "Time left" sort, and the Inbox offers no
// auto-clear. Turning one on (TRASH_PURGE_CRON=on, INBOX_AUTO_CLEAR_CRON=on
// in the app's .env, with its crontab row) brings them back, and the job
// itself runs for real only then (a dry run always works).
//
// Pure: reads only the environment, so the API, the boot payload and the
// jobs agree.

/**
 * The day the Trash purge was turned on (TRASH_PURGE_SINCE, YYYY-MM-DD, set
 * with TRASH_PURGE_CRON=on). While the purge was off the product said Trash
 * keeps everything, so a row deleted before that day starts its window on
 * that day, never on its deletion: turning the purge on never empties a
 * workspace's whole backlog the first night.
 */
export function trashPurgeSince(env: Record<string, string | undefined> = process.env): Date | null {
  const v = (env.TRASH_PURGE_SINCE ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Trash empties itself after the workspace's window (/api/cron/trash-purge): on, with the day it was turned on. */
export function trashPurgeOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRASH_PURGE_CRON === "on" && trashPurgeSince(env) !== null;
}

/** When a Trash row's window starts: its deletion, or the day the purge was turned on if that is later. */
export function trashClockStart(deletedAt: Date, env: Record<string, string | undefined> = process.env): Date {
  const since = trashPurgeSince(env);
  return since && since.getTime() > deletedAt.getTime() ? since : deletedAt;
}

/** Read Inbox items clear after the person's chosen days (/api/cron/inbox-auto-clear). */
export function inboxAutoClearOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.INBOX_AUTO_CLEAR_CRON === "on";
}
