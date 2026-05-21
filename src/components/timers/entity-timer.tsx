"use client";

// EntityTimer — Phase 7. A play/pause button + running clock for any
// polymorphic entity. Drop into a detail drawer, a board cell, a
// ticket header — wherever the user wants "time until resolution"
// visible.
//
// One timer per user system-wide: starting a timer here will stop
// any other in-flight timer the user has (server enforces this).
// The displayed total is across ALL users' sessions for the entity,
// so a team can collectively rack up time on the same ticket.

import { useCallback, useEffect, useState } from "react";
import { Play, Pause } from "lucide-react";

interface Props {
  entityType: string;
  entityId: string;
  /** Render as a compact icon-only chip vs the full row. */
  compact?: boolean;
}

export function EntityTimer({ entityType, entityId, compact }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Anchor for the live display. `baseMs` is the accumulated total at
  // the moment of the last server fetch. `fetchedAt` is when we read
  // the server. When a timer is running we add `now - fetchedAt` to
  // baseMs locally so the clock ticks smoothly without re-polling.
  const [baseMs, setBaseMs] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/timers?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setActiveId(data.active?.id ?? null);
      setBaseMs(typeof data.totalMs === "number" ? data.totalMs : 0);
      setFetchedAt(Date.now());
      setNow(Date.now());
    } catch {}
  }, [entityType, entityId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeId]);

  const localExtra = activeId ? Math.max(0, now - fetchedAt) : 0;
  const totalMs = baseMs + localExtra;

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const path = activeId ? "/api/timers/stop" : "/api/timers/start";
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [activeId, entityType, entityId, refresh, loading]);

  const running = !!activeId;

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono transition-colors " +
          (running
            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-surface-2 text-muted hover:text-foreground")
        }
        title={running ? "Stop timer" : "Start timer"}
        aria-label={running ? "Stop timer" : "Start timer"}
      >
        {running ? <Pause size={10} /> : <Play size={10} />}
        <span>{fmtDuration(totalMs)}</span>
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className={
          "inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors " +
          (running
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-violet-600 hover:bg-violet-700 text-white")
        }
        title={running ? "Stop timer" : "Start timer"}
        aria-label={running ? "Stop timer" : "Start timer"}
      >
        {running ? <Pause size={11} /> : <Play size={11} />}
      </button>
      <span className="font-mono text-xs tabular-nums">{fmtDuration(totalMs)}</span>
      {running && <span className="text-[10px] text-emerald-600 uppercase tracking-wider">live</span>}
    </div>
  );
}

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}
