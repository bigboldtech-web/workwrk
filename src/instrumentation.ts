// Server start hooks (Next.js instrumentation, register runs once per server).
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
}
