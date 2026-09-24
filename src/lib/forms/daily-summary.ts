// The words of the form daily summary notification (the form-daily-summary
// cron). Pure, so the tests pin the copy.

export function dailySummaryMessage(formName: string, count: number): { title: string; message: string } {
  const name = formName.trim() || "Untitled form";
  return {
    title: `Daily summary: ${name}`,
    message: count === 1 ? `1 new response in the last 24 hours.` : `${count.toLocaleString("en-US")} new responses in the last 24 hours.`,
  };
}

/**
 * Whether the daily summary's reader is installed: the form-daily-summary
 * cron row (scripts/CRON-SETUP.md) only exists on a box once the founder adds
 * it, and the app cannot see a crontab. So the row's install step also sets
 * FORM_DAILY_SUMMARY_CRON=on in the environment, and until then:
 *   - the builder does not render "Send a daily summary instead"
 *     (settings-architecture 9.1: missing a reader means not rendered);
 *   - a form already set to the summary keeps getting one notification per
 *     response, so nobody on its list silently stops hearing about them.
 * Server only (reads process.env).
 */
export function dailySummaryInstalled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.FORM_DAILY_SUMMARY_CRON ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

/** Whether a response should be notified one by one now: always, unless the
 *  form asked for the summary AND the summary's cron is installed. */
export function notifyEachResponse(settings: { notifyUserIds: string[]; dailySummary: boolean }, installed: boolean): boolean {
  return settings.notifyUserIds.length > 0 && !(settings.dailySummary && installed);
}
