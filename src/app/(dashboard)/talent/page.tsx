"use client";

/* Talent — 9-box assessment grid + segment lists.
 *
 *  GET  /api/talent-assessment
 *  POST /api/talent-assessment   { userId, period, performance, potential, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users2, Plus, Star, Award, AlertTriangle, Heart, Briefcase,
  TrendingUp, ChevronRight, Activity, Target, Calendar,
  X, Wand2, Loader2, Search,
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

type UserOpt = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: { title?: string | null } | null;
  department?: { name?: string | null } | null;
};

// Talent + performance scores use a "YYYY-MM" period key (the perf engine
// writes that shape), so a new manual placement lands in the same snapshot.
function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

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
  const [assessments, setAssessments] = useState<ApiAssessment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBox, setSelectedBox] = useState<string | null>(null);
  // null = "All periods". Defaults to the latest period once data loads so
  // the box shows one coherent snapshot instead of stacking every cycle.
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [periodTouched, setPeriodTouched] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  // Placement modal — closes the circular gap: manual 9-box placement that
  // POSTs /api/talent-assessment, plus an auto-place-from-scores path.
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeSeed, setPlaceSeed] = useState<{ userId?: string; performance?: 1 | 2 | 3; potential?: 1 | 2 | 3; action?: string; notes?: string } | null>(null);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [autoBusy, setAutoBusy] = useState(false);

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

  // Assessable people for the placement picker. /api/users self-scopes
  // (org-wide levels see everyone, line managers see their team), which
  // matches the talent-assessment POST authority.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users?limit=500");
        if (!res.ok) return;
        const data = await res.json();
        const list: UserOpt[] = Array.isArray(data) ? data : data.data ?? data.users ?? [];
        if (!cancelled) setUsers(list);
      } catch { /* picker just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const openPlace = useCallback((seed?: typeof placeSeed) => { setPlaceSeed(seed ?? null); setPlaceOpen(true); }, []);

  // After a successful placement, jump the grid to that period so the new
  // row is visible in one coherent snapshot, then refetch.
  const handlePlaced = useCallback((period: string) => {
    setPeriodTouched(true);
    setSelectedPeriod(period);
    void load();
  }, [load]);

  // Auto-place (?auto=true): the route seeds a placement for every unassessed
  // person who has a performance score, mapping score → box. Cheap bulk seed.
  const handleAutoPlace = useCallback(async (period: string) => {
    setAutoBusy(true);
    try {
      const res = await fetch(`/api/talent-assessment?auto=true&period=${encodeURIComponent(period)}`);
      if (!res.ok) { toast("Couldn't auto-place from scores"); return; }
      const data = await res.json();
      const list: ApiAssessment[] = data?.data ?? (Array.isArray(data) ? data : []);
      setAssessments(list);
      setPeriodTouched(true);
      setSelectedPeriod(period);
      toast(`Auto-placed from performance scores · ${period}`);
    } catch {
      toast("Couldn't auto-place from scores");
    } finally { setAutoBusy(false); }
  }, [toast]);

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
            <button type="button" className="tal__btn-primary" onClick={() => openPlace()}>
              <Plus /> New assessment
            </button>
          </div>
        }
      />

      <div className="tal">
        <div className="tal__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={Star}          label="Stars"          value={`${stats.stars}`}         sub="3·3 perf × potential" />
          <KpiTile accent="var(--os-c-blue)" Icon={TrendingUp}    label="Future leaders" value={`${stats.futureLeaders}`} sub="high potential" />
          <KpiTile accent="var(--os-brand)" Icon={Heart}         label="Core players"   value={`${stats.core}`}          sub="solid middle" />
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
            subtitle="Place each person on the 9-box by performance × potential. Sets up succession planning and development conversations. Or auto-place everyone from their latest performance scores."
            chips={["Stars", "Future leaders", "Core players", "At risk"]}
            cta="Place first person"
            onCta={() => openPlace()}
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
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => void handleAutoPlace(selectedPeriod ?? currentPeriod())}
                    disabled={autoBusy}
                    title="Seed placements for anyone with a performance score but no assessment yet"
                    style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid var(--os-line)", background: "var(--os-surface, #fff)", color: "var(--os-ink)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, cursor: autoBusy ? "default" : "pointer" }}
                  >
                    {autoBusy ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Wand2 style={{ width: 13, height: 13 }} />}
                    Auto-place from scores
                  </button>
                  <button
                    type="button"
                    onClick={() => openPlace()}
                    style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "none", background: "#0073EA", color: "#fff", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <Plus style={{ width: 13, height: 13 }} /> New
                  </button>
                </div>
              </div>
            )}
            {/* 9-box grid */}
            <section className="tal__box">
              <header className="tal__box-head">
                <h2><Target /> 9-box matrix</h2>
                <span className="tal__box-sub">click a cell to see who&apos;s there</span>
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
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPlace({ userId: a.userId, performance: a.performance, potential: a.potential, action: a.action ?? undefined, notes: a.notes ?? undefined }); }}
                          title="Re-place this person"
                          style={{ marginRight: 6, height: 24, padding: "0 8px", borderRadius: 5, border: "1px solid var(--os-line)", background: "var(--os-surface, #fff)", color: "var(--os-ink-2, var(--os-ink))", fontSize: 11.5, cursor: "pointer" }}
                        >
                          Reassess
                        </button>
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

      {placeOpen && (
        <PlaceModal
          users={users}
          seed={placeSeed}
          defaultPeriod={selectedPeriod ?? currentPeriod()}
          onClose={() => { setPlaceOpen(false); setPlaceSeed(null); }}
          onPlaced={(period) => { setPlaceOpen(false); setPlaceSeed(null); handlePlaced(period); }}
        />
      )}
    </>
  );
}

/* ── Placement modal — writes a TalentAssessment via POST /api/talent-assessment.
 *  Click a cell in the mini 9-box to set performance × potential, pick the
 *  person, add an action + notes. Upsert-backed, so re-placing overwrites. */
function PlaceModal({
  users, seed, defaultPeriod, onClose, onPlaced,
}: {
  users: UserOpt[];
  seed: { userId?: string; performance?: 1 | 2 | 3; potential?: 1 | 2 | 3; action?: string; notes?: string } | null;
  defaultPeriod: string;
  onClose: () => void;
  onPlaced: (period: string) => void;
}) {
  const [userId, setUserId] = useState(seed?.userId ?? "");
  const [period, setPeriod] = useState(defaultPeriod);
  const [performance, setPerformance] = useState<1 | 2 | 3 | null>(seed?.performance ?? null);
  const [potential, setPotential] = useState<1 | 2 | 3 | null>(seed?.potential ?? null);
  const [action, setAction] = useState(seed?.action ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const boxKey = performance && potential ? `${performance}-${potential}` : null;
  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q));
  }, [users, query]);
  const canSave = !!userId && !!period.trim() && !!performance && !!potential && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/talent-assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, period: period.trim(), performance, potential, action: action.trim() || null, notes: notes.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(res.status === 403 ? "Only managers can place people on the 9-box." : data?.error || "Couldn't save the placement.");
        return;
      }
      onPlaced(period.trim());
    } catch {
      setError("Couldn't save the placement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 pt-[10vh] px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Place person on 9-box"
        className="w-full max-w-[560px] bg-white dark:bg-[#14171D] rounded-xl shadow-2xl border border-zinc-200 dark:border-[#2A2F38] overflow-hidden max-h-[86vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-[#2A2F38]">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--os-ink)" }}>Place on 9-box</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-[#20242C]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Person */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-zinc-400">Person</label>
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 dark:border-[#2A2F38] px-2.5 h-8">
              <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter people…"
                className="flex-1 bg-transparent text-[13px] focus:outline-none"
                style={{ color: "var(--os-ink)" }}
              />
            </div>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              size={4}
              className="w-full rounded-md border border-zinc-200 dark:border-[#2A2F38] text-[13px] p-1 bg-white dark:bg-[#14171D]"
              style={{ color: "var(--os-ink)" }}
            >
              {filteredUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()}{u.role?.title ? ` · ${u.role.title}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Mini 9-box placement */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-zinc-400">Placement · click a box</label>
            <div className="flex gap-2">
              <div className="flex flex-col items-center justify-between py-1 text-[9px] font-semibold text-zinc-400" style={{ writingMode: "vertical-rl" as const }}>
                <span>HIGH</span><span>POTENTIAL</span><span>LOW</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {GRID_ORDER.map(({ key, perf, pot }) => {
                  const selected = boxKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setPerformance(perf); setPotential(pot); }}
                      className="rounded-md border text-left px-2 py-2 transition-colors"
                      style={{
                        borderColor: selected ? BOX_COLORS[key] : "var(--os-line, #e4e4e7)",
                        background: selected ? BOX_COLORS[key] : "transparent",
                        color: selected ? "#fff" : "var(--os-ink-2, #52525b)",
                        boxShadow: selected ? `0 0 0 1px ${BOX_COLORS[key]}` : "none",
                      }}
                    >
                      <div className="text-[11px] font-semibold leading-tight">{BOX_LABELS[key]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between text-[9px] font-semibold text-zinc-400 pl-6 pr-1">
              <span>LOW</span><span>PERFORMANCE</span><span>HIGH</span>
            </div>
            {boxKey && (
              <p className="text-[11.5px] text-zinc-500">Selected: <span style={{ color: BOX_COLORS[boxKey], fontWeight: 600 }}>{BOX_LABELS[boxKey]}</span> · {BOX_LONG[boxKey]}</p>
            )}
          </div>

          {/* Period */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wide text-zinc-400">Period</label>
              <input
                type="text"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-08"
                className="w-full rounded-md border border-zinc-200 dark:border-[#2A2F38] px-2.5 h-8 text-[13px] bg-white dark:bg-[#14171D] focus:outline-none focus:border-[#0073EA]"
                style={{ color: "var(--os-ink)" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wide text-zinc-400">Action (optional)</label>
              <input
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="e.g. Promote, Develop, Coach"
                className="w-full rounded-md border border-zinc-200 dark:border-[#2A2F38] px-2.5 h-8 text-[13px] bg-white dark:bg-[#14171D] focus:outline-none focus:border-[#0073EA]"
                style={{ color: "var(--os-ink)" }}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-zinc-400">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Calibration rationale, development focus…"
              rows={3}
              className="w-full rounded-md border border-zinc-200 dark:border-[#2A2F38] px-2.5 py-2 text-[13px] bg-white dark:bg-[#14171D] focus:outline-none focus:border-[#0073EA] resize-none"
              style={{ color: "var(--os-ink)" }}
            />
          </div>

          {error && <p className="text-[12px] text-[#E2445C]">{error}</p>}
        </div>

        <div className="border-t border-zinc-100 dark:border-[#2A2F38] px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 h-8 rounded-md border border-zinc-200 dark:border-[#2A2F38] text-[12.5px] font-medium" style={{ color: "var(--os-ink)" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-white text-[12.5px] font-medium"
            style={{ background: canSave ? "#0073EA" : "#9dbfe8", cursor: canSave ? "pointer" : "default" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? "Placing…" : "Place person"}
          </button>
        </div>
      </div>
    </div>
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
