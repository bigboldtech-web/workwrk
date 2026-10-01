"use client";

// SessionExpiredDialog (spec-shell.md section 2.15) + the idle warning
// (section 1.10 rule 4). Mounted ONCE in the dashboard layout, inert until
// `workwrk:session-expired` fires (from apiFetch or the SSE client), then:
//
//   - a 400px Radix Dialog portalled to document.body, outside #app-root
//   - not dismissable: Esc, outside click and the overlay all refuse
//   - #app-root gets `inert` + aria-hidden so the frame leaves the tab order
//     and the accessibility tree while staying visible behind the scrim
//   - one primary, "Log in", to /login?callbackUrl=<current>, plus
//     &reason=revoked when the 401 named a revocation, so /login can add
//     "You were logged out on every device." (spec-account-auth, Session
//     expired re-login, step 4). /login validates the callback itself
//     (safeCallbackUrl) and prefills the email from workwrk:last-email.
//
// The sentence about kept drafts renders only when a draft was actually
// flushed (useDraftOnExpiry writes under the workwrk:draft: prefix), and the
// sign-out-all variant renders when the 401 named a revocation.

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";
import {
  IDLE_WARNING_EVENT,
  SESSION_EXPIRED_EVENT,
  SESSION_RENEW_URL,
  currentLoginUrl,
  isSessionExpired,
  loginHrefFor,
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
      setLoginHref(loginHrefFor(currentLoginUrl(), detail?.reason ?? "unknown"));
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
          className="fixed inset-x-0 mx-auto top-1/2 z-[10001] w-[400px] max-w-[calc(100vw-32px)] -translate-y-1/2 rounded-xl border border-line bg-raised p-5 text-ink shadow-[var(--os-shadow-modal)] focus:outline-none"
        >
          <DialogPrimitive.Title className="text-lg font-semibold leading-tight">
            You were logged out
          </DialogPrimitive.Title>
          {/* Radix wires aria-describedby to this Description itself; an
              overridden id left its generated one dangling and logged a
              "Missing Description" warning on every open. */}
          <DialogPrimitive.Description className="mt-2 text-base leading-relaxed text-ink-2">
            {reason === "revoked" ? "You were logged out on every device. " : ""}
            Log in again to keep working.
            {draftKept ? " Anything you were typing has been kept on this device." : ""}
            {offline ? " You are offline. Log in when you are back." : ""}
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end">
            <a
              href={loginHref}
              autoFocus
              // design-system 4.7 focus: the dialog portals to <body>, outside
              // .workwrk-os, so the ring is spelled out here on the tokens.
              className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)]"
            >
              Log in
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

  // Someone who is working is not idle: the workspace's idle window
  // (Workspace settings > Security) can be as short as 30 minutes, and only
  // GET /api/auth/session moves it. A click or key in the last five minutes
  // renews the session quietly instead of asking.
  const lastInput = useRef(0);
  useEffect(() => {
    const mark = () => { lastInput.current = Date.now(); };
    window.addEventListener("pointerdown", mark, { passive: true });
    window.addEventListener("keydown", mark, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  useEffect(() => {
    const onWarn = (e: Event) => {
      const detail = (e as CustomEvent<IdleWarningDetail>).detail;
      if (!detail?.idleUntil) return;
      if (isSessionExpired()) return;
      if (Date.now() - lastInput.current < 5 * 60_000) {
        void apiFetch<{ user?: unknown; expires?: string }>(SESSION_RENEW_URL).then((r) => {
          if (r.ok && r.data?.user) scheduleIdleWarning(r.data.expires ?? null);
          else setVisible(true);
        });
        return;
      }
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
      className="fixed bottom-4 start-4 z-[9000] flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-ink shadow-[var(--os-shadow-pop)]"
    >
      <span>You&apos;ll be logged out in 2 minutes</span>
      <button
        type="button"
        onClick={() => void stay()}
        disabled={busy}
        className="rounded-md bg-brand px-2.5 py-1 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
      >
        Stay logged in
      </button>
    </div>
  );
}
