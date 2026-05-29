"use client";

/* OKRs — objectives + key results, organized by level.
 *
 *  GET   /api/okrs              list with keyResults
 *  POST  /api/okrs              { title, level }
 *  PATCH /api/okrs              { id, status, title, progress, ... }
 *
 * Layout
 *   - Stats hero (4 tiles: total, on-track %, at-risk count, this-quarter wins)
 *   - 3 level sections: Company → Team → Individual (cascade)
 *   - Each objective is a rich card showing health bar, owner, KRs
 *     (expandable inline)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Target, Plus, ChevronRight, ChevronDown, TrendingUp, AlertTriangle,
  CheckCircle2, Trophy, Loader2, Sparkles, Building2, Users, User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type OkrStatus = "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETED";
type OkrLevel = "COMPANY" | "TEAM" | "INDIVIDUAL";

type ApiOkr = {
  id: string;
  title: string;
  description?: string | null;
  level: OkrLevel;
  status: OkrStatus;
  progress: number;
  startDate?: string | null;
  endDate?: string | null;
  quarter?: string | null;
  ownerId?: string | null;
  owner?: { firstName?: string | null; lastName?: string | null } | null;
  keyResults?: { id: string; title: string; progress?: number; targetValue?: number; currentValue?: number }[];
};

const STATUS_LABELS: Record<OkrStatus, string> = {
  ON_TRACK: "On track", AT_RISK: "At risk", BEHIND: "Behind", COMPLETED: "Completed",
};
const STATUS_COLOR: Record<OkrStatus, string> = {
  ON_TRACK: C.green, AT_RISK: C.yellow, BEHIND: C.red, COMPLETED: C.teal,
};

const LEVEL_META: Record<OkrLevel, { label: string; sub: string; Icon: LucideIcon; color: string }> = {
  COMPANY:    { label: "Company OKRs",    sub: "What the whole company is pushing toward", Icon: Building2, color: C.purple },
  TEAM:       { label: "Team OKRs",       sub: "How each team supports the company goals", Icon: Users,     color: C.blue },
  INDIVIDUAL: { label: "Individual OKRs", sub: "What each person commits to this cycle",   Icon: UserIcon,  color: C.teal },
};

const LEVEL_ORDER: OkrLevel[] = ["COMPANY", "TEAM", "INDIVIDUAL"];

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initialsFor(f?: string | null, l?: string | null) {
  return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OkrsPage() {
  const [okrs, setOkrs] = useState<ApiOkr[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState<OkrLevel | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/okrs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOkrs(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("okrs");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function newObjective(level: OkrLevel) {
    setCreating(level);
    try {
      const res = await fetch("/api/okrs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled objective", level }),
      });
      if (!res.ok) throw new Error();
      void load();
      toast(`New ${LEVEL_META[level].label.replace(" OKRs", "")} objective added`);
    } catch { toast("Couldn't create objective"); }
    finally { setCreating(null); }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = okrs ?? [];
    const active = all.filter((o) => o.status !== "COMPLETED");
    const onTrack = active.filter((o) => o.status === "ON_TRACK").length;
    const atRisk = active.filter((o) => o.status === "AT_RISK" || o.status === "BEHIND").length;
    const completed = all.filter((o) => o.status === "COMPLETED").length;
    const avgProgress = active.length > 0
      ? Math.round(active.reduce((acc, o) => acc + Math.max(0, Math.min(100, o.progress)), 0) / active.length)
      : 0;
    return { total: all.length, active: active.length, onTrack, atRisk, completed, avgProgress };
  }, [okrs]);

  // ── Group by level ──────────────────────────────────────
  const grouped = useMemo(() => {
    const m = new Map<OkrLevel, ApiOkr[]>();
    for (const l of LEVEL_ORDER) m.set(l, []);
    for (const o of okrs ?? []) m.get(o.level)?.push(o);
    return m;
  }, [okrs]);

  return (
    <>
      <OsTitleBar
        title="OKRs"
        Icon={Target}
        iconGradient={GRAD.indigoBlue}
        description={okrs === null ? "Loading…" : `${stats.total} objective${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.completed} completed`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={5}
        actions={
          <button type="button" className="okrs__new" onClick={() => newObjective("INDIVIDUAL")} disabled={creating !== null}>
            {creating === "INDIVIDUAL" ? <><Loader2 className="okrs__spin" /> Creating…</> : <><Plus /> New objective</>}
          </button>
        }
      />

      {loadError ? (
        <OsEmptyView Icon={Target} iconGradient={GRAD.redPink} title="Couldn't load OKRs" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : okrs === null ? (
        <div className="okrs__loading">Loading objectives…</div>
      ) : stats.total === 0 ? (
        <OsEmptyView Icon={Target} iconGradient={GRAD.indigoBlue} title="No OKRs yet" subtitle="Set your first objective. Pick Company / Team / Individual to anchor it on the cascade." chips={["Company", "Team", "Individual"]} cta="New objective" />
      ) : (
        <div className="okrs">
          {/* Stats hero */}
          <section className="okrs__stats">
            <StatTile
              label="Average progress"
              value={`${stats.avgProgress}%`}
              accent={C.indigo}
              Icon={TrendingUp}
              hint={`across ${stats.active} active`}
              bar={stats.avgProgress}
            />
            <StatTile
              label="On track"
              value={`${stats.onTrack}`}
              accent={C.green}
              Icon={CheckCircle2}
              hint={stats.active > 0 ? `${Math.round((stats.onTrack / stats.active) * 100)}% of active` : "no active"}
            />
            <StatTile
              label="Need attention"
              value={`${stats.atRisk}`}
              accent={C.orange}
              Icon={AlertTriangle}
              hint={stats.atRisk > 0 ? "at risk or behind" : "all clear"}
            />
            <StatTile
              label="Completed"
              value={`${stats.completed}`}
              accent={C.teal}
              Icon={Trophy}
              hint="wins this cycle"
            />
          </section>

          {/* Cascade */}
          {LEVEL_ORDER.map((level) => {
            const meta = LEVEL_META[level];
            const items = grouped.get(level) ?? [];
            return (
              <section key={level} className="okrs__level" style={{ ["--lvl-color" as string]: meta.color }}>
                <header className="okrs__level-head">
                  <div className="okrs__level-icon"><meta.Icon /></div>
                  <div className="okrs__level-text">
                    <h2>{meta.label}</h2>
                    <p>{meta.sub}</p>
                  </div>
                  <span className="okrs__level-count">{items.length}</span>
                  <button type="button" className="okrs__level-add" onClick={() => newObjective(level)} disabled={creating !== null}>
                    {creating === level ? <Loader2 className="okrs__spin" /> : <Plus />}
                    Add
                  </button>
                </header>

                {items.length === 0 ? (
                  <div className="okrs__level-empty">
                    No {meta.label.replace(" OKRs", "").toLowerCase()} objectives yet. <button type="button" onClick={() => newObjective(level)}>Add one →</button>
                  </div>
                ) : (
                  <div className="okrs__cards">
                    {items.map((o) => (
                      <ObjectiveCard
                        key={o.id}
                        okr={o}
                        expanded={expanded.has(o.id)}
                        onToggle={() => toggleExpand(o.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function StatTile({ label, value, accent, Icon, hint, bar }: { label: string; value: string; accent: string; Icon: LucideIcon; hint: string; bar?: number }) {
  return (
    <div className="okrs-stat" style={{ ["--stat-color" as string]: accent }}>
      <div className="okrs-stat__head">
        <span className="okrs-stat__label">{label}</span>
        <Icon />
      </div>
      <div className="okrs-stat__value">{value}</div>
      <div className="okrs-stat__hint">{hint}</div>
      {bar !== undefined && (
        <div className="okrs-stat__bar">
          <span style={{ width: `${Math.max(2, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

function ObjectiveCard({ okr, expanded, onToggle }: { okr: ApiOkr; expanded: boolean; onToggle: () => void }) {
  const color = STATUS_COLOR[okr.status];
  const pct = Math.max(0, Math.min(100, okr.progress));
  const krs = okr.keyResults ?? [];
  const ownerInitials = okr.owner ? initialsFor(okr.owner.firstName, okr.owner.lastName) : okr.ownerId?.slice(0, 2).toUpperCase() ?? "?";
  const ownerColor = okr.ownerId ? avColor(okr.ownerId) : C.gray;

  return (
    <article className={`okr-card ${expanded ? "is-open" : ""}`} style={{ ["--okr-color" as string]: color }}>
      <button type="button" className="okr-card__main" onClick={onToggle} aria-expanded={expanded}>
        <span className="okr-card__expand">{expanded ? <ChevronDown /> : <ChevronRight />}</span>

        <div className="okr-card__body">
          <header className="okr-card__head">
            <h3>{okr.title}</h3>
            <span className="okr-card__status">{STATUS_LABELS[okr.status]}</span>
          </header>

          {okr.description && !expanded && <p className="okr-card__desc">{okr.description}</p>}

          <div className="okr-card__bar">
            <div className="okr-card__bar-track">
              <div className="okr-card__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="okr-card__bar-pct">{pct}%</span>
          </div>

          <div className="okr-card__meta">
            <span className="okr-card__owner">
              <span className="okr-card__avatar" style={{ background: ownerColor }}>{ownerInitials}</span>
              {okr.owner ? `${okr.owner.firstName ?? ""} ${okr.owner.lastName ?? ""}`.trim() || "Owner" : "Unassigned"}
            </span>
            {okr.quarter && <span className="okr-card__chip">{okr.quarter}</span>}
            {okr.endDate && <span className="okr-card__chip">Ends {fmtDate(okr.endDate)}</span>}
            <span className="okr-card__chip okr-card__chip--krs"><Sparkles /> {krs.length} key result{krs.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="okr-card__details">
          {okr.description && <p className="okr-card__details-desc">{okr.description}</p>}
          {krs.length === 0 ? (
            <div className="okr-card__details-empty">No key results yet. Add KRs to track progress against this objective.</div>
          ) : (
            <ol className="okr-card__krs">
              {krs.map((kr) => {
                const krPct = kr.progress != null ? Math.max(0, Math.min(100, kr.progress))
                  : (kr.targetValue && kr.currentValue != null
                      ? Math.round(Math.min(100, (kr.currentValue / Math.max(1, kr.targetValue)) * 100))
                      : 0);
                return (
                  <li key={kr.id} className="okr-kr">
                    <div className="okr-kr__title">{kr.title}</div>
                    <div className="okr-kr__bar">
                      <div className="okr-kr__bar-track">
                        <div className="okr-kr__bar-fill" style={{ width: `${krPct}%` }} />
                      </div>
                      <span>{krPct}%</span>
                    </div>
                    {kr.targetValue != null && (
                      <div className="okr-kr__values">
                        {kr.currentValue ?? 0} / {kr.targetValue}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}
