"use client";

// TimerPill (spec-shell 2.1, the fifth right-cluster slot): renders only
// while a timer is running. A 32px chrome-field pill with the live dot, the
// elapsed time, the task name and a 24px stop. The body links to the task
// on its List with the drawer open; the stop never navigates. Fed by
// boot.timer and the SSE timer events through BootProvider, so the old 15s
// poller is gone.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { useBoot } from "./boot-context";
import { useOsToast } from "./toast";

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

  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timer]);

  if (!timer) return null;

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
