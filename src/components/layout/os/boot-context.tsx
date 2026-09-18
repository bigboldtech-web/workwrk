"use client";

// BootProvider: the one payload the shell reads before first paint
// (spec-shell 1.12, 2.1 "Data"). `(dashboard)/layout.tsx` fetches
// GET /api/boot once the session resolves and mounts the frame only when it
// succeeded, so every chrome consumer below can assume the payload exists:
// the viewer's org role for the avatar menu's Guest branch, the rail's
// visible hubs and dots, the org culture for the splash, effective
// preferences before the first paint (no density flash) and the running
// timer for the bar's pill.
//
// Counts are the one part of the payload that moves during a session: the
// SSE events in spec-shell 1.11 update them through `setCounts`, and the
// 60s `/api/boot?counts=1` fallback poll runs while the stream is down.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BootCounts, BootPayload } from "@/app/api/boot/route";
import { apiFetch } from "@/lib/api-fetch";
import { FALLBACK_POLL_MS, WINDOW_EVENTS, type ActiveTimer, type RealtimeEvent } from "@/lib/realtime-events";

export type { BootCounts, BootPayload };

type BootState = {
  boot: BootPayload;
  counts: BootCounts;
  setCounts: (patch: Partial<BootCounts>) => void;
  timer: ActiveTimer | null;
  setTimer: (t: ActiveTimer | null) => void;
  /** Re-fetch the counts alone (the fallback poll and a manual refresh). */
  refreshCounts: () => Promise<void>;
};

const Ctx = createContext<BootState | null>(null);
/** The raw context, for the few leaves that must also render outside the frame (ValueLine). */
export const BootContext = Ctx;

export function BootProvider({ boot, children }: { boot: BootPayload; children: React.ReactNode }) {
  const [counts, setCountsState] = useState<BootCounts>(boot.counts);
  const [timer, setTimer] = useState<ActiveTimer | null>(boot.timer);
  const connectedRef = useRef(true);

  const setCounts = useCallback((patch: Partial<BootCounts>) => {
    setCountsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const refreshCounts = useCallback(async () => {
    const r = await apiFetch<{ counts: BootCounts }>("/api/boot?counts=1", { cache: "no-store" });
    if (r.ok && r.data?.counts) setCountsState(r.data.counts);
  }, []);

  // Live chrome: the SSE stream carries the counts and the timer; the legacy
  // window events cover today's producers until every route emits the new
  // event names.
  useEffect(() => {
    const onRealtime = (e: Event) => {
      const ev = (e as CustomEvent<RealtimeEvent>).detail;
      if (!ev) return;
      if (ev.type === "notif.changed") setCountsState((c) => ({ ...c, inboxUnread: ev.unread }));
      else if (ev.type === "timer.started") setTimer(ev.session);
      else if (ev.type === "timer.stopped") setTimer((t) => (t && t.id === ev.session.id ? null : t));
    };
    const onLegacyChange = () => { void refreshCounts(); };
    const onState = (e: Event) => {
      connectedRef.current = Boolean((e as CustomEvent<{ connected: boolean }>).detail?.connected);
      if (connectedRef.current) void refreshCounts();
    };
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    window.addEventListener(WINDOW_EVENTS.notifChanged, onLegacyChange);
    window.addEventListener(WINDOW_EVENTS.remindersChanged, onLegacyChange);
    window.addEventListener(WINDOW_EVENTS.chatChanged, onLegacyChange);
    window.addEventListener(WINDOW_EVENTS.timerChanged, onLegacyChange);
    window.addEventListener(WINDOW_EVENTS.realtimeState, onState);
    // Fallback poll: counts only, and only while the stream is disconnected.
    const iv = window.setInterval(() => {
      if (!connectedRef.current && !document.hidden) void refreshCounts();
    }, FALLBACK_POLL_MS);
    return () => {
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
      window.removeEventListener(WINDOW_EVENTS.notifChanged, onLegacyChange);
      window.removeEventListener(WINDOW_EVENTS.remindersChanged, onLegacyChange);
      window.removeEventListener(WINDOW_EVENTS.chatChanged, onLegacyChange);
      window.removeEventListener(WINDOW_EVENTS.timerChanged, onLegacyChange);
      window.removeEventListener(WINDOW_EVENTS.realtimeState, onState);
      window.clearInterval(iv);
    };
  }, [refreshCounts]);

  const value = useMemo<BootState>(
    () => ({ boot, counts, setCounts, timer, setTimer, refreshCounts }),
    [boot, counts, setCounts, timer, refreshCounts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoot(): BootState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBoot must be used within BootProvider");
  return ctx;
}

/** The viewer's org role from boot, for chrome that branches on Guest / Admin. */
export function useViewerRole() {
  const { boot } = useBoot();
  const role = boot.viewer.orgRole;
  return {
    orgRole: role,
    isOwner: role === "OWNER",
    isAdmin: role === "OWNER" || role === "ADMIN",
    isGuest: role === "GUEST",
    isAgent: boot.viewer.isAgent,
  };
}
