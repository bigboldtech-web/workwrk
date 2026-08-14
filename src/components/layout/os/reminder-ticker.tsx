"use client";

// ReminderTicker — fires the current user's due reminders AND surfaces each one
// as a PERSISTENT in-app popup (bottom-right) that survives until the user acts
// on it. This replaces the old 3.2s toast: a fired reminder no longer vanishes
// the instant you look away.
//
// Two jobs in one always-mounted component (see os-shell — mounted ABOVE the
// settings/non-settings fork so reminders fire everywhere, including the
// full-screen Settings takeover):
//
//   1. Firing (app-open scheduler). Every 60s (and on mount) it GETs
//      /api/reminders/tick, which atomically claims + fires each due reminder —
//      creating the bell Notification and flipping PENDING → FIRED. This is the
//      client-side scheduler for users who have the app open; the
//      /api/cron/reminders job (registered in CRON-SETUP.md) covers closed-app
//      users. The atomic claim means ticker + cron can never double-fire.
//
//   2. Surfacing. After every tick — and on mount, and whenever any surface
//      broadcasts `workwrk:reminders-changed` — it loads the FIRED-but-unacted
//      set (/api/reminders?status=FIRED) and renders one card per reminder with
//      Snooze (10m / 1h / tomorrow) · Dismiss · Open. Loading FIRED on mount is
//      what makes it durable: cron-fired reminders and any fired before a reload
//      re-surface instead of being silently lost.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlarmClock, Clock, X, ArrowUpRight, ChevronDown, CheckSquare } from "lucide-react";

type Fired = {
  id: string;
  title: string;
  body: string | null;
  remindAt: string;
  firedAt: string | null;
  entityType: string | null;
  entityId: string | null;
};

function agoLabel(iso: string | null): string {
  if (!iso) return "just now";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Minutes from now until tomorrow 9am — for the "Tomorrow" snooze, expressed
 *  as snoozeMinutes so it rides the same PATCH path as the shorter snoozes. */
function tomorrow9amMinutes(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((d.getTime() - Date.now()) / 60_000));
}

const SNOOZE: { label: string; minutes: () => number }[] = [
  { label: "10 minutes", minutes: () => 10 },
  { label: "1 hour", minutes: () => 60 },
  { label: "Tomorrow 9am", minutes: tomorrow9amMinutes },
];

export function ReminderTicker() {
  const router = useRouter();
  const [fired, setFired] = useState<Fired[]>([]);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const activeRef = useRef(true);

  const loadFired = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders?status=FIRED", { cache: "no-store" });
      if (!res.ok || !activeRef.current) return;
      const d = (await res.json()) as { reminders: Fired[] };
      setFired(Array.isArray(d.reminders) ? d.reminders : []);
    } catch { /* ignore */ }
  }, []);

  // Firing poller — claims + fires due reminders while the app is open, then
  // refreshes the surfaced set. Also listens for cross-surface change
  // broadcasts so acting from the bell instantly reconciles the popup.
  useEffect(() => {
    activeRef.current = true;
    async function tick() {
      try { await fetch("/api/reminders/tick", { cache: "no-store" }); }
      catch { /* ignore */ }
      await loadFired();
    }
    void tick();
    const iv = setInterval(tick, 60_000);
    const onChanged = () => void loadFired();
    window.addEventListener("workwrk:reminders-changed", onChanged);
    return () => {
      activeRef.current = false;
      clearInterval(iv);
      window.removeEventListener("workwrk:reminders-changed", onChanged);
    };
  }, [loadFired]);

  // Snooze / dismiss / reschedule. Optimistically drop the card, then PATCH and
  // broadcast so the bell (and any other viewer) reconciles.
  const act = useCallback(async (id: string, body: Record<string, unknown>) => {
    setFired((prev) => prev.filter((r) => r.id !== id));
    setSnoozeOpenId(null);
    try {
      await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      window.dispatchEvent(new CustomEvent("workwrk:reminders-changed"));
    }
  }, []);

  // Open the linked task (or /today for a personal reminder) and mark the
  // reminder acted-on — opening it is acting on it.
  const openReminder = useCallback((r: Fired) => {
    const link = r.entityType === "BOARD_ITEM" && r.entityId ? `/item/${r.entityId}` : "/today";
    void act(r.id, {});
    router.push(link);
  }, [act, router]);

  if (fired.length === 0 || typeof document === "undefined") return null;

  const dismissAll = () => { for (const r of fired) void act(r.id, {}); };

  return createPortal(
    <div
      className="workwrk-os fixed bottom-4 right-4 z-[130] w-[340px] max-w-[92vw] flex flex-col gap-2 max-h-[75vh] overflow-y-auto"
      role="alertdialog"
      aria-label="Fired reminders"
    >
      {fired.length > 1 ? (
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {fired.length} reminders
          </span>
          <button
            type="button"
            onClick={dismissAll}
            className="text-[11.5px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100"
          >
            Dismiss all
          </button>
        </div>
      ) : null}

      {fired.map((r) => {
        const isTask = r.entityType === "BOARD_ITEM" && !!r.entityId;
        return (
          <div
            key={r.id}
            className="rounded-xl bg-white dark:bg-[#181C22] border border-zinc-200 dark:border-[#2A2F38] shadow-2xl overflow-hidden"
          >
            <div className="flex items-start gap-2.5 p-3">
              <span className="mt-0.5 w-7 h-7 rounded-lg bg-[#0073EA]/10 flex items-center justify-center flex-shrink-0">
                <AlarmClock className="w-4 h-4 text-[#0073EA]" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#0073EA]">Reminder</div>
                <div className="text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100 leading-snug break-words">
                  {r.title}
                </div>
                {r.body ? (
                  <div className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">{r.body}</div>
                ) : null}
                <div className="flex items-center gap-1 text-[11px] text-zinc-400 mt-1">
                  {isTask ? <CheckSquare className="w-3 h-3" /> : null}
                  <span>{agoLabel(r.firedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void act(r.id, {})}
                title="Dismiss"
                aria-label="Dismiss"
                className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {snoozeOpenId === r.id ? (
              <div className="flex items-center gap-1.5 px-3 pb-2.5 flex-wrap">
                {SNOOZE.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void act(r.id, { snoozeMinutes: s.minutes() })}
                    className="px-2 py-1 rounded-md text-[12px] border border-zinc-200 dark:border-[#2A2F38] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/10"
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSnoozeOpenId(null)}
                  className="px-2 py-1 rounded-md text-[12px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 px-2.5 pb-2.5">
                {isTask ? (
                  <button
                    type="button"
                    onClick={() => openReminder(r)}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12.5px] font-medium text-white bg-[#0073EA] hover:bg-[#0060B9]"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" /> Open
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSnoozeOpenId(r.id)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12.5px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10"
                >
                  <Clock className="w-3.5 h-3.5" /> Snooze <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void act(r.id, {})}
                  className="ml-auto inline-flex items-center h-7 px-2.5 rounded-md text-[12.5px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
