"use client";

// One settings tab's read (docs/plans/ai-teammates.md 5.5): the tab's own
// route, read when the tab opens and again whenever the chat with this
// teammate may have changed it without the tab knowing: a turn (the store's
// AI_CHATS_CHANGED_EVENT, raised after every turn and decision: a memory
// saved, a routine set up), the realtime agent.changed for this teammate (a
// decision in another tab, a routine's run, an expiry) and the window's
// focus. Reads can cross; only the newest one lands. A failed read keeps
// what was shown.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AI_CHATS_CHANGED_EVENT } from "@/lib/ai/events";
import { apiFetch } from "@/lib/api-fetch";
import { WINDOW_EVENTS, type RealtimeEvent } from "@/lib/realtime-events";

export function useTeammateData<T>(
  url: string,
  agentId: string,
): { data: T | null; error: boolean; reload: () => Promise<void>; setData: Dispatch<SetStateAction<T | null>> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const n = ++latest.current;
    const r = await apiFetch<T>(url, { cache: "no-store" });
    if (n !== latest.current) return;
    if (!r.ok) {
      setError(true);
      return;
    }
    setError(false);
    setData(r.data);
  }, [url]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onChange = () => void load();
    const onRealtime = (e: Event) => {
      const d = (e as CustomEvent<RealtimeEvent>).detail;
      if (d?.type === "agent.changed" && d.agentId === agentId) void load();
    };
    window.addEventListener("focus", onChange);
    window.addEventListener(AI_CHATS_CHANGED_EVENT, onChange);
    window.addEventListener(WINDOW_EVENTS.realtime, onRealtime);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(AI_CHATS_CHANGED_EVENT, onChange);
      window.removeEventListener(WINDOW_EVENTS.realtime, onRealtime);
    };
  }, [load, agentId]);

  return { data, error, reload: load, setData };
}
