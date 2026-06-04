"use client";

// ActiveTimerPill — topbar widget that shows the user's currently
// running TimerSession, if any. Polls /api/timers/active every 15s
// and ticks the live elapsed display once per second.
//
// Hidden when no timer is active so the topbar stays compact.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";

interface ActiveSession {
  id: string;
  entityType: string;
  entityId: string;
  startedAt: string;
  title: string | null;
  url: string | null;
}

function elapsed(startedAt: string, now: number): string {
  const ms = Math.max(0, now - new Date(startedAt).getTime());
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ActiveTimerPill() {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick the elapsed display every second while a session is active.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Poll the server every 15s. Re-polls also fire after a stop click.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch("/api/timers/active")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          setActive(data?.active ?? null);
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!active) return null;

  const stop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/timers/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: active.entityType, entityId: active.entityId }),
    });
    setActive(null);
  };

  const label = active.title ?? active.entityType.toLowerCase().replace(/_/g, " ");
  const Inner = (
    <span className="inline-flex items-center gap-1.5 h-6 px-1.5 rounded-md bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
      <span className="font-mono tabular-nums text-[11px] font-semibold">
        {elapsed(active.startedAt, now)}
      </span>
      <span className="text-[11px] truncate max-w-[140px]" title={label}>{label}</span>
      <button
        type="button"
        onClick={stop}
        aria-label="Stop timer"
        title="Stop timer"
        className="h-4 w-4 rounded hover:bg-red-200 inline-flex items-center justify-center"
      >
        <Square className="h-2.5 w-2.5 fill-current" />
      </button>
    </span>
  );

  if (active.url) {
    return (
      <Link href={active.url} className="inline-flex">
        {Inner}
      </Link>
    );
  }
  return Inner;
}
