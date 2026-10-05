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
}
