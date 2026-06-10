"use client";

/* Talent — 9-box assessment grid + segment lists.
 *
 *  GET  /api/talent-assessment
 *  POST /api/talent-assessment   { userId, period, performance, potential, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users2, Plus, Star, Award, AlertTriangle, Heart, Briefcase,
  TrendingUp, ChevronRight, Activity, Target, Calendar,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiAssessment = {
  id: string;
  userId: string;
  period: string;
  performance: 1 | 2 | 3;
  potential: 1 | 2 | 3;
  boxPosition: string;
  action?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null; department?: { name?: string | null } | null; role?: { title?: string | null } | null } | null;
};

const BOX_LABELS: Record<string, string> = {
  "3-3": "Stars", "3-2": "High perf", "3-1": "Workhorses",
  "2-3": "Future leaders", "2-2": "Core players", "2-1": "Steady",
  "1-3": "Diamonds", "1-2": "Inconsistent", "1-1": "At risk",
};
const BOX_LONG: Record<string, string> = {
  "3-3": "High performance · High potential",
  "3-2": "High performance · Medium potential",
  "3-1": "High performance · Low potential",
  "2-3": "Medium performance · High potential",
  "2-2": "Medium performance · Medium potential",
  "2-1": "Medium performance · Low potential",
  "1-3": "Low performance · High potential",
  "1-2": "Low performance · Medium potential",
  "1-1": "Low performance · Low potential",
};
const BOX_COLORS: Record<string, string> = {
  "3-3": C.green, "3-2": C.teal,  "3-1": C.blue,
  "2-3": C.indigo, "2-2": C.purple, "2-1": C.pink,
  "1-3": C.orange, "1-2": C.brown, "1-1": C.red,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

// Grid is laid out with potential decreasing top-to-bottom (3 high at top) and performance increasing left-to-right
// Cell order in CSS grid (row-major): (potential 3, perf 1), (potential 3, perf 2), (potential 3, perf 3), then potential 2 row, then potential 1 row
const GRID_ORDER: { pot: 1 | 2 | 3; perf: 1 | 2 | 3; key: string }[] = [
  { pot: 3, perf: 1, key: "1-3" }, { pot: 3, perf: 2, key: "2-3" }, { pot: 3, perf: 3, key: "3-3" },
  { pot: 2, perf: 1, key: "1-2" }, { pot: 2, perf: 2, key: "2-2" }, { pot: 2, perf: 3, key: "3-2" },
  { pot: 1, perf: 1, key: "1-1" }, { pot: 1, perf: 2, key: "2-1" }, { pot: 1, perf: 3, key: "3-1" },
];

export default function TalentPage() {
  const router = useRouter();
  const [assessments, setAssessments] = useState<ApiAssessment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBox, setSelectedBox] = useState<string | null>(null);
  // null = "All periods". Defaults to the latest period once data loads so
  // the box shows one coherent snapshot instead of stacking every cycle.
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [periodTouched, setPeriodTouched] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/talent-assessment");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiAssessment[] = data?.data ?? (Array.isArray(data) ? data : []);
      setAssessments(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("talent");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Distinct periods, newest first (works for "YYYY-Qn" and "YYYY-MM").
  const periods = useMemo(
    () => Array.from(new Set((assessments ?? []).map((a) => a.period))).sort((a, b) => b.localeCompare(a)),
    [assessments],
  );

  // Default to the latest period the first time data arrives.
  useEffect(() => {
    if (!periodTouched && selectedPeriod === null && periods.length > 0) {
      setSelectedPeriod(periods[0]);
    }
  }, [periods, periodTouched, selectedPeriod]);

  const visible = useMemo(
    () => (selectedPeriod ? (assessments ?? []).filter((a) => a.period === selectedPeriod) : (assessments ?? [])),
    [assessments, selectedPeriod],
  );

  const byBox = useMemo(() => {
    const m = new Map<string, ApiAssessment[]>();
    for (const k of Object.keys(BOX_LABELS)) m.set(k, []);
    for (const a of visible) {
      if (!m.has(a.boxPosition)) m.set(a.boxPosition, []);
      m.get(a.boxPosition)!.push(a);
    }
    return m;
  }, [visible]);

  const stats = useMemo(() => {
    const stars = (byBox.get("3-3") ?? []).length;
    const futureLeaders = (byBox.get("2-3") ?? []).length + (byBox.get("1-3") ?? []).length;
    const atRisk = (byBox.get("1-1") ?? []).length + (byBox.get("1-2") ?? []).length;
    const core = (byBox.get("2-2") ?? []).length + (byBox.get("3-2") ?? []).length + (byBox.get("2-1") ?? []).length;
    return { total: visible.length, stars, futureLeaders, atRisk, core };
  }, [visible, byBox]);

  const selectedAssessments = selectedBox ? (byBox.get(selectedBox) ?? []) : [];

  return (
    <>
      <OsTitleBar
        title="Talent"
        Icon={Users2}
        iconGradient={GRAD.greenTeal}
        description={assessments === null ? "Loading…" : `${stats.total} assessment${stats.total === 1 ? "" : "s"} · ${stats.stars} stars · ${stats.atRisk} at risk`}
        actions={
          <div className="tal__head-actions">
            <Link href="/people" className="tal__nav-link"><Briefcase /> People</Link>
            <Link href="/reviews" className="tal__nav-link"><Award /> Reviews</Link>
            <button type="button" className="tal__btn-primary" onClick={() => toast("Use the review cycle to add assessments — opens the 9-box during calibration")}>
              <Plus /> New assessment
            </button>
          </div>
        }
      />

      <div className="tal">
        <div className="tal__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={Star}          label="Stars"          value={`${stats.stars}`}         sub="3·3 perf × potential" />
          <KpiTile accent="var(--os-c-indigo)" Icon={TrendingUp}    label="Future leaders" value={`${stats.futureLeaders}`} sub="high potential" />
          <KpiTile accent="var(--os-c-purple)" Icon={Heart}         label="Core players"   value={`${stats.core}`}          sub="solid middle" />
          <KpiTile accent="var(--os-c-red)"    Icon={AlertTriangle} label="At risk"        value={`${stats.atRisk}`}        sub="needs attention" />
        </div>

        {loadError ? (
          <OsEmptyView Icon={Users2} iconGradient={GRAD.redPink} title="Couldn't load assessments" subtitle={loadError} cta="Retry" onCta={() => void load()} />
        ) : assessments === null ? (
          <div className="tal__loading">Loading…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Users2}
            iconGradient={GRAD.greenTeal}
            title="No talent assessments yet"
            subtitle="Use the 9-box during calibration to map each person on performance × potential. Sets up succession planning and development conversations."
            chips={["Stars", "Future leaders", "Core players", "At risk"]}
            cta="Run calibration"
            onCta={() => router.push("/reviews")}
          />
        ) : (
          <div className="tal__grid-wrap">
            {periods.length > 0 && (
              <div className="tal__toolbar" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Calendar style={{ width: 14, height: 14, color: "var(--os-ink-3)" }} />
                <span style={{ fontSize: 12, color: "var(--os-ink-3)" }}>Period</span>
                <select
                  value={selectedPeriod ?? "__all__"}
                  onChange={(e) => { setPeriodTouched(true); setSelectedPeriod(e.target.value === "__all__" ? null : e.target.value); setSelectedBox(null); }}
                  style={{ height: 28, padding: "0 8px", borderRadius: 6, border: "1px solid var(--os-line)", fontSize: 12.5, background: "var(--os-surface, #fff)", color: "var(--os-ink)" }}
                >
                  <option value="__all__">All periods</option>
                  {periods.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span style={{ fontSize: 11.5, color: "var(--os-ink-3)" }}>{stats.total} assessed</span>
              </div>
            )}
            {/* 9-box grid */}
            <section className="tal__box">
              <header className="tal__box-head">
                <h2><Target /> 9-box matrix</h2>
                <span className="tal__box-sub">click a cell to see who's there</span>
              </header>
              <div className="tal__box-area">
                <div className="tal__axis-y">
                  <span>High</span>
                  <span className="tal__axis-y-label">POTENTIAL</span>
                  <span>Low</span>
                </div>
                <div className="tal__cells">
                  {GRID_ORDER.map(({ key }) => {
                    const items = byBox.get(key) ?? [];
                    const color = BOX_COLORS[key];
                    const isSelected = selectedBox === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`tal__cell${isSelected ? " is-selected" : ""}${items.length === 0 ? " is-empty" : ""}`}
                        style={{ ["--cell-c" as unknown as string]: color }}
                        onClick={() => setSelectedBox(isSelected ? null : key)}
                      >
                        <span className="tal__cell-label">{BOX_LABELS[key]}</span>
                        <span className="tal__cell-count">{items.length}</span>
                        <div className="tal__cell-avs">
                          {items.slice(0, 5).map((a) => (
                            <span key={a.id} className="tal__cell-av" style={{ background: avColor(a.userId) }} title={a.user ? `${a.user.firstName} ${a.user.lastName}` : ""}>
                              {initials(a.user?.firstName, a.user?.lastName)}
                            </span>
                          ))}
                          {items.length > 5 && <span className="tal__cell-more">+{items.length - 5}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="tal__axis-x">
                <span>Low</span>
                <span className="tal__axis-x-label">PERFORMANCE</span>
                <span>High</span>
              </div>
            </section>

            {/* Selected cell detail */}
            {selectedBox && (
              <section className="tal__detail" style={{ ["--detail-c" as unknown as string]: BOX_COLORS[selectedBox] }}>
                <header className="tal__detail-head">
                  <span className="tal__detail-tag">{BOX_LABELS[selectedBox]}</span>
                  <h2>{BOX_LONG[selectedBox]}</h2>
                  <span className="tal__detail-count">{selectedAssessments.length} {selectedAssessments.length === 1 ? "person" : "people"}</span>
                </header>
                {selectedAssessments.length === 0 ? (
                  <div className="tal__detail-empty">No one currently in this box.</div>
                ) : (
                  <div className="tal__people">
                    {selectedAssessments.map((a) => (
                      <Link key={a.id} href={`/people/${a.userId}`} className="tal__person">
                        <span className="tal__person-av" style={{ background: avColor(a.userId) }}>
                          {initials(a.user?.firstName, a.user?.lastName)}
                        </span>
                        <div className="tal__person-info">
                          <div className="tal__person-name">{a.user ? `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.trim() : "Unknown"}</div>
                          <div className="tal__person-role">{a.user?.role?.title ?? "—"}{a.user?.department?.name ? ` · ${a.user.department.name}` : ""}</div>
                          {a.action && <div className="tal__person-action"><Activity /> {a.action}</div>}
                        </div>
                        <span className="tal__person-period">{a.period}</span>
                        <ChevronRight className="tal__person-arrow" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Users2; label: string; value: string; sub: string }) {
  return (
    <div className="tal__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="tal__kpi-accent" aria-hidden="true" />
      <div className="tal__kpi-row">
        <div className="tal__kpi-icon"><Icon /></div>
        <div className="tal__kpi-label">{label}</div>
      </div>
      <div className="tal__kpi-value">{value}</div>
      <div className="tal__kpi-sub">{sub}</div>
    </div>
  );
}
