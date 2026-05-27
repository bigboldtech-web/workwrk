"use client";

/* ITSM · Incidents — live war-room.
 *
 * Two zones:
 *   - Top: severity ribbon (SEV1..SEV5 cards with active counts) + a
 *     prominent "Declare incident" CTA.
 *   - Below: ACTIVE incidents as expanded "incident cards" — title,
 *     severity ring, status pill, MTTA/MTTR timers, affected services,
 *     commander avatar, action row (acknowledge / resolve / postmortem).
 *   - Footer: collapsed "Resolved last 7d" recap.
 *
 * GET   /api/itsm/incidents
 * POST  /api/itsm/incidents      { title, severity, ... }
 * PATCH /api/itsm/incidents      { id, status?, rootCause? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, Clock, CheckCircle2, ExternalLink, FlameKindling } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Sev = "SEV1" | "SEV2" | "SEV3" | "SEV4" | "SEV5";
type IncidentStatus = "DETECTED" | "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";

type ApiIncident = {
  id: string;
  title: string;
  summary?: string | null;
  severity: Sev;
  status: IncidentStatus;
  commanderId?: string | null;
  affectedServices?: unknown;
  startedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  rootCause?: string | null;
  postmortemUrl?: string | null;
};

const SEV_HUE: Record<Sev, string> = {
  SEV1: "var(--os-c-red)", SEV2: "var(--os-c-orange)", SEV3: "var(--os-c-yellow)",
  SEV4: "var(--os-c-blue)", SEV5: "var(--os-c-darkgray)",
};
const SEV_LABEL: Record<Sev, string> = {
  SEV1: "Critical", SEV2: "Major", SEV3: "Moderate", SEV4: "Minor", SEV5: "Low",
};
const STATUS_LABEL: Record<IncidentStatus, string> = {
  DETECTED: "Detected", INVESTIGATING: "Investigating", IDENTIFIED: "Identified",
  MONITORING: "Monitoring", RESOLVED: "Resolved",
};
const STATUS_HUE: Record<IncidentStatus, string> = {
  DETECTED: "var(--os-c-red)", INVESTIGATING: "var(--os-c-orange)",
  IDENTIFIED: "var(--os-c-purple)", MONITORING: "var(--os-c-blue)", RESOLVED: "var(--os-c-green)",
};
const STATUS_FLOW: IncidentStatus[] = ["DETECTED", "INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"];
function nextStatus(s: IncidentStatus): IncidentStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
function formatDuration(ms: number): string {
  const m = Math.floor(ms / MS_MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
function affectedList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

export default function IncidentsPage() {
  const [incs, setIncs] = useState<ApiIncident[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncs(data.incidents ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const active = useMemo(() => (incs ?? []).filter((i) => i.status !== "RESOLVED")
    .sort((a, b) => (a.severity.localeCompare(b.severity))), [incs]);
  const resolvedRecent = useMemo(() => (incs ?? [])
    .filter((i) => i.status === "RESOLVED" && i.resolvedAt && (Date.now() - new Date(i.resolvedAt).getTime()) < 7 * MS_DAY)
    .sort((a, b) => new Date(b.resolvedAt!).getTime() - new Date(a.resolvedAt!).getTime()), [incs]);

  const ribbon: { sev: Sev; count: number }[] = (["SEV1", "SEV2", "SEV3", "SEV4", "SEV5"] as Sev[]).map((s) => ({
    sev: s, count: active.filter((i) => i.severity === s).length,
  }));

  async function advance(inc: ApiIncident) {
    const next = nextStatus(inc.status);
    if (!next) return;
    const body: Record<string, unknown> = { id: inc.id, status: next };
    if (inc.status === "DETECTED") body.acknowledgedAt = new Date().toISOString();
    if (next === "RESOLVED") body.resolvedAt = new Date().toISOString();
    try {
      const res = await fetch("/api/itsm/incidents", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(`${inc.title} → ${STATUS_LABEL[next]}`);
      void load();
    } catch { toast("Couldn't advance status"); }
  }

  async function declareIncident() {
    const title = window.prompt("What's broken? (1-line incident title)")?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/itsm/incidents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, severity: "SEV3", status: "DETECTED" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Incident declared");
      void load();
    } catch { toast("Couldn't declare"); }
  }

  return (
    <div className="inc">
      <header className="inc__head">
        <div className="inc__head-l">
          <div className="inc__icon"><FlameKindling /></div>
          <div>
            <h1 className="inc__title">Incidents</h1>
            <div className="inc__sub">
              {incs === null ? "Loading…" : `${active.length} active · ${resolvedRecent.length} resolved last 7d`}
            </div>
          </div>
        </div>
        <button type="button" className="inc__declare" onClick={declareIncident}>
          <Plus /> Declare incident
        </button>
      </header>

      <section className="inc__ribbon">
        {ribbon.map((r) => (
          <div key={r.sev} className={`inc-ribbon ${r.count > 0 ? "is-active" : ""}`} style={{ ["--sev-hue" as string]: SEV_HUE[r.sev] }}>
            <span className="inc-ribbon__sev">{r.sev}</span>
            <span className="inc-ribbon__lbl">{SEV_LABEL[r.sev]}</span>
            <span className="inc-ribbon__count">{r.count}</span>
          </div>
        ))}
      </section>

      {loadError ? (
        <div className="inc__error">{loadError}</div>
      ) : incs === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : active.length === 0 ? (
        <div className="inc__calm">
          <CheckCircle2 />
          <div>
            <h3>All clear.</h3>
            <p>No active incidents. Whoever&apos;s on call, enjoy the quiet.</p>
          </div>
        </div>
      ) : (
        <div className="inc__list">
          {active.map((i) => {
            const since = Date.now() - new Date(i.startedAt).getTime();
            const ackTime = i.acknowledgedAt ? new Date(i.acknowledgedAt).getTime() - new Date(i.startedAt).getTime() : null;
            const next = nextStatus(i.status);
            const affected = affectedList(i.affectedServices);
            return (
              <article key={i.id} className="inc-card" style={{ ["--sev-hue" as string]: SEV_HUE[i.severity] }}>
                <div className="inc-card__sev">
                  <span>{i.severity}</span>
                </div>
                <div className="inc-card__main">
                  <header className="inc-card__head">
                    <h3>{i.title}</h3>
                    <span className="inc-card__status" style={{ background: STATUS_HUE[i.status] }}>{STATUS_LABEL[i.status]}</span>
                  </header>
                  {i.summary && <p className="inc-card__summary">{i.summary}</p>}
                  {affected.length > 0 && (
                    <div className="inc-card__svcs">
                      <small>Affected:</small>
                      {affected.slice(0, 6).map((s) => <span key={s} className="inc-card__svc">{s}</span>)}
                    </div>
                  )}
                  <div className="inc-card__metrics">
                    <div><span>Elapsed</span><strong><Clock /> {formatDuration(since)}</strong></div>
                    <div><span>MTTA</span><strong>{ackTime != null ? formatDuration(ackTime) : "—"}</strong></div>
                    <div><span>Status</span><strong>{STATUS_LABEL[i.status]}</strong></div>
                  </div>
                </div>
                <div className="inc-card__actions">
                  {next && (
                    <button type="button" className="inc-card__btn inc-card__btn--primary" onClick={() => advance(i)}>
                      → {STATUS_LABEL[next]}
                    </button>
                  )}
                  {i.postmortemUrl && (
                    <a href={i.postmortemUrl} target="_blank" rel="noopener" className="inc-card__btn">
                      Postmortem <ExternalLink />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {resolvedRecent.length > 0 && (
        <section className="inc__recap">
          <h2>Resolved last 7 days · {resolvedRecent.length}</h2>
          <div className="inc__recap-list">
            {resolvedRecent.slice(0, 8).map((i) => {
              const dur = i.resolvedAt ? new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime() : 0;
              return (
                <div key={i.id} className="inc-recap">
                  <span className="inc-recap__sev" style={{ background: SEV_HUE[i.severity] }}>{i.severity}</span>
                  <span className="inc-recap__title">{i.title}</span>
                  <span className="inc-recap__dur">{formatDuration(dur)}</span>
                  {i.rootCause && <span className="inc-recap__rc" title={i.rootCause}>Root cause logged</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
