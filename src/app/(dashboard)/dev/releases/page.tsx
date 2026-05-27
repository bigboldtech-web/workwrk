"use client";

/* Dev · Releases — vertical changelog timeline.
 *
 * Each release as a horizontal entry on a vertical timeline: version
 * dot · release date · shipped/scheduled chip · name · description ·
 * changelog snippet. Filter chips by status. Public-changelog badge
 * on releases marked isPublic.
 *
 * GET /api/dev/releases
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Rocket, Plus, Globe, AlertTriangle, ExternalLink } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type Status = "PLANNED" | "BUILDING" | "STAGED" | "SHIPPED" | "ROLLED_BACK" | "CANCELLED";

type ApiRelease = {
  id: string; version: string; name?: string | null;
  description?: string | null; changelog?: string | null;
  status: Status; releaseType?: string | null;
  scheduledFor?: string | null; shippedAt?: string | null; rolledBackAt?: string | null;
  shipNotesUrl?: string | null; isPublic: boolean;
  createdAt: string;
};

const STATUS_LABEL: Record<Status, string> = {
  PLANNED: "Planned", BUILDING: "Building", STAGED: "Staged",
  SHIPPED: "Shipped", ROLLED_BACK: "Rolled back", CANCELLED: "Cancelled",
};
const STATUS_HUE: Record<Status, string> = {
  PLANNED: "var(--os-c-indigo)", BUILDING: "var(--os-c-orange)",
  STAGED: "var(--os-c-purple)", SHIPPED: "var(--os-c-green)",
  ROLLED_BACK: "var(--os-c-red)", CANCELLED: "var(--os-c-darkgray)",
};
const TYPE_HUE: Record<string, string> = {
  Major: "var(--os-c-red)", Minor: "var(--os-c-orange)",
  Patch: "var(--os-c-blue)", Hotfix: "var(--os-c-red)",
};

type FilterKey = "all" | Status;

export default function DevReleasesPage() {
  const [items, setItems] = useState<ApiRelease[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.data ?? data.releases ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("dev");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const sorted = useMemo(() => {
    return [...(items ?? [])].sort((a, b) => {
      const ad = new Date(a.shippedAt ?? a.scheduledFor ?? a.createdAt).getTime();
      const bd = new Date(b.shippedAt ?? b.scheduledFor ?? b.createdAt).getTime();
      return bd - ad;
    });
  }, [items]);

  const filtered = filter === "all" ? sorted : sorted.filter((r) => r.status === filter);

  const shippedCount = (items ?? []).filter((r) => r.status === "SHIPPED").length;
  const planned = (items ?? []).filter((r) => r.status === "PLANNED" || r.status === "BUILDING" || r.status === "STAGED").length;

  return (
    <div className="rels">
      <header className="rels__head">
        <div className="rels__head-l">
          <div className="rels__icon"><Rocket /></div>
          <div>
            <h1 className="rels__title">Releases</h1>
            <div className="rels__sub">
              {items === null ? "Loading…" : `${shippedCount} shipped · ${planned} in flight · changelog history`}
            </div>
          </div>
        </div>
        <button type="button" className="rels__new"><Plus /> New release</button>
      </header>

      <nav className="rels__filters">
        <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <em>{items?.length ?? 0}</em></button>
        {(["SHIPPED", "PLANNED", "BUILDING", "STAGED", "ROLLED_BACK"] as Status[]).map((s) => (
          <button key={s} type="button" className={filter === s ? "is-active" : ""} onClick={() => setFilter(s)}>
            <span className="rels__filter-dot" style={{ background: STATUS_HUE[s] }} />
            {STATUS_LABEL[s]} <em>{(items ?? []).filter((r) => r.status === s).length}</em>
          </button>
        ))}
      </nav>

      {loadError ? (
        <div className="rels__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rels__empty">
          <Rocket />
          <div>
            <h3>No releases here yet</h3>
            <p>Tag a release in your repo and the changelog lands here. Public releases also feed your public changelog page.</p>
          </div>
        </div>
      ) : (
        <div className="rels__timeline">
          {filtered.map((r) => {
            const d = r.shippedAt ?? r.scheduledFor ?? r.createdAt;
            return (
              <article key={r.id} className="rel" style={{ ["--rel-hue" as string]: STATUS_HUE[r.status] }}>
                <div className="rel__date">
                  <span className="rel__date-day">{new Date(d).toLocaleDateString("en-US", { day: "numeric" })}</span>
                  <span className="rel__date-mo">{new Date(d).toLocaleDateString("en-US", { month: "short" })}</span>
                  <span className="rel__date-yr">{new Date(d).getFullYear()}</span>
                </div>
                <span className="rel__dot" />
                <div className="rel__body">
                  <header>
                    <h3>
                      <span className="rel__ver">{r.version}</span>
                      {r.name && <span className="rel__name">· {r.name}</span>}
                    </h3>
                    <div className="rel__chips">
                      {r.releaseType && <span className="rel__type" style={{ background: TYPE_HUE[r.releaseType] ?? "var(--os-c-darkgray)" }}>{r.releaseType}</span>}
                      <span className="rel__status" style={{ background: STATUS_HUE[r.status] }}>{STATUS_LABEL[r.status]}</span>
                      {r.isPublic && <span className="rel__public"><Globe /> Public</span>}
                      {r.rolledBackAt && <span className="rel__rb"><AlertTriangle /> Rolled back {new Date(r.rolledBackAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                    </div>
                  </header>
                  {r.description && <p className="rel__desc">{r.description}</p>}
                  {r.changelog && (
                    <details className="rel__changelog">
                      <summary>Changelog</summary>
                      <pre>{r.changelog}</pre>
                    </details>
                  )}
                  {r.shipNotesUrl && (
                    <a href={r.shipNotesUrl} target="_blank" rel="noopener" className="rel__notes">
                      <ExternalLink /> Ship notes
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
