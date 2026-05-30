"use client";

/* ITSM · Problems — bespoke root-cause card view.
 *
 * A "problem" in ITIL = the recurring underlying cause of one or more
 * incidents. We derive problems from /api/itsm/incidents by clustering on
 * `rootCause` (or summary if rootCause is empty), counting how many incidents
 * share each cluster, totaling severity weight, and showing trend + open count.
 *
 *  Reads: GET /api/itsm/incidents
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GitBranch, AlertOctagon, Flame, Clock, ChevronDown,
  TrendingUp, TrendingDown, Minus, Activity, Repeat,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type Sev = "SEV1" | "SEV2" | "SEV3" | "SEV4" | "SEV5";
type IncidentStatus = "DETECTED" | "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";

type ApiIncident = {
  id: string;
  title: string;
  summary?: string | null;
  severity: Sev;
  status: IncidentStatus;
  rootCause?: string | null;
  affectedServices?: unknown;
  startedAt: string;
  resolvedAt?: string | null;
};

const SEV_WEIGHT: Record<Sev, number> = { SEV1: 5, SEV2: 4, SEV3: 3, SEV4: 2, SEV5: 1 };
const SEV_COLORS: Record<Sev, string> = {
  SEV1: C.red, SEV2: C.orange, SEV3: C.yellow, SEV4: C.blue, SEV5: C.gray,
};

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

type Trend = "up" | "down" | "flat";
type Cluster = {
  key: string;
  label: string;
  rootCause: string | null;
  incidents: ApiIncident[];
  totalWeight: number;
  open: number;
  lastSeen: number;
  dominantSev: Sev;
  trend: Trend;
  recentCount: number; // last 7 days
  priorCount: number;  // 7-14 days ago
  affected: Set<string>;
};

function clusterKey(inc: ApiIncident): string {
  if (inc.rootCause && inc.rootCause.trim()) {
    return inc.rootCause.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 4).join(" ").trim() || "unknown";
  }
  if (inc.summary) return "unclassified:" + inc.summary.slice(0, 40).toLowerCase();
  return "unclassified:" + inc.title.slice(0, 40).toLowerCase();
}
function affectedList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProblemsPage() {
  const [incidents, setIncidents] = useState<ApiIncident[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const [scope, setScope] = useState<"recurring" | "all">("recurring");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // ─── Clusters ─────────────────────────────────────────────
  const clusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    const now = Date.now();
    for (const inc of incidents ?? []) {
      const key = clusterKey(inc);
      let c = map.get(key);
      if (!c) {
        c = {
          key, label: "", rootCause: inc.rootCause ?? null,
          incidents: [], totalWeight: 0, open: 0, lastSeen: 0,
          dominantSev: "SEV5", trend: "flat", recentCount: 0, priorCount: 0,
          affected: new Set(),
        };
        map.set(key, c);
      }
      c.incidents.push(inc);
      c.totalWeight += SEV_WEIGHT[inc.severity] ?? 1;
      if (inc.status !== "RESOLVED") c.open += 1;
      const t = new Date(inc.startedAt).getTime();
      if (t > c.lastSeen) c.lastSeen = t;
      const age = now - t;
      if (age < MS_WEEK) c.recentCount++;
      else if (age < 2 * MS_WEEK) c.priorCount++;
      if (SEV_WEIGHT[inc.severity] > SEV_WEIGHT[c.dominantSev]) c.dominantSev = inc.severity;
      for (const s of affectedList(inc.affectedServices)) c.affected.add(s);
    }
    for (const c of map.values()) {
      const latest = [...c.incidents].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
      c.label = c.rootCause || latest?.title || c.key;
      // Trend: recent vs prior week
      if (c.recentCount > c.priorCount) c.trend = "up";
      else if (c.recentCount < c.priorCount) c.trend = "down";
      else c.trend = "flat";
    }
    return Array.from(map.values())
      .filter((c) => c.incidents.length >= 1)
      .sort((a, b) => b.totalWeight - a.totalWeight || b.incidents.length - a.incidents.length);
  }, [incidents]);

  const recurring = clusters.filter((c) => c.incidents.length >= 2);
  const single = clusters.filter((c) => c.incidents.length === 1);

  const visible = scope === "recurring" ? recurring : clusters;

  // ─── KPIs ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = incidents ?? [];
    const open = list.filter((i) => i.status !== "RESOLVED").length;
    const sev1 = list.filter((i) => i.severity === "SEV1").length;
    const trending = recurring.filter((c) => c.trend === "up").length;
    return { totalIncidents: list.length, open, sev1, patterns: clusters.length, recurring: recurring.length, trending };
  }, [incidents, clusters, recurring]);

  return (
    <>
      <OsTitleBar
        title="Problems"
        Icon={GitBranch}
        iconGradient={GRAD.pinkPurple}
        description={incidents === null
          ? "Computing patterns…"
          : `${stats.patterns} pattern${stats.patterns === 1 ? "" : "s"} · ${stats.recurring} recurring · ${stats.open} open incidents`}
        people={[PEOPLE.ak, PEOPLE.vn, PEOPLE.rj]}
        morePeople={4}
        actions={
          <div className="prbm__head-actions">
            <Link href="/itsm" className="prbm__nav-link">Service desk</Link>
            <Link href="/itsm/incidents" className="prbm__nav-link">Incidents</Link>
          </div>
        }
      />

      <div className="prbm">
        {/* KPI strip */}
        <div className="prbm__stats">
          <StatTile accent="var(--os-c-pink)"   Icon={Repeat}       label="Patterns"   value={`${stats.patterns}`}   sub={`${stats.recurring} recurring`} />
          <StatTile accent="var(--os-c-red)"    Icon={TrendingUp}   label="Trending"   value={`${stats.trending}`}   sub="getting worse this week" />
          <StatTile accent="var(--os-c-orange)" Icon={AlertOctagon} label="Open"       value={`${stats.open}`}       sub="across all patterns" />
          <StatTile accent="var(--os-c-purple)" Icon={Flame}        label="SEV1"       value={`${stats.sev1}`}       sub="critical incidents" />
        </div>

        {/* Scope tabs */}
        <div className="prbm__scope">
          <button type="button" className={scope === "recurring" ? "is-active" : ""} onClick={() => setScope("recurring")}>
            Recurring patterns
            <span className="prbm__scope-count">{recurring.length}</span>
          </button>
          <button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>
            All patterns
            <span className="prbm__scope-count">{clusters.length}</span>
          </button>
          <span className="prbm__scope-tag">Patterns are derived from <strong>rootCause</strong>. Investigate the recurring ones first — that's where the leverage is.</span>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={GitBranch} iconGradient={GRAD.redPink} title="Couldn't load problems" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : incidents === null ? (
          <div className="prbm__loading">Computing patterns…</div>
        ) : clusters.length === 0 ? (
          <OsEmptyView
            Icon={AlertOctagon}
            iconGradient={GRAD.pinkPurple}
            title="No incidents to learn from yet"
            subtitle="Once your team declares incidents and records a root cause, recurring patterns surface here automatically."
            cta="Go to incidents"
          />
        ) : visible.length === 0 ? (
          <div className="prbm__empty">
            <Repeat />
            <div>No recurring patterns. Every incident has been unique — keep monitoring.</div>
          </div>
        ) : (
          <>
            <div className="prbm__grid">
              {visible.map((c) => (
                <ClusterCard
                  key={c.key}
                  cluster={c}
                  isOpen={openCluster === c.key}
                  onToggle={() => setOpenCluster(openCluster === c.key ? null : c.key)}
                />
              ))}
            </div>

            {scope === "recurring" && single.length > 0 && (
              <section className="prbm__section">
                <header className="prbm__section-head">
                  <h2>One-off incidents</h2>
                  <span className="prbm__section-count">{single.length}</span>
                </header>
                <div className="prbm__grid prbm__grid--compact">
                  {single.slice(0, 18).map((c) => (
                    <ClusterCard
                      key={c.key}
                      cluster={c}
                      isOpen={openCluster === c.key}
                      onToggle={() => setOpenCluster(openCluster === c.key ? null : c.key)}
                      compact
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ClusterCard({ cluster: c, isOpen, onToggle, compact = false }: { cluster: Cluster; isOpen: boolean; onToggle: () => void; compact?: boolean }) {
  const sevColor = SEV_COLORS[c.dominantSev];
  const TrendIcon = c.trend === "up" ? TrendingUp : c.trend === "down" ? TrendingDown : Minus;
  const trendClass = c.trend === "up" ? "is-up" : c.trend === "down" ? "is-down" : "is-flat";

  // Build sparkline: 7-day bars showing incident count per day
  const dayBuckets = Array.from({ length: 7 }, (_, i) => {
    const dayStart = Date.now() - (6 - i) * MS_DAY;
    const dayEnd = dayStart + MS_DAY;
    return c.incidents.filter((inc) => {
      const t = new Date(inc.startedAt).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
  });
  const maxBar = Math.max(1, ...dayBuckets);

  return (
    <article
      className={`prbm__card${c.open > 0 ? " is-active" : ""}${compact ? " is-compact" : ""}`}
      style={{ ["--card-c" as unknown as string]: sevColor }}
    >
      <button type="button" className="prbm__card-head" onClick={onToggle}>
        <span className="prbm__card-sev">
          <span className="prbm__card-sev-pill">{c.dominantSev}</span>
        </span>

        <div className="prbm__card-main">
          <div className="prbm__card-label">{c.label}</div>
          <div className="prbm__card-meta">
            <span className="prbm__card-stat">
              <Flame /> {c.incidents.length} incident{c.incidents.length === 1 ? "" : "s"}
            </span>
            <span className="prbm__card-stat">
              <Clock /> {timeAgo(c.lastSeen)}
            </span>
            {c.open > 0 ? (
              <span className="prbm__card-stat prbm__card-stat--bad">{c.open} open</span>
            ) : (
              <span className="prbm__card-stat prbm__card-stat--good">all resolved</span>
            )}
            {c.incidents.length >= 2 && (
              <span className={`prbm__card-trend prbm__card-trend--${trendClass}`}>
                <TrendIcon />
                {c.trend === "up" && `${c.recentCount - c.priorCount} more this week`}
                {c.trend === "down" && `${c.priorCount - c.recentCount} fewer this week`}
                {c.trend === "flat" && (c.recentCount === 0 ? "quiet week" : "steady")}
              </span>
            )}
          </div>

          {!compact && c.affected.size > 0 && (
            <div className="prbm__card-affected">
              {Array.from(c.affected).slice(0, 5).map((s) => (
                <span key={s} className="prbm__card-svc">{s}</span>
              ))}
              {c.affected.size > 5 && <span className="prbm__card-svc prbm__card-svc--more">+{c.affected.size - 5}</span>}
            </div>
          )}
        </div>

        {!compact && (
          <div className="prbm__card-spark" aria-hidden="true" title="Incident count over the last 7 days">
            {dayBuckets.map((n, i) => (
              <span
                key={i}
                className="prbm__card-bar"
                style={{ height: `${Math.max(8, (n / maxBar) * 100)}%`, opacity: n > 0 ? 1 : 0.3 }}
              />
            ))}
          </div>
        )}

        <ChevronDown className={`prbm__card-chev${isOpen ? " is-open" : ""}`} />
      </button>

      {isOpen && (
        <div className="prbm__card-body">
          <ul className="prbm__incs">
            {c.incidents.slice(0, 16).map((inc) => {
              const sev = SEV_COLORS[inc.severity];
              const resolved = inc.status === "RESOLVED";
              return (
                <li key={inc.id} className="prbm__inc">
                  <Link href={`/itsm/${inc.id}`} className="prbm__inc-link">
                    <span className="prbm__inc-sev" style={{ background: sev, color: "white" }}>{inc.severity}</span>
                    <span className="prbm__inc-title">{inc.title}</span>
                    <span className="prbm__inc-meta">
                      <span className={resolved ? "prbm__inc-status prbm__inc-status--good" : "prbm__inc-status prbm__inc-status--bad"}>
                        {resolved ? "Resolved" : inc.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                      <span>·</span>
                      <span>{timeAgo(new Date(inc.startedAt).getTime())}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {c.incidents.length > 16 && (
            <div className="prbm__inc-more">+ {c.incidents.length - 16} more in this pattern</div>
          )}
        </div>
      )}
    </article>
  );
}

function StatTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Repeat; label: string; value: string; sub: string }) {
  return (
    <div className="prbm__stat" style={{ ["--stat-c" as unknown as string]: accent }}>
      <span className="prbm__stat-accent" aria-hidden="true" />
      <div className="prbm__stat-row">
        <div className="prbm__stat-icon"><Icon /></div>
        <div className="prbm__stat-label">{label}</div>
      </div>
      <div className="prbm__stat-value">{value}</div>
      <div className="prbm__stat-sub">{sub}</div>
    </div>
  );
}
