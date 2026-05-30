"use client";

/* ITSM · Incidents — bespoke war-room with severity pills.
 *
 *  GET   /api/itsm/incidents
 *  POST  /api/itsm/incidents      { title, severity, ... }
 *  PATCH /api/itsm/incidents      { id, status?, ... }
 *
 * Layout:
 *   OsTitleBar with nav + Declare incident in actions.
 *   Severity ribbon (SEV1-5 pills + active counts, pulsing dot on actives).
 *   Stats strip: MTTA · MTTR · Active · Resolved 7d.
 *   2-col: Active war-room cards (left wide) + Resolved last 7d sidebar (right).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Plus, Clock, CheckCircle2, ExternalLink, Flame, Activity,
  Zap, FileText, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
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

const SEV_COLORS: Record<Sev, string> = {
  SEV1: C.red, SEV2: C.orange, SEV3: C.yellow, SEV4: C.blue, SEV5: C.gray,
};
const SEV_LABELS: Record<Sev, string> = {
  SEV1: "Critical", SEV2: "Major", SEV3: "Moderate", SEV4: "Minor", SEV5: "Low",
};
const SEV_ORDER: Sev[] = ["SEV1", "SEV2", "SEV3", "SEV4", "SEV5"];

const STATUS_COLORS: Record<IncidentStatus, string> = {
  DETECTED: C.red, INVESTIGATING: C.orange, IDENTIFIED: C.purple, MONITORING: C.blue, RESOLVED: C.green,
};
const STATUS_LABELS: Record<IncidentStatus, string> = {
  DETECTED: "Detected", INVESTIGATING: "Investigating", IDENTIFIED: "Identified",
  MONITORING: "Monitoring", RESOLVED: "Resolved",
};
const STATUS_FLOW: IncidentStatus[] = ["DETECTED", "INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"];
function nextStatus(s: IncidentStatus): IncidentStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
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
  const [sevFilter, setSevFilter] = useState<Sev | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncs(data.incidents ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // ─── Buckets ──────────────────────────────────────────────
  const active = useMemo(() => {
    let list = (incs ?? []).filter((i) => i.status !== "RESOLVED");
    if (sevFilter) list = list.filter((i) => i.severity === sevFilter);
    return list.sort((a, b) => a.severity.localeCompare(b.severity));
  }, [incs, sevFilter]);

  const resolved7d = useMemo(() => (incs ?? [])
    .filter((i) => i.status === "RESOLVED" && i.resolvedAt && (Date.now() - new Date(i.resolvedAt).getTime()) < 7 * MS_DAY)
    .sort((a, b) => new Date(b.resolvedAt!).getTime() - new Date(a.resolvedAt!).getTime()),
    [incs]);

  const ribbon = useMemo(() => SEV_ORDER.map((s) => ({
    sev: s,
    color: SEV_COLORS[s],
    count: (incs ?? []).filter((i) => i.severity === s && i.status !== "RESOLVED").length,
  })), [incs]);

  // ─── MTTA / MTTR ──────────────────────────────────────────
  const stats = useMemo(() => {
    const list = incs ?? [];
    const ackTimes = list.filter((i) => i.acknowledgedAt).map((i) => new Date(i.acknowledgedAt!).getTime() - new Date(i.startedAt).getTime());
    const resolvedTimes = list.filter((i) => i.resolvedAt).map((i) => new Date(i.resolvedAt!).getTime() - new Date(i.startedAt).getTime());
    const mtta = ackTimes.length === 0 ? null : ackTimes.reduce((a, b) => a + b, 0) / ackTimes.length;
    const mttr = resolvedTimes.length === 0 ? null : resolvedTimes.reduce((a, b) => a + b, 0) / resolvedTimes.length;
    return { mtta, mttr, activeCount: list.filter((i) => i.status !== "RESOLVED").length, resolved7d: resolved7d.length };
  }, [incs, resolved7d]);

  // ─── Actions ──────────────────────────────────────────────
  async function advance(inc: ApiIncident) {
    const next = nextStatus(inc.status);
    if (!next) return;
    const body: Record<string, unknown> = { id: inc.id, status: next };
    if (inc.status === "DETECTED") body.acknowledgedAt = new Date().toISOString();
    if (next === "RESOLVED") body.resolvedAt = new Date().toISOString();
    setIncs((prev) => prev?.map((i) => i.id === inc.id ? { ...i, ...body } as ApiIncident : i) ?? prev);
    try {
      const res = await fetch("/api/itsm/incidents", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      toast(`${inc.title} → ${STATUS_LABELS[next]}`);
      void load();
    } catch { toast("Couldn't advance status"); void load(); }
  }

  async function declareIncident() {
    try {
      const res = await fetch("/api/itsm/incidents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled incident", severity: "SEV3", status: "DETECTED" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Incident declared");
      void load();
    } catch { toast("Couldn't declare"); }
  }

  return (
    <>
      <OsTitleBar
        title="Incidents"
        Icon={Flame}
        iconGradient={GRAD.redPink}
        description={incs === null
          ? "Loading incidents…"
          : `${stats.activeCount} active · ${stats.resolved7d} resolved last 7d`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
        actions={
          <div className="incd__head-actions">
            <Link href="/itsm" className="incd__nav-link">Service desk</Link>
            <Link href="/itsm/problems" className="incd__nav-link">Problems</Link>
            <button type="button" className="incd__btn-primary" onClick={declareIncident}>
              <Plus /> Declare incident
            </button>
          </div>
        }
      />

      <div className="incd">
        {/* Severity ribbon (the "pills" per plan) */}
        <section className="incd__ribbon">
          {ribbon.map((r) => (
            <button
              key={r.sev}
              type="button"
              className={`incd__pill${r.count > 0 ? " is-hot" : ""}${sevFilter === r.sev ? " is-filter" : ""}`}
              style={{ ["--sev-c" as unknown as string]: r.color }}
              onClick={() => setSevFilter(sevFilter === r.sev ? null : r.sev)}
              title={`${r.sev} · ${SEV_LABELS[r.sev]}`}
            >
              {r.count > 0 && <span className="incd__pill-dot" aria-hidden="true" />}
              <span className="incd__pill-sev">{r.sev}</span>
              <span className="incd__pill-lbl">{SEV_LABELS[r.sev]}</span>
              <span className="incd__pill-count">{r.count}</span>
            </button>
          ))}
        </section>

        {/* Stats strip */}
        <div className="incd__stats">
          <StatTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="Active"      value={`${stats.activeCount}`}                       sub={stats.activeCount > 0 ? "needs attention" : "all clear"} />
          <StatTile accent="var(--os-c-orange)" Icon={Zap}           label="MTTA"        value={stats.mtta === null ? "—" : fmtDuration(stats.mtta)} sub="mean time to acknowledge" />
          <StatTile accent="var(--os-c-blue)"   Icon={Clock}         label="MTTR"        value={stats.mttr === null ? "—" : fmtDuration(stats.mttr)} sub="mean time to resolve" />
          <StatTile accent="var(--os-c-green)"  Icon={CheckCircle2}  label="Resolved 7d" value={`${stats.resolved7d}`}                          sub="closed last week" />
        </div>

        {/* Body 2-col */}
        <div className="incd__body">
          {/* Active war-room */}
          <section className="incd__panel incd__panel--active">
            <div className="incd__panel-head">
              <Activity /> Active war-room
              <span className="incd__panel-sub">{active.length} ongoing{sevFilter ? ` · ${sevFilter} filter` : ""}</span>
              {sevFilter && (
                <button type="button" className="incd__clear" onClick={() => setSevFilter(null)}>Clear filter</button>
              )}
            </div>

            {loadError ? (
              <OsEmptyView Icon={Flame} iconGradient={GRAD.redPink} title="Couldn't load incidents" subtitle={`API error: ${loadError}.`} cta="Retry" />
            ) : incs === null ? (
              <div className="incd__loading">Loading incidents…</div>
            ) : active.length === 0 ? (
              <div className="incd__calm">
                <CheckCircle2 />
                <div className="incd__calm-title">All clear</div>
                <div className="incd__calm-sub">{sevFilter ? `No active ${sevFilter} incidents.` : "No active incidents. Whoever's on call — enjoy the quiet."}</div>
              </div>
            ) : (
              <div className="incd__list">
                {active.map((i) => <ActiveCard key={i.id} incident={i} onAdvance={advance} />)}
              </div>
            )}
          </section>

          {/* Resolved 7d sidebar */}
          <aside className="incd__panel incd__panel--side">
            <div className="incd__panel-head">
              <CheckCircle2 /> Resolved last 7d
              <span className="incd__panel-sub">{resolved7d.length}</span>
            </div>
            {resolved7d.length === 0 ? (
              <div className="incd__sidempty">Nothing resolved this week yet.</div>
            ) : (
              <ul className="incd__resolved">
                {resolved7d.slice(0, 12).map((i) => {
                  const dur = i.resolvedAt ? new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime() : 0;
                  return (
                    <li key={i.id} className="incd__resolved-row" style={{ ["--sev-c" as unknown as string]: SEV_COLORS[i.severity] }}>
                      <span className="incd__resolved-sev">{i.severity}</span>
                      <div className="incd__resolved-main">
                        <div className="incd__resolved-title">{i.title}</div>
                        <div className="incd__resolved-meta">
                          <span className="incd__resolved-dur"><Clock /> {fmtDuration(dur)}</span>
                          {i.rootCause && <span className="incd__resolved-rc">Root cause logged</span>}
                          {i.postmortemUrl && (
                            <a href={i.postmortemUrl} target="_blank" rel="noopener noreferrer" className="incd__resolved-pm" onClick={(e) => e.stopPropagation()}>
                              <FileText /> Postmortem
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function StatTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Clock; label: string; value: string; sub: string }) {
  return (
    <div className="incd__stat" style={{ ["--stat-c" as unknown as string]: accent }}>
      <span className="incd__stat-accent" aria-hidden="true" />
      <div className="incd__stat-row">
        <div className="incd__stat-icon"><Icon /></div>
        <div className="incd__stat-label">{label}</div>
      </div>
      <div className="incd__stat-value">{value}</div>
      <div className="incd__stat-sub">{sub}</div>
    </div>
  );
}

function ActiveCard({ incident: i, onAdvance }: { incident: ApiIncident; onAdvance: (i: ApiIncident) => void }) {
  const since = Date.now() - new Date(i.startedAt).getTime();
  const ackTime = i.acknowledgedAt ? new Date(i.acknowledgedAt).getTime() - new Date(i.startedAt).getTime() : null;
  const next = nextStatus(i.status);
  const affected = affectedList(i.affectedServices);
  const sevColor = SEV_COLORS[i.severity];
  const statusColor = STATUS_COLORS[i.status];
  const commanderAv = i.commanderId ? { initials: i.commanderId.slice(0, 2).toUpperCase(), color: avColor(i.commanderId) } : null;

  return (
    <article className="incd__card" style={{ ["--sev-c" as unknown as string]: sevColor }}>
      <span className="incd__card-accent" aria-hidden="true" />

      <div className="incd__card-sev">
        <span className="incd__card-sev-pill">{i.severity}</span>
        <span className="incd__card-sev-lbl">{SEV_LABELS[i.severity]}</span>
      </div>

      <div className="incd__card-main">
        <Link href={`/itsm/${i.id}`} className="incd__card-title">{i.title}</Link>
        {i.summary && <p className="incd__card-summary">{i.summary}</p>}

        {affected.length > 0 && (
          <div className="incd__card-affected">
            <span className="incd__card-affected-lbl">Affected:</span>
            {affected.slice(0, 6).map((s) => (
              <span key={s} className="incd__card-svc">{s}</span>
            ))}
            {affected.length > 6 && <span className="incd__card-svc incd__card-svc--more">+{affected.length - 6}</span>}
          </div>
        )}

        {/* Status flow stepper */}
        <div className="incd__flow">
          {STATUS_FLOW.filter((s) => s !== "RESOLVED").map((s, idx) => {
            const currentIdx = STATUS_FLOW.indexOf(i.status);
            const isCurrent = s === i.status;
            const isPast = currentIdx >= 0 && idx < currentIdx;
            const tone = isCurrent ? "current" : isPast ? "past" : "future";
            return (
              <span key={s} className={`incd__flow-step incd__flow-step--${tone}`} style={{ ["--step-c" as unknown as string]: STATUS_COLORS[s] }}>
                <span className="incd__flow-dot">{idx + 1}</span>
                <span className="incd__flow-lbl">{STATUS_LABELS[s]}</span>
              </span>
            );
          })}
        </div>

        <div className="incd__card-metrics">
          <div className="incd__card-metric">
            <span>Elapsed</span>
            <strong><Clock /> {fmtDuration(since)}</strong>
          </div>
          <div className="incd__card-metric">
            <span>MTTA</span>
            <strong>{ackTime !== null ? fmtDuration(ackTime) : "—"}</strong>
          </div>
          <div className="incd__card-metric">
            <span>Status</span>
            <strong className="incd__card-metric-status" style={{ ["--s-c" as unknown as string]: statusColor }}>
              {STATUS_LABELS[i.status]}
            </strong>
          </div>
          {commanderAv && (
            <div className="incd__card-metric">
              <span>IC</span>
              <strong className="incd__card-metric-ic">
                <span className="incd__card-ic" style={{ background: commanderAv.color }}>{commanderAv.initials}</span>
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="incd__card-actions">
        {next && (
          <button type="button" className="incd__card-advance" onClick={() => onAdvance(i)}>
            <ChevronRight /> {STATUS_LABELS[next]}
          </button>
        )}
        {i.postmortemUrl && (
          <a href={i.postmortemUrl} target="_blank" rel="noopener noreferrer" className="incd__card-pm">
            <ExternalLink /> Postmortem
          </a>
        )}
      </div>
    </article>
  );
}
