"use client";

// RealtimeClient: ONE Server-Sent-Events connection per tab (browsers cap ~6
// sockets/origin, so we open exactly one and fan out via window events).
// Mounted once at shell level. It never carries message bodies: each event is
// just "something changed", and the existing consumers refetch through their
// normal (auth-scoped, redacted) endpoints.
//
// Reconnect (spec-shell section 1.11): EventSource retries on its own only
// after a stream that once opened drops; a non-200 response (the 401 on a
// lapsed session) closes it PERMANENTLY with no reconnect, and nothing used to
// observe that. Now `onerror` with readyState CLOSED probes a cheap endpoint
// through apiFetch: a 401 marks the session expired (the dialog takes over and
// this client stays closed); anything else schedules a reconnect with
// exponential backoff 1s -> 30s plus jitter. While disconnected the shell's
// pollers are the fallback (the single /api/boot?counts=1 poll replaces them
// in a later unit).
//
// Every wire event is re-dispatched as `workwrk:realtime` (detail = the event)
// plus the legacy window events today's consumers listen for, so the new
// contract (src/lib/realtime-events.ts) and the old fan-out coexist.

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { apiFetch } from "@/lib/api-fetch";
import { isSessionExpired, SESSION_EXPIRED_EVENT } from "@/lib/session-expiry";
import {
  WINDOW_EVENTS,
  isRealtimeEvent,
  legacyWindowEventsFor,
  reconnectDelayMs,
} from "@/lib/realtime-events";

export function RealtimeClient() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const setState = (connected: boolean) => {
      window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.realtimeState, { detail: { connected } }));
    };

    const close = () => {
      if (es) {
        es.onmessage = null;
        es.onerror = null;
        es.onopen = null;
        es.close();
        es = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || isSessionExpired()) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delay = reconnectDelayMs(attempt++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
      }, delay);
    };

    const open = () => {
      if (stopped || isSessionExpired()) return;
      close();
      es = new EventSource("/api/realtime");
      es.onopen = () => {
        attempt = 0;
        setState(true);
      };
      es.onmessage = (e) => {
        let ev: unknown;
        try { ev = JSON.parse(e.data); } catch { return; }
        if (!isRealtimeEvent(ev)) return;
        window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.realtime, { detail: ev }));
        for (const name of legacyWindowEventsFor(ev)) window.dispatchEvent(new CustomEvent(name));
      };
      es.onerror = () => {
        // CONNECTING = the browser is retrying on its own (a dropped stream);
        // CLOSED = it gave up (a non-200 answer such as our 401). Only the
        // latter needs us. The probe tells 401 apart from a server hiccup.
        if (!es || es.readyState !== EventSource.CLOSED) {
          setState(false);
          return;
        }
        close();
        setState(false);
        void apiFetch("/api/inbox/count", { cache: "no-store" }).then((r) => {
          if (stopped) return;
          if (!r.ok && r.status === 401) return; // apiFetch announced it; stay closed
          scheduleReconnect();
        });
      };
    };

    const onExpired = () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      close();
      setState(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    open();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      close();
    };
  }, [status]);

  return null;
}
