// Server start hooks (Next.js instrumentation, register runs once per server).
//
// Local uploads are moved out of public/ (src/lib/local-uploads.ts); a file
// is removed from public/uploads only once storage/uploads holds the same
// bytes, never overwritten, and the uploads route reads both meanwhile.
//
// The Staff console owes customers the audit rows it could not write while
// ActivityLog had no actorType or actorLabel (src/lib/staff-audit.ts). The
// replay is a no-op until those columns exist, never blocks the server from
// becoming ready, and never throws.
//
// AI teammates' browsers the boot before this one held (browser host final
// review, contract M2; src/lib/browser/sessions.ts recoverBrowsersAtBoot)
// are ended and their releases tried BROWSER_RECOVERY_DELAY_MS after the
// server starts, not at the next cron tick up to 10 minutes on. On an
// unref'd timer, so it never holds the server from becoming ready or from
// exiting, and late enough that a process the deploy is stopping has gone,
// so no step it is finishing is cut short. The module is loaded only then.

/** How long after the server starts the browsers' boot recovery runs (instrumentation.test.ts holds it). */
const BROWSER_RECOVERY_DELAY_MS = 15_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void import("@/lib/staff-audit")
    .then((m) => m.startOwedReplay())
    .catch((err) => console.error("[instrumentation] staff audit replay did not start:", err));
  // Local uploads leave public/, where Next served them by itself
  // (src/lib/local-uploads.ts). Once every file is across this finds nothing.
  void import("@/lib/local-uploads")
    .then((m) => m.moveLegacyUploads())
    .then(({ moved, left }) => {
      if (moved || left) console.info(`[uploads] moved ${moved} files out of public/uploads${left ? `, ${left} left where they are` : ""}`);
    })
    .catch((err) => console.error("[instrumentation] moving uploads out of public/ did not run:", err));
  const recovery = setTimeout(() => {
    void import("@/lib/browser/sessions")
      .then((m) => m.recoverBrowsersAtBoot())
      .catch((err) => console.error("[instrumentation] the browsers' boot recovery did not run:", err));
  }, BROWSER_RECOVERY_DELAY_MS);
  recovery.unref?.();
}
