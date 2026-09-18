"use client";

/* Clock — punch in/out hero.
 *
 *  GET  /api/time-entries/punch                 the active punch session
 *  GET  /api/time-entries?mine=true&limit=8     recent sessions (the route
 *                                               has no GET today, so the
 *                                               panel renders its error
 *                                               line rather than zeros)
 *  POST /api/time-entries/punch                 toggle clock in/out
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Clock, Play, Square, Coffee, ArrowRight, CheckCircle2, Activity,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ErrorState } from "@/components/ui/error-state";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Entry = {
  id: string;
  startTime: string;
  endTime?: string | null;
  durationMinutes?: number | null;
  notes?: string | null;
  category?: string | null;
};

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function fmtTime(d: Date): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export default function ClockPage() {
  const [now, setNow] = useState<Date>(new Date());
  const [active, setActive] = useState<Entry | null>(null);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [recentUnavailable, setRecentUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const load = useCallback(async () => {
    try {
      const [activeRes, recentRes] = await Promise.all([
        fetch("/api/time-entries/punch", { cache: "no-store" }),
        fetch("/api/time-entries?mine=true&limit=8", { cache: "no-store" }),
      ]);
      // A failed read is never rendered as a healthy page (spec-shell 1.7).
      if (!activeRes.ok) throw new Error(`HTTP ${activeRes.status}`);
      const ad = await activeRes.json();
      const punch = (ad.data ?? ad) as { active?: { id: string; clockedInAt?: string | null } | null };
      const a = punch?.active ?? null;
      setActive(a && a.clockedInAt ? { id: a.id, startTime: a.clockedInAt } : null);
      if (recentRes.ok) {
        const rd = await recentRes.json();
        const list: Entry[] = rd.data ?? (Array.isArray(rd) ? rd : []);
        setRecent(list.filter((e) => e.endTime).slice(0, 8));
        setRecentUnavailable(false);
      } else {
        setRecent([]);
        setRecentUnavailable(true);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("timesheets");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function punch() {
    setBusy(true);
    try {
      const res = await fetch("/api/time-entries/punch", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) { toast("Punch failed"); return; }
      toast(active ? "Clocked out" : "Clocked in");
      void load();
    } catch { toast("Punch failed"); }
    finally { setBusy(false); }
  }

  const elapsed = active ? now.getTime() - new Date(active.startTime).getTime() : 0;
  const isClockedIn = !!active;

  const todayMinutes = recent.reduce((acc, e) => {
    if (!e.endTime) return acc;
    const s = new Date(e.startTime); const en = new Date(e.endTime);
    const sameDay = s.toDateString() === new Date().toDateString();
    if (sameDay) acc += (en.getTime() - s.getTime()) / 60_000;
    return acc;
  }, 0) + (isClockedIn ? elapsed / 60_000 : 0);
  const todayHours = Math.round((todayMinutes / 60) * 10) / 10;

  return (
    <>
      <OsPageHeader
        // One label per destination (principle 16): the Planner sidebar row,
        // the breadcrumb and the tab title all say "Clock in/out".
        title="Clock in/out"
        actions={
          <div className="clk__head-actions">
            <Link href="/timesheets" className="os-head__link"><Activity /> My timesheets</Link>
          </div>
        }
      />

      <div className="clk">
        {loadError ? (
          <OsEmptyView variant="error" title="Couldn't load clock" hint={loadError} action={{ label: "Try again", onClick: () => { void load(); } }} />
        ) : (
          <>
            {/* Hero — big clock face */}
            <section className={`clk__hero${isClockedIn ? " is-running" : ""}`}>
              <div className="clk__hero-meta">
                <span className={`clk__hero-state${isClockedIn ? " is-on" : ""}`}>
                  {isClockedIn ? <Activity /> : <Square />}
                  {isClockedIn ? "Clocked in" : "Clocked out"}
                </span>
                <span className="clk__hero-date">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
              </div>

              <div className="clk__hero-time">
                {isClockedIn ? fmtDuration(elapsed) : fmtTime(now)}
              </div>
              <div className="clk__hero-sub">
                {isClockedIn ? "elapsed this session" : "current time"}
              </div>

              <button type="button" className={`clk__hero-btn${isClockedIn ? " is-out" : ""}`} disabled={busy} onClick={punch}>
                {isClockedIn ? <><Square /> Clock out</> : <><Play /> Clock in</>}
              </button>

              {isClockedIn && (
                <div className="clk__hero-since">
                  <Clock /> Since {new Date(active.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </section>

            {/* Today summary + recent sessions. When the sessions read fails
                the two panels are the error line, never "0 h logged". */}
            {recentUnavailable ? (
              <ErrorState what="recent sessions" onRetry={() => { void load(); }} compact />
            ) : (
            <div className="clk__grid">
              <section className="clk__panel">
                <header className="clk__panel-head">
                  <CheckCircle2 /> Today
                </header>
                <div className="clk__today">
                  <div className="clk__today-big">{todayHours}<small>h</small></div>
                  <div className="clk__today-sub">logged today{isClockedIn ? " (counting now)" : ""}</div>
                </div>
                <Link href="/timesheets" className="clk__panel-link">
                  Go to timesheets <ArrowRight />
                </Link>
              </section>

              <section className="clk__panel">
                <header className="clk__panel-head">
                  <Coffee /> Recent sessions
                  <span className="clk__panel-sub">{recent.length}</span>
                </header>
                {recent.length === 0 ? (
                  <div className="clk__empty">No completed sessions yet today.</div>
                ) : (
                  <ul className="clk__sessions">
                    {recent.map((e) => {
                      const s = new Date(e.startTime); const en = e.endTime ? new Date(e.endTime) : null;
                      const dur = en ? en.getTime() - s.getTime() : 0;
                      return (
                        <li key={e.id} className="clk__session">
                          <div className="clk__session-info">
                            <div className="clk__session-time">
                              {s.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              {en && ` → ${en.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                            </div>
                            <div className="clk__session-date">{s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                          </div>
                          <div className="clk__session-dur">{fmtDuration(dur)}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
