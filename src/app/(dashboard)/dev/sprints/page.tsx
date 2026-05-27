"use client";

/* Dev · Sprints — sprint history with velocity strip + per-sprint cards.
 *
 * Top: rolling velocity strip (last 6 sprints as bars). Below: 3 sections:
 * Active · Upcoming (planned) · Past (last 8 with completion%). Each
 * sprint card: name, goal, dates, committed/completed bar, retro link.
 *
 * GET /api/dev/sprints
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, Calendar, Target, FileText, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type Status = "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
type ApiSprint = {
  id: string; name: string; goal?: string | null;
  startDate: string; endDate: string;
  status: Status; teamId?: string | null;
  capacityPoints?: number | null; committedPoints?: number | null; completedPoints?: number | null;
  velocityRolling7?: number | string | null;
  retroNotes?: string | null;
};

const STATUS_HUE: Record<Status, string> = {
  PLANNED: "var(--os-c-indigo)", ACTIVE: "var(--os-c-orange)",
  COMPLETED: "var(--os-c-green)", CANCELLED: "var(--os-c-darkgray)",
};

function num(v?: number | string | null): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}
function fmtSpan(start: string, end: string) {
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default function DevSprintsPage() {
  const [sprints, setSprints] = useState<ApiSprint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/sprints");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSprints(data.data ?? data.sprints ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("dev");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const sorted = useMemo(() => [...(sprints ?? [])].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()), [sprints]);
  const active = sorted.filter((s) => s.status === "ACTIVE");
  const planned = sorted.filter((s) => s.status === "PLANNED");
  const completed = sorted.filter((s) => s.status === "COMPLETED");

  // Velocity strip from last 6 completed sprints, chronological order
  const velocity = useMemo(() => {
    const last6 = completed.slice(0, 6).reverse();
    const maxPts = Math.max(1, ...last6.map((s) => Math.max(s.committedPoints ?? 0, s.completedPoints ?? 0)));
    return { sprints: last6, max: maxPts };
  }, [completed]);

  const avgVelocity = velocity.sprints.length > 0
    ? velocity.sprints.reduce((a, s) => a + (s.completedPoints ?? 0), 0) / velocity.sprints.length
    : 0;

  return (
    <div className="devsp">
      <header className="devsp__head">
        <div className="devsp__head-l">
          <div className="devsp__icon"><Zap /></div>
          <div>
            <h1 className="devsp__title">Sprints</h1>
            <div className="devsp__sub">
              {sprints === null ? "Loading…" : `${active.length} active · ${planned.length} planned · avg velocity ${avgVelocity.toFixed(0)} pts`}
            </div>
          </div>
        </div>
      </header>

      {loadError ? (
        <div className="devsp__error">{loadError}</div>
      ) : sprints === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : sprints.length === 0 ? (
        <div className="devsp__empty">
          <Zap />
          <div>
            <h3>No sprints set up yet</h3>
            <p>Create sprints in your project tracker — the burndown + velocity history shows up here.</p>
          </div>
        </div>
      ) : (
        <>
          {velocity.sprints.length > 0 && (
            <section className="devsp__velocity">
              <header><h2>Rolling velocity · last {velocity.sprints.length}</h2><span>{avgVelocity.toFixed(0)} pts avg</span></header>
              <div className="devsp__velocity-bars">
                {velocity.sprints.map((s) => {
                  const c = s.committedPoints ?? 0;
                  const d = s.completedPoints ?? 0;
                  return (
                    <div key={s.id} className="devsp-vel">
                      <div className="devsp-vel__col">
                        <div className="devsp-vel__committed" style={{ height: `${(c / velocity.max) * 100}%` }} />
                        <div className="devsp-vel__completed" style={{ height: `${(d / velocity.max) * 100}%` }} />
                      </div>
                      <div className="devsp-vel__label">{s.name}</div>
                      <div className="devsp-vel__nums">{d}<small>/{c}</small></div>
                    </div>
                  );
                })}
              </div>
              <div className="devsp__velocity-legend">
                <span><span className="devsp-vel__swatch devsp-vel__swatch--c" /> Committed</span>
                <span><span className="devsp-vel__swatch devsp-vel__swatch--d" /> Completed</span>
              </div>
            </section>
          )}

          {active.length > 0 && (
            <section className="devsp__section">
              <header><h2>Active</h2><span>{active.length}</span></header>
              <div className="devsp__grid">{active.map((s) => <SprintCard key={s.id} s={s} />)}</div>
            </section>
          )}

          {planned.length > 0 && (
            <section className="devsp__section">
              <header><h2>Upcoming</h2><span>{planned.length}</span></header>
              <div className="devsp__grid">{planned.slice(0, 6).map((s) => <SprintCard key={s.id} s={s} />)}</div>
            </section>
          )}

          {completed.length > 0 && (
            <section className="devsp__section">
              <header><h2>Past</h2><span>last {Math.min(completed.length, 8)}</span></header>
              <div className="devsp__grid">{completed.slice(0, 8).map((s) => <SprintCard key={s.id} s={s} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SprintCard({ s }: { s: ApiSprint }) {
  const c = s.committedPoints ?? 0;
  const d = s.completedPoints ?? 0;
  const pct = c > 0 ? Math.min(100, Math.round((d / c) * 100)) : 0;
  return (
    <article className="devsp-card" style={{ ["--card-hue" as string]: STATUS_HUE[s.status] }}>
      <header>
        <h3>{s.name}</h3>
        <span className="devsp-card__status" style={{ background: STATUS_HUE[s.status] }}>{s.status.toLowerCase()}</span>
      </header>
      {s.goal && <p className="devsp-card__goal"><Target /> {s.goal}</p>}
      <div className="devsp-card__meta">
        <span><Calendar /> {fmtSpan(s.startDate, s.endDate)}</span>
        {s.capacityPoints != null && <span>Capacity: {s.capacityPoints}pts</span>}
      </div>
      {c > 0 && (
        <div className="devsp-card__bar-wrap">
          <div className="devsp-card__bar">
            <div className={`devsp-card__bar-fill ${pct >= 95 ? "is-strong" : pct >= 70 ? "is-ok" : "is-low"}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="devsp-card__pct">{pct}% <em>· {d}/{c}</em></span>
        </div>
      )}
      {s.retroNotes && (
        <footer className="devsp-card__retro">
          <FileText /> Retro notes recorded
        </footer>
      )}
    </article>
  );
}
