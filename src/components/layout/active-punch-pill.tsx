"use client";

// Topbar pill that surfaces the user's active timesheet punch on
// every page. Polls /api/time-entries/punch lightly (every 30s) so
// the badge stays correct after route changes elsewhere; clicks
// route to /timesheets to stop the punch. The clock ticks every
// second locally so it feels alive without a request-per-second.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";

type Active = {
  id: string;
  clockedInAt: string;
  description: string | null;
  task: { id: string; title: string } | null;
};

const POLL_INTERVAL_MS = 30_000;

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ActivePunchPill() {
  const [active, setActive] = useState<Active | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fetchActive = () => {
      fetch("/api/time-entries/punch")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          const a = d?.active ?? null;
          if (a && typeof a.clockedInAt === "string" && a.clockedOutAt === null) {
            setActive(a);
          } else if (a && a.clockedInAt) {
            // Some endpoints return shape { active: { clockedInAt, ... } }
            setActive(a);
          } else {
            setActive(null);
          }
        })
        .catch(() => {});
    };
    fetchActive();
    const poll = setInterval(fetchActive, POLL_INTERVAL_MS);
    const onFocus = () => fetchActive();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Local clock tick — only when there's an active punch, to avoid
  // wasted re-renders when nothing is running.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;

  const startedAt = new Date(active.clockedInAt).getTime();
  const elapsed = Math.max(0, (now - startedAt) / 1000);

  return (
    <Link
      href="/timesheets"
      className="active-punch-pill"
      title={`Clocked in${active.task ? ` · ${active.task.title}` : ""} — click to stop`}
    >
      <span className="active-punch-dot" aria-hidden />
      <Play size={11} className="opacity-70" />
      <span className="active-punch-time">{fmtElapsed(elapsed)}</span>
    </Link>
  );
}
