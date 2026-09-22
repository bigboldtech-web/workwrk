"use client";

// ReminderTicker: the app's ONE reminder poller, and the cards a fired
// reminder appears on (spec-planner.md section 2, Reminders).
//
// Two jobs in one always-mounted component (os-shell mounts it ABOVE the
// settings fork, so reminders fire everywhere including the full-screen
// settings takeover):
//
//   1. FIRING. Every 60s, and on mount, it GETs /api/reminders/tick, which
//      atomically claims and fires each due reminder. That is the
//      client-side scheduler for people with the app open; the
//      /api/cron/reminders row covers closed-app people, and the atomic
//      claim means the two can never double-fire.
//   2. SURFACING. After every tick, on mount, and whenever any surface
//      broadcasts `workwrk:reminders-changed`, it loads the FIRED set and
//      renders one card each. Loading FIRED on mount is what makes it
//      durable: a reminder fired by the cron, or before a reload,
//      re-surfaces instead of being silently lost.
//
// WHAT PHASE 4 CHANGED, AND WHY EACH ONE WAS A DEFECT:
//
//   * IT IS IN THE TOAST POSITION NOW (bottom-LEFT, design-system 5.7),
//     where the rest of the product puts transient cards. It used to open
//     its own bottom-right portal, which is where the call dock lives, so
//     an alarm during a call landed on top of the call.
//   * A FAILED ACTION IS VISIBLE. Snooze and Done removed the card
//     optimistically and then swallowed the response, so a reminder that
//     failed to snooze looked snoozed and went off again later with no
//     explanation. The card comes back now and says so, with Retry.
//   * OPEN USES THE ONE TASK DOOR. It pushed `/item/<id>` by hand, which
//     renders the full task page; `openTask` arms the drawer intent first,
//     so the task opens as the drawer over whatever you were doing and
//     closing brings you back.
//   * TOKENS, NOT HEXES. The card was `bg-white dark:bg-[#181C22]` with
//     `#0073EA` typed in four places.
//
// The snooze choices are the ones in src/components/planner/event-popover.tsx,
// imported rather than re-listed, so the bell, the calendar popover and this
// card cannot offer three different sets.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowUpRight, Check, ChevronDown, Clock, X } from "lucide-react";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { openTask } from "@/lib/nav/open-task";
import { apiFetch } from "@/lib/api-fetch";
import { SNOOZE_CHOICES } from "@/components/planner/event-popover";

type Fired = {
  id: string;
  title: string;
  body: string | null;
  remindAt: string;
  firedAt: string | null;
  entityType: string | null;
  entityId: string | null;
};

/** At most three cards; the rest are one line that opens the bell. */
const MAX_CARDS = 3;

function agoLabel(iso: string | null): string {
  if (!iso) return "just now";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "went off just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `went off ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `went off ${h}h ago`;
  return `went off ${Math.floor(h / 24)}d ago`;
}

export function ReminderTicker() {
  const router = useRouter();
  const stackRef = useRef<HTMLDivElement>(null);
  const [fired, setFired] = useState<Fired[]>([]);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const activeRef = useRef(true);

  const loadFired = useCallback(async () => {
    const r = await apiFetch<{ reminders: Fired[] }>("/api/reminders?status=FIRED");
    if (!r.ok || !activeRef.current) return;
    setFired(Array.isArray(r.data.reminders) ? r.data.reminders : []);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const tick = async () => {
      await apiFetch("/api/reminders/tick");
      await loadFired();
    };
    void tick();
    const iv = setInterval(() => { void tick(); }, 60_000);
    const onChanged = () => { void loadFired(); };
    window.addEventListener("workwrk:reminders-changed", onChanged);
    return () => {
      activeRef.current = false;
      clearInterval(iv);
      window.removeEventListener("workwrk:reminders-changed", onChanged);
    };
  }, [loadFired]);

  /**
   * Snooze, done or move. Optimistic, and REVERSIBLE: a failure puts the
   * card back with its error line rather than leaving the person believing
   * they dealt with an alarm that is still pending.
   */
  const act = useCallback(async (r: Fired, body: Record<string, unknown>) => {
    setFired((prev) => prev.filter((x) => x.id !== r.id));
    setSnoozeOpenId(null);
    setFailedId(null);
    const res = await apiFetch(`/api/reminders/${r.id}`, { method: "PATCH", json: body, keepalive: true });
    if (!res.ok) {
      setFired((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
      setFailedId(r.id);
      return;
    }
    window.dispatchEvent(new CustomEvent("workwrk:reminders-changed"));
  }, []);

  // THE TOAST STACK SHARES THIS CORNER. A toast is transient and these
  // cards are not, so the cards keep the corner and the toasts are lifted
  // clear of them by exactly their height. The variable is cleared on
  // unmount and whenever the last card goes, so a workspace with no alarm
  // ringing has the toast stack exactly where it has always been.
  useEffect(() => {
    const root = document.documentElement;
    if (fired.length === 0) { root.style.removeProperty("--os-reminder-stack"); return; }
    const h = stackRef.current?.offsetHeight ?? 0;
    root.style.setProperty("--os-reminder-stack", `${h + 12}px`);
    return () => { root.style.removeProperty("--os-reminder-stack"); };
  }, [fired]);

  /** Opening it is acting on it, so it dismisses in the same gesture. */
  const openReminder = useCallback((r: Fired) => {
    void act(r, { action: "dismiss" });
    if (r.entityType === "BOARD_ITEM" && r.entityId) openTask(router, r.entityId);
    else router.push(WORK_HOME_HREF);
  }, [act, router]);

  if (fired.length === 0 || typeof document === "undefined") return null;

  const shown = fired.slice(0, MAX_CARDS);
  const hidden = fired.length - shown.length;

  return createPortal(
    <div ref={stackRef} className="workwrk-os os-chrome rmc" role="alertdialog" aria-label="Reminders that went off">
      {hidden > 0 ? (
        <button
          type="button"
          className="rmc__more"
          onClick={() => window.dispatchEvent(new CustomEvent("workwrk:open-reminders"))}
        >
          and {hidden} more
        </button>
      ) : null}

      {shown.map((r) => {
        const isTask = r.entityType === "BOARD_ITEM" && Boolean(r.entityId);
        return (
          <div key={r.id} className="rmc__card">
            <div className="rmc__top">
              <span className="rmc__icon"><AlarmClock aria-hidden /></span>
              <div className="rmc__text">
                <p className="rmc__title">{r.title}</p>
                {r.body ? <p className="rmc__body">{r.body}</p> : null}
                <p className="rmc__meta">{agoLabel(r.firedAt)}</p>
                {failedId === r.id ? (
                  <p className="rmc__bad">
                    Couldn&rsquo;t update it.{" "}
                    <button type="button" onClick={() => { void act(r, { action: "dismiss" }); }}>Retry</button>
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="rmc__x"
                onClick={() => { void act(r, { action: "dismiss" }); }}
                aria-label="Dismiss"
                title="Dismiss"
              >
                <X aria-hidden />
              </button>
            </div>

            {snoozeOpenId === r.id ? (
              <div className="rmc__snooze">
                {SNOOZE_CHOICES.map((s) => (
                  <button key={s.label} type="button" onClick={() => { void act(r, { snoozeMinutes: s.minutes() }); }}>
                    {s.label}
                  </button>
                ))}
                <button type="button" className="rmc__cancel" onClick={() => setSnoozeOpenId(null)}>Cancel</button>
              </div>
            ) : (
              <div className="rmc__actions">
                {isTask ? (
                  <button type="button" className="rmc__open" onClick={() => openReminder(r)}>
                    <ArrowUpRight aria-hidden /> Open
                  </button>
                ) : null}
                <button type="button" className="rmc__ghost" onClick={() => setSnoozeOpenId(r.id)}>
                  <Clock aria-hidden /> Snooze <ChevronDown aria-hidden />
                </button>
                <button type="button" className="rmc__ghost rmc__ghost--end" onClick={() => { void act(r, { action: "dismiss" }); }}>
                  <Check aria-hidden /> Done
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
