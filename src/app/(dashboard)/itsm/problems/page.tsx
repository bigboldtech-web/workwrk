"use client";

/* ITSM · Problems — root-cause clusters across incidents.
 *
 * A "problem" in ITIL = the recurring underlying cause of one or more
 * incidents. We derive problems from /api/itsm/incidents by grouping on
 * `rootCause` (or category if rootCause is empty), counting how many
 * incidents share each cluster, totaling severity weight, and showing
 * the most recent occurrence.
 *
 * This is investigation UI — calm cards arranged biggest-pattern-first,
 * not a list. Click a cluster to see the underlying incidents.
 *
 * Reads: GET /api/itsm/incidents
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, AlertOctagon, Flame, Clock, ChevronRight } from "lucide-react";
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
const SEV_COLOR: Record<Sev, string> = {
  SEV1: "var(--os-c-red)", SEV2: "var(--os-c-orange)", SEV3: "var(--os-c-yellow)",
  SEV4: "var(--os-c-blue)", SEV5: "var(--os-c-darkgray)",
};

type Cluster = {
  key: string;
  label: string;
  rootCause: string | null;
  incidents: ApiIncident[];
  totalWeight: number;
  open: number;
  lastSeen: number;
};

function clusterKey(inc: ApiIncident): string {
  if (inc.rootCause && inc.rootCause.trim()) {
    // bucket by the first 4 words to merge slight phrasing variants
    return inc.rootCause.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 4).join(" ").trim() || "unknown";
  }
  if (inc.summary) {
    return "unclassified:" + inc.summary.slice(0, 40).toLowerCase();
  }
  return "unclassified:" + inc.title.slice(0, 40).toLowerCase();
}

function clusterLabel(c: Cluster): string {
  if (c.rootCause) return c.rootCause;
  // pick the most recent incident's title as the cluster label
  const latest = [...c.incidents].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  return latest?.title ?? c.key;
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
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/itsm/incidents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIncidents(data.incidents ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("itsm");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const clusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, Cluster>();
    for (const inc of incidents ?? []) {
      const key = clusterKey(inc);
      if (!map.has(key)) {
        map.set(key, { key, label: "", rootCause: inc.rootCause ?? null, incidents: [], totalWeight: 0, open: 0, lastSeen: 0 });
      }
      const c = map.get(key)!;
      c.incidents.push(inc);
      c.totalWeight += SEV_WEIGHT[inc.severity] ?? 1;
      if (inc.status !== "RESOLVED") c.open += 1;
      const t = new Date(inc.startedAt).getTime();
      if (t > c.lastSeen) c.lastSeen = t;
    }
    for (const c of map.values()) c.label = clusterLabel(c);
    return Array.from(map.values())
      .filter((c) => c.incidents.length >= 1)
      .sort((a, b) => b.totalWeight - a.totalWeight || b.incidents.length - a.incidents.length);
  }, [incidents]);

  // Group clusters by "Recurring" (>=2 incidents) vs "Single" (1 incident)
  const recurring = clusters.filter((c) => c.incidents.length >= 2);
  const single = clusters.filter((c) => c.incidents.length === 1);

  const totalOpenIncidents = (incidents ?? []).filter((i) => i.status !== "RESOLVED").length;
  const totalSev1 = (incidents ?? []).filter((i) => i.severity === "SEV1").length;

  return (
    <div className="problems">
      <header className="problems__head">
        <div className="problems__head-l">
          <div className="problems__icon"><GitBranch /></div>
          <div>
            <h1 className="problems__title">Problems</h1>
            <div className="problems__sub">
              {incidents === null ? "Computing patterns…" : (
                <>{clusters.length} pattern{clusters.length === 1 ? "" : "s"} · {recurring.length} recurring · {totalOpenIncidents} open incidents{totalSev1 > 0 ? ` · ${totalSev1} SEV1` : ""}</>
              )}
            </div>
          </div>
        </div>
        <p className="problems__caption">
          Patterns are derived from the <strong>rootCause</strong> field of incidents. Investigate the recurring ones first — that&apos;s where the leverage is.
        </p>
      </header>

      {loadError ? (
        <div className="problems__error">Couldn&apos;t load: {loadError}</div>
      ) : incidents === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : clusters.length === 0 ? (
        <div className="problems__empty">
          <AlertOctagon />
          <div>
            <h3>No incidents to learn from yet</h3>
            <p>Once your team declares incidents and records a root cause, recurring patterns surface here automatically.</p>
          </div>
        </div>
      ) : (
        <>
          <section>
            <h2 className="problems__section-title">Recurring patterns <span>{recurring.length}</span></h2>
            {recurring.length === 0 ? (
              <div className="problems__section-empty">No pattern has happened twice yet — that&apos;s a good sign.</div>
            ) : (
              <div className="problems__grid">
                {recurring.map((c) => (
                  <ClusterCard key={c.key} cluster={c} isOpen={openCluster === c.key} onToggle={() => setOpenCluster(openCluster === c.key ? null : c.key)} />
                ))}
              </div>
            )}
          </section>

          {single.length > 0 && (
            <section style={{ marginTop: 28 }}>
              <h2 className="problems__section-title">One-off incidents <span>{single.length}</span></h2>
              <div className="problems__grid problems__grid--compact">
                {single.map((c) => (
                  <ClusterCard key={c.key} cluster={c} isOpen={openCluster === c.key} onToggle={() => setOpenCluster(openCluster === c.key ? null : c.key)} compact />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ClusterCard({ cluster, isOpen, onToggle, compact = false }: { cluster: Cluster; isOpen: boolean; onToggle: () => void; compact?: boolean }) {
  const dominantSev = cluster.incidents.reduce<Sev>((max, i) => (SEV_WEIGHT[i.severity] > SEV_WEIGHT[max] ? i.severity : max), "SEV5");
  return (
    <article className={`problem ${cluster.open > 0 ? "problem--active" : ""} ${compact ? "problem--compact" : ""}`}>
      <button type="button" className="problem__head" onClick={onToggle}>
        <span className="problem__sev" style={{ background: SEV_COLOR[dominantSev] }}>{dominantSev}</span>
        <span className="problem__main">
          <span className="problem__label">{cluster.label}</span>
          <span className="problem__stats">
            <span className="problem__stat"><Flame /> {cluster.incidents.length} incident{cluster.incidents.length === 1 ? "" : "s"}</span>
            <span className="problem__stat"><Clock /> {timeAgo(cluster.lastSeen)}</span>
            {cluster.open > 0 ? <span className="problem__stat problem__stat--danger">{cluster.open} open</span> : <span className="problem__stat problem__stat--good">all resolved</span>}
          </span>
        </span>
        <ChevronRight className={isOpen ? "problem__chev problem__chev--open" : "problem__chev"} />
      </button>
      {isOpen ? (
        <div className="problem__body">
          {cluster.incidents.slice(0, 12).map((inc) => (
            <div key={inc.id} className="problem__inc">
              <span className="problem__inc-sev" style={{ background: SEV_COLOR[inc.severity] }}>{inc.severity}</span>
              <span className="problem__inc-title">{inc.title}</span>
              <span className="problem__inc-meta">
                {inc.status === "RESOLVED" ? "Resolved" : <span style={{ color: "var(--os-c-red)", fontWeight: 600 }}>{inc.status.replace("_", " ")}</span>}
                {" · "}{timeAgo(new Date(inc.startedAt).getTime())}
              </span>
            </div>
          ))}
          {cluster.incidents.length > 12 ? <div className="problem__inc-more">+ {cluster.incidents.length - 12} more</div> : null}
        </div>
      ) : null}
    </article>
  );
}
