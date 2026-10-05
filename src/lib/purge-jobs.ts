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

/** Trash empties itself after the workspace's window (/api/cron/trash-purge). */
export function trashPurgeOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRASH_PURGE_CRON === "on";
}

/** Read Inbox items clear after the person's chosen days (/api/cron/inbox-auto-clear). */
export function inboxAutoClearOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.INBOX_AUTO_CLEAR_CRON === "on";
}
