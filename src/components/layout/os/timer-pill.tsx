"use client";

// TimerPill (spec-shell 2.1, the fifth right-cluster slot): renders only
// while a clock is running. A 32px chrome-field pill with the live dot, the
// elapsed time, what it is on and a 24px stop. The body links to the thing;
// the stop never navigates.
//
// TWO CLOCKS, ONE PILL (spec-planner section 2 /clock Data, audit C-4).
// There are two independent time models in this product:
//
//   TimerSession   the task Time tracker's stopwatch, fed by boot.timer and
//                  the SSE timer events through BootProvider.
//   TimeEntry with clockedInAt   the Clock page's punch, which rolls up
//                  into the week's Timesheet and eventually into payroll.
//
// The pill used to read only the first, so somebody clocked in for six
// hours had NOTHING in the top bar telling them so, and the only way to
// find out was to open /clock. GET /api/time/active answers both in one
// read, which is the endpoint the Planner sidebar's Clock row already uses.
//
// The task timer wins when both are running: it is the more specific of the
// two and the punch is still one click away on the row it links to.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { useBoot } from "./boot-context";
import { useOsToast } from "./toast";

type ActivePunch = { id: string; since: string; itemTitle: string | null; description: string | null };

function elapsed(startedAt: string, now: number): string {
  const ms = Math.max(0, now - new Date(startedAt).getTime());
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function TimerPill() {
  const { timer, setTimer } = useBoot();
  const { toast } = useOsToast();
  const [now, setNow] = useState(() => Date.now());
  const [punch, setPunch] = useState<ActivePunch | null>(null);

  // One read for the punch, on mount and whenever a punch or a timer
  // changes. No poller: an elapsed counter does not need the server to tick,
  // and the shell already has the two events that mean "a clock changed".
  const readPunch = useCallback(async () => {
    const r = await apiFetch<{ punch: ActivePunch | null }>("/api/time/active");
    setPunch(r.ok ? r.data.punch : null);
  }, []);
  useEffect(() => {
    const run = async () => { await readPunch(); };
    void run();
    const refresh = () => { void readPunch(); };
    window.addEventListener("workwrk:timesheets-changed", refresh);
    window.addEventListener(WINDOW_EVENTS.timerChanged, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("workwrk:timesheets-changed", refresh);
      window.removeEventListener(WINDOW_EVENTS.timerChanged, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [readPunch]);

  const running = Boolean(timer || punch);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const stopPunch = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // keepalive: a clock-out begun as the tab closes still reaches the
    // server, because the hours are already worked.
    const r = await apiFetch("/api/time-entries/punch", { method: "POST", json: { action: "stop" }, keepalive: true });
    if (!r.ok) { toast(r.error, { tone: "danger", action: { label: "Try again", onClick: () => { void stopPunch(e); } } }); return; }
    setPunch(null);
    window.dispatchEvent(new CustomEvent("workwrk:timesheets-changed"));
  };

  if (!timer) {
    if (!punch) return null;
    const punchLabel = punch.itemTitle ?? punch.description ?? "Clocked in";
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-md bg-chrome-field ps-3 pe-1">
        <Link href="/clock" className="inline-flex items-center gap-2" title="Open Clock in/out">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand os-live-dot" aria-hidden />
          <span className="text-xs font-medium tabular-nums text-chrome-field-fg">{elapsed(punch.since, now)}</span>
          <span className="max-w-[120px] truncate text-xs text-chrome-fg-2" title={punchLabel}>{punchLabel}</span>
        </Link>
        <button
          type="button"
          onClick={(e) => { void stopPunch(e); }}
          aria-label="Clock out"
          title="Clock out"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-chrome-fg-2 hover:bg-chrome-hov hover:text-chrome-fg"
        >
          <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
        </button>
      </span>
    );
  }

  const stop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = await apiFetch("/api/timers/stop", { method: "POST", json: { entityType: timer.entityType, entityId: timer.entityId } });
    if (!r.ok) { toast("Couldn't stop the timer. Try again"); return; }
    setTimer(null);
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.timerChanged));
  };

  const label = timer.title ?? timer.entityType.toLowerCase().replace(/_/g, " ");
  const body = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand os-live-dot" aria-hidden />
      <span className="text-xs font-medium tabular-nums text-chrome-field-fg">{elapsed(timer.startedAt, now)}</span>
      <span className="max-w-[120px] truncate text-xs text-chrome-fg-2" title={label}>{label}</span>
    </>
  );
  const shell = "inline-flex h-8 items-center gap-2 rounded-md bg-chrome-field ps-3 pe-1";
  return (
    <span className={shell}>
      {timer.url ? (
        <Link href={timer.url} className="inline-flex items-center gap-2" title={timer.title ? `Open ${timer.title}` : "Open"}>{body}</Link>
      ) : (
        <span className="inline-flex items-center gap-2" title="You no longer have access to this task">{body}</span>
      )}
      <button
        type="button"
        onClick={(e) => { void stop(e); }}
        aria-label="Stop timer"
        title="Stop timer"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-chrome-fg-2 hover:bg-chrome-hov hover:text-chrome-fg"
      >
        <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
      </button>
    </span>
  );
}
