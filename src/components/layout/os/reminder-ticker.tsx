"use client";

// ReminderTicker — invisible background poller. Every minute (and on mount) it
// fires the current user's due reminders via /api/reminders/tick and toasts
// each one, so reminders go off while the app is open even without an external
// scheduler.

import { useEffect } from "react";
import { useOsToast } from "./toast";

export function ReminderTicker() {
  const { toast } = useOsToast();
  useEffect(() => {
    let active = true;
    async function tick() {
      try {
        const res = await fetch("/api/reminders/tick");
        if (!res.ok || !active) return;
        const d = (await res.json()) as { fired: { id: string; title: string }[] };
        for (const r of d.fired) toast(`Reminder: ${r.title}`);
      } catch { /* ignore */ }
    }
    void tick();
    const iv = setInterval(tick, 60_000);
    return () => { active = false; clearInterval(iv); };
  }, [toast]);
  return null;
}
