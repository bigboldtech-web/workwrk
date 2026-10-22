"use client";

// A failed session read is not a log out (2026-10-22).
//
// next-auth's SessionProvider reads a failed GET /api/auth/session (offline
// as a laptop wakes, a 502 during a deploy's reload) as NO session: its
// status turns "unauthenticated" with the cookie still good, and it skips
// every later focus refetch while it holds none. The dashboard unmounted on
// that status and went to /login, so a network blip logged people out. This
// asks the session route itself (api-fetch.ts checkSession) before anything
// is treated as logged out:
//   gone     true: the caller goes to /login, as before;
//   live     the provider is asked to read the session again
//            (session-expiry.ts resyncSessionState), and asked again a few
//            seconds on while it still holds none;
//   unknown  offline or a 5xx: asked again when the browser is back online,
//            and with a growing wait (2 seconds up to 30) meanwhile.
// The caller keeps what was open on screen until the answer is "gone".

import { useEffect, useState } from "react";
import { checkSession } from "@/lib/api-fetch";
import { resyncSessionState } from "@/lib/session-expiry";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

/** True only once the session route has confirmed there is no session. */
export function useConfirmedSignOut(status: SessionStatus): boolean {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (status !== "unauthenticated" || typeof window === "undefined") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), Math.min(30_000, 2_000 * 2 ** attempt++));
    };
    const run = async () => {
      const check = await checkSession();
      if (!alive) return;
      if (check.state === "gone") {
        setGone(true);
        return;
      }
      if (check.state === "live") resyncSessionState();
      later();
    };
    const onOnline = () => {
      attempt = 0;
      void run();
    };
    window.addEventListener("online", onOnline);
    void run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [status]);

  return status === "unauthenticated" && gone;
}
