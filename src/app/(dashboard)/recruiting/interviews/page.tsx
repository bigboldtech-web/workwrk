"use client";

/* Recruiting · Interviews — day-grouped schedule.
 *
 * Lists upcoming interviews grouped by day (Today / Tomorrow / weekday).
 * Each row: time, type pill, candidate, job, interviewer, location/link,
 * status. Past interviews collapse into a <details> block at the bottom
 * with scores when present.
 *
 * GET /api/recruiting/interviews
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, Mail, Star, User } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type IntType = "SCREEN" | "TECHNICAL" | "BEHAVIORAL" | "ONSITE" | "FINAL" | "OTHER";
type IntStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

type ApiInterview = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  type: IntType;
  location?: string | null;
  status: IntStatus;
  score?: number | null;
  notes?: string | null;
  interviewer?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  application?: {
    id: string;
    stage: string;
    candidate?: { id: string; firstName: string; lastName: string; email?: string | null } | null;
    job?: { id: string; title: string } | null;
  } | null;
};

const TYPE_HUE: Record<IntType, string> = {
  SCREEN: "var(--os-c-blue)", TECHNICAL: "var(--os-c-purple)",
  BEHAVIORAL: "var(--os-c-pink)", ONSITE: "var(--os-c-orange)",
  FINAL: "var(--os-c-green)", OTHER: "var(--os-c-darkgray)",
};
const TYPE_LABEL: Record<IntType, string> = {
  SCREEN: "Screen", TECHNICAL: "Technical", BEHAVIORAL: "Behavioural",
  ONSITE: "Onsite", FINAL: "Final", OTHER: "Other",
};
const STATUS_LABEL: Record<IntStatus, string> = {
  SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};
const STATUS_HUE: Record<IntStatus, string> = {
  SCHEDULED: "var(--os-c-indigo)", COMPLETED: "var(--os-c-green)",
  CANCELLED: "var(--os-c-darkgray)", NO_SHOW: "var(--os-c-red)",
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function dayLabel(d: Date): string {
  const today = new Date();
  if (sameDay(d, today)) return "Today";
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

export default function InterviewsPage() {
  const [items, setItems] = useState<ApiInterview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiting/interviews");
      if (res.status === 403) { setLoadError("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("recruiting");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const today0 = startOfDay(new Date()).getTime();

  const upcoming = useMemo(() => (items ?? []).filter((i) => new Date(i.scheduledAt).getTime() >= today0).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()), [items, today0]);
  const past = useMemo(() => (items ?? []).filter((i) => new Date(i.scheduledAt).getTime() < today0).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()), [items, today0]);

  const groupedByDay = useMemo(() => {
    const m = new Map<string, ApiInterview[]>();
    for (const i of upcoming) {
      const d = startOfDay(new Date(i.scheduledAt));
      const k = d.toISOString().slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return Array.from(m.entries()).map(([k, items]) => ({ key: k, day: new Date(k), items }));
  }, [upcoming]);

  const todayCount = upcoming.filter((i) => sameDay(new Date(i.scheduledAt), new Date())).length;
  const thisWeekCount = upcoming.filter((i) => {
    const t = new Date(i.scheduledAt).getTime();
    return t >= today0 && t < today0 + 7 * MS_DAY;
  }).length;

  return (
    <div className="ivs">
      <header className="ivs__head">
        <div className="ivs__head-l">
          <div className="ivs__icon"><CalendarDays /></div>
          <div>
            <h1 className="ivs__title">Interview schedule</h1>
            <div className="ivs__sub">
              {items === null ? "Loading…" : `${upcoming.length} upcoming · ${todayCount} today · ${thisWeekCount} this week`}
            </div>
          </div>
        </div>
        <Link href="/recruiting/pipeline" className="ivs__link">Pipeline →</Link>
      </header>

      {loadError ? (
        <div className="ivs__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="ivs__empty">
          <CalendarDays />
          <div>
            <h3>No interviews scheduled</h3>
            <p>Schedule interviews from the candidate&apos;s application drawer in the pipeline view.</p>
          </div>
        </div>
      ) : (
        <>
          {groupedByDay.length === 0 ? (
            <div className="ivs__empty">
              <CalendarDays />
              <div>
                <h3>Nothing upcoming</h3>
                <p>Expand &ldquo;Past interviews&rdquo; below to browse the history.</p>
              </div>
            </div>
          ) : (
            <div className="ivs__days">
              {groupedByDay.map(({ key, day, items }) => (
                <section key={key} className="ivs-day">
                  <header className="ivs-day__head">
                    <h2>{dayLabel(day)}</h2>
                    <span>{items.length} interview{items.length === 1 ? "" : "s"}</span>
                  </header>
                  <div className="ivs-day__list">
                    {items.map((iv) => {
                      const cand = iv.application?.candidate;
                      const candName = cand ? `${cand.firstName} ${cand.lastName}` : "Unknown";
                      const isExternal = iv.location?.startsWith("http");
                      return (
                        <article key={iv.id} className="iv-row">
                          <div className="iv-row__time">
                            <strong>{fmtTime(iv.scheduledAt)}</strong>
                            <span>{iv.durationMinutes}m</span>
                          </div>
                          <span className="iv-row__type" style={{ background: TYPE_HUE[iv.type] }}>{TYPE_LABEL[iv.type]}</span>
                          <div className="iv-row__main">
                            <div className="iv-row__cand">
                              {cand && <span className="iv-row__av" style={{ background: avColor(cand.id) }}>{initials(cand.firstName, cand.lastName)}</span>}
                              <span className="iv-row__name">{candName}</span>
                              {iv.application?.job?.title && <span className="iv-row__job">for {iv.application.job.title}</span>}
                            </div>
                            <div className="iv-row__meta">
                              {iv.interviewer && <span><User /> {[iv.interviewer.firstName, iv.interviewer.lastName].filter(Boolean).join(" ")}</span>}
                              {iv.location && (
                                isExternal ? (
                                  <a href={iv.location} target="_blank" rel="noopener" className="iv-row__loc">
                                    <ExternalLink /> Join
                                  </a>
                                ) : <span>📍 {iv.location}</span>
                              )}
                              {cand?.email && <a href={`mailto:${cand.email}`}><Mail /></a>}
                            </div>
                          </div>
                          <span className="iv-row__status" style={{ background: STATUS_HUE[iv.status] }}>{STATUS_LABEL[iv.status]}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <details className="ivs__past">
              <summary>Past interviews · {past.length}</summary>
              <div className="ivs__past-list">
                {past.slice(0, 20).map((iv) => {
                  const cand = iv.application?.candidate;
                  const candName = cand ? `${cand.firstName} ${cand.lastName}` : "Unknown";
                  return (
                    <div key={iv.id} className="iv-past">
                      <span className="iv-past__date">{new Date(iv.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <span className="iv-past__type" style={{ background: TYPE_HUE[iv.type] }}>{TYPE_LABEL[iv.type]}</span>
                      <span className="iv-past__cand">{candName}</span>
                      {iv.application?.job?.title && <em>{iv.application.job.title}</em>}
                      {iv.score != null && <span className="iv-past__score"><Star /> {iv.score}/5</span>}
                      <span className="iv-past__status" style={{ background: STATUS_HUE[iv.status] }}>{STATUS_LABEL[iv.status]}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
