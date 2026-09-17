"use client";

// SessionExpiredDialog (spec-shell.md section 2.15) + the idle warning
// (section 1.10 rule 4). Mounted ONCE in the dashboard layout, inert until
// `workwrk:session-expired` fires (from apiFetch or the SSE client), then:
//
//   - a 400px Radix Dialog portalled to document.body, outside #app-root
//   - not dismissable: Esc, outside click and the overlay all refuse
//   - #app-root gets `inert` + aria-hidden so the frame leaves the tab order
//     and the accessibility tree while staying visible behind the scrim
//   - one primary, "Sign in again", to /login?callbackUrl=<current>
//
// The sentence about kept drafts renders only when a draft was actually
// flushed (useDraftOnExpiry writes under the workwrk:draft: prefix), and the
// sign-out-all variant renders when the 401 named a revocation.

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";
import {
  IDLE_WARNING_EVENT,
  SESSION_EXPIRED_EVENT,
  SESSION_RENEW_URL,
  currentLoginUrl,
  isSessionExpired,
  markSessionExpired,
  scheduleIdleWarning,
  type IdleWarningDetail,
  type SessionExpiredDetail,
} from "@/lib/session-expiry";

export const APP_ROOT_ID = "app-root";

function anyDraftStored(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("workwrk:draft:")) return true;
    }
  } catch {
    // storage unavailable
  }
  return false;
}

export function SessionExpiredDialog() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SessionExpiredDetail["reason"]>("unknown");
  const [draftKept, setDraftKept] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loginHref, setLoginHref] = useState("/login");

  useEffect(() => {
    const show = (detail?: SessionExpiredDetail) => {
      setReason(detail?.reason ?? "unknown");
      setLoginHref(currentLoginUrl());
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
      setOpen(true);
      // Editors flush their drafts in their own listeners for the same event;
      // look after this tick so the sentence reflects what actually landed.
      window.setTimeout(() => setDraftKept(anyDraftStored()), 0);
    };
    const onExpired = (e: Event) => show((e as CustomEvent<SessionExpiredDetail>).detail);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    // The event may have fired before this component mounted (a boot 401).
    if (isSessionExpired()) show();
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [open]);

  // The only time the shell is inert (spec 2.15): the frame behind the scrim
  // leaves the tab order and the accessibility tree; the dialog does not.
  useEffect(() => {
    const root = document.getElementById(APP_ROOT_ID);
    if (!root) return;
    if (open) {
      root.setAttribute("inert", "");
      root.setAttribute("aria-hidden", "true");
    } else {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    }
    return () => {
      root.removeAttribute("inert");
      root.removeAttribute("aria-hidden");
    };
  }, [open]);

  const refuse = (e: Event) => e.preventDefault();

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[10000] bg-black/40" />
        <DialogPrimitive.Content
          onEscapeKeyDown={refuse}
          onPointerDownOutside={refuse}
          onInteractOutside={refuse}
          aria-describedby="session-expired-body"
          className="fixed left-1/2 top-1/2 z-[10001] w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-[0_30px_80px_-15px_rgba(0,0,0,0.35)] focus:outline-none dark:border-zinc-700 dark:bg-[#14171D] dark:text-zinc-100"
        >
          <DialogPrimitive.Title className="text-lg font-semibold leading-tight">
            You&apos;ve been signed out
          </DialogPrimitive.Title>
          <DialogPrimitive.Description id="session-expired-body" className="mt-2 text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
            {reason === "revoked" ? "You were signed out on every device. " : ""}
            Sign in again to keep working.
            {draftKept ? " Anything you were typing has been kept on this device." : ""}
            {offline ? " You're offline. Sign in when you're back." : ""}
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end">
            <a
              href={loginHref}
              autoFocus
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0073EA] px-4 text-base font-medium text-white hover:bg-[#0060C2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0073EA]/40 focus-visible:ring-offset-2"
            >
              Sign in again
            </a>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Idle warning (spec 1.10 rule 4): one notice two minutes before the session
 * lapses. "Stay signed in" calls GET /api/auth/session, the ONE route that
 * re-issues the session cookie (App Router route handlers run
 * getServerSession without a response, so /api/me and every other route
 * cannot roll the cookie forward; spec 1.10 names /api/me, which does not
 * work here). Armed by `scheduleIdleWarning(idleUntil)` from whoever learns
 * `idleUntil`: today `useSession().data.expires`, which is that same cookie
 * boundary and moves every time the SessionProvider refetches; later
 * /api/boot and the SSE session event. Absent when the org has no idle
 * timeout. Renders nothing until the event fires.
 */
export function SessionIdleWarning() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: session } = useSession();
  const expires = session?.expires ?? null;

  // Arm (and re-arm on every refetch) from the session's own expiry.
  useEffect(() => scheduleIdleWarning(expires), [expires]);

  useEffect(() => {
    const onWarn = (e: Event) => {
      const detail = (e as CustomEvent<IdleWarningDetail>).detail;
      if (!detail?.idleUntil) return;
      if (isSessionExpired()) return;
      setVisible(true);
    };
    const onExpired = () => setVisible(false);
    window.addEventListener(IDLE_WARNING_EVENT, onWarn);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener(IDLE_WARNING_EVENT, onWarn);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, []);

  if (!visible) return null;

  const stay = async () => {
    setBusy(true);
    // /api/auth/session answers 200 with `{}` (never a 401) once the cookie
    // is gone, so an empty answer is the expiry signal here.
    const r = await apiFetch<{ user?: unknown; expires?: string }>(SESSION_RENEW_URL);
    setBusy(false);
    if (!r.ok) return; // offline or a 5xx: keep the notice, the person can try again
    if (!r.data?.user) {
      markSessionExpired({ reason: "expired", source: SESSION_RENEW_URL });
      return;
    }
    setVisible(false);
    scheduleIdleWarning(r.data.expires ?? null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[9000] flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-[#14171D] dark:text-zinc-100"
    >
      <span>You&apos;ll be signed out in 2 minutes</span>
      <button
        type="button"
        onClick={() => void stay()}
        disabled={busy}
        className="rounded-md bg-[#0073EA] px-2.5 py-1 text-sm font-medium text-white hover:bg-[#0060C2] disabled:opacity-60"
      >
        Stay signed in
      </button>
    </div>
  );
}
