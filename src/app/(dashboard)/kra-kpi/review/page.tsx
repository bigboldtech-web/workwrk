"use client";

/* KRA/KPI · Review — manager weekly/monthly review cadence.
 *
 * Use case: as a manager, every week or month I sit down to rate my
 * direct reports against their KRAs/KPIs. This page makes that fast:
 *   - left rail: my direct reports as person cards with status dots
 *     (green = all KPIs scored, orange = some pending, red = nothing yet)
 *   - main: selected person with each KPI on its own row
 *     (target / actual input / manager note / score chip)
 *   - Save updates all KPIRecord rows for the period and triggers
 *     PerformanceScore recalculation server-side.
 *
 * Period toggle (top): week / month / quarter — used as the KPIRecord.period key.
 *
 * Reads:
 *   GET /api/users?managerId=me
 *   GET /api/kra-assignments?userId={subject}
 *   GET /api/kpi-records?userId={subject}&period={period}
 * Writes:
 *   POST /api/kpi-records      { kpiId, userId, period, actualValue, managerNotes }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChartLine, Save, AlertCircle, Calendar, ChevronRight, Target } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiUser = { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null; role?: { title?: string | null } | null };
type ApiKra = { id: string; name: string; category?: string | null; kpis?: { id: string; name: string; unit?: string | null; targetValue?: number | null; lowerIsBetter?: boolean }[] };
type ApiKraAssignment = { id: string; kraId: string; weightage: number; kra?: ApiKra };
type ApiRecord = { id: string; kpiId: string; period: string; targetValue: number; actualValue?: number | null; score?: number | null; managerNotes?: string | null };

type Period = "week" | "month" | "quarter";

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

function periodKey(p: Period): string {
  const d = new Date();
  if (p === "week") {
    // ISO-ish week key. Monday-based ISO weeks are robust across years.
    const onejan = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }
  if (p === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function scoreColor(score: number, lowerIsBetter = false): string {
  // score is a 0-100 attainment ratio computed below
  if (lowerIsBetter) score = 100 - score; // invert
  if (score >= 95) return "var(--os-c-green)";
  if (score >= 75) return "var(--os-c-teal)";
  if (score >= 50) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

type SubjectState = {
  user: ApiUser;
  kpis: { kpiId: string; kraName: string; name: string; unit?: string | null; target: number; lowerIsBetter?: boolean }[];
  records: Map<string, ApiRecord>;       // kpiId -> existing record
  draft: Map<string, { actual?: string; notes?: string }>; // pending edits
};

export default function ReviewPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [reports, setReports] = useState<ApiUser[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subjectMap, setSubjectMap] = useState<Map<string, SubjectState>>(new Map());
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const period$ = periodKey(period);

  // Load direct reports once
  const loadReports = useCallback(async () => {
    try {
      const meRes = await fetch("/api/me");
      if (!meRes.ok) throw new Error(`me ${meRes.status}`);
      const me = await meRes.json();
      const myId = me?.user?.id;
      if (!myId) throw new Error("Couldn't resolve current user");

      const res = await fetch(`/api/users?managerId=${encodeURIComponent(myId)}&limit=100`);
      if (!res.ok) throw new Error(`users ${res.status}`);
      const data = await res.json();
      const list: ApiUser[] = data?.data?.items ?? data?.data ?? [];
      setReports(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void loadReports(); }, [loadReports]);
  const v = rowVersion("kra-kpi");
  useEffect(() => { if (v > 0) void loadReports(); }, [v, loadReports]);

  // Load subject KPIs+records on demand
  const loadSubject = useCallback(async (userId: string) => {
    if (subjectMap.has(userId + ":" + period$)) return; // already loaded for this period
    try {
      const [assignRes, recordRes] = await Promise.all([
        fetch(`/api/kra-assignments?userId=${encodeURIComponent(userId)}`),
        fetch(`/api/kpi-records?userId=${encodeURIComponent(userId)}&limit=200`),
      ]);
      const aJson = assignRes.ok ? await assignRes.json() : { data: [] };
      const rJson = recordRes.ok ? await recordRes.json() : { data: { records: [] } };
      const assignments: ApiKraAssignment[] = aJson?.data ?? (Array.isArray(aJson) ? aJson : []);

      // Need KRA details (kpis) — fetch them in one go via /api/kras
      const kraIds = Array.from(new Set(assignments.map((a) => a.kraId)));
      let kraMap = new Map<string, ApiKra>();
      if (kraIds.length > 0) {
        const krasRes = await fetch("/api/kras?limit=200");
        if (krasRes.ok) {
          const k = await krasRes.json();
          const kraList: ApiKra[] = k?.data?.items ?? k?.data ?? [];
          kraMap = new Map(kraList.filter((kk) => kraIds.includes(kk.id)).map((kk) => [kk.id, kk]));
        }
      }

      const kpis: SubjectState["kpis"] = [];
      for (const a of assignments) {
        const kra = kraMap.get(a.kraId);
        for (const k of kra?.kpis ?? []) {
          kpis.push({
            kpiId: k.id,
            kraName: kra?.name ?? "—",
            name: k.name,
            unit: k.unit,
            target: typeof k.targetValue === "number" ? k.targetValue : 0,
            lowerIsBetter: k.lowerIsBetter,
          });
        }
      }

      const records: ApiRecord[] = rJson?.data?.records ?? rJson?.data ?? [];
      const recordMap = new Map(records.filter((r) => r.period === period$).map((r) => [r.kpiId, r]));

      const user = (reports ?? []).find((u) => u.id === userId);
      if (!user) return;

      setSubjectMap((prev) => {
        const n = new Map(prev);
        n.set(userId + ":" + period$, { user, kpis, records: recordMap, draft: new Map() });
        return n;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "subject load failed");
    }
  }, [period$, reports, subjectMap]);

  useEffect(() => {
    if (selectedId) void loadSubject(selectedId);
  }, [selectedId, period$, loadSubject]);

  const subject = selectedId ? subjectMap.get(selectedId + ":" + period$) : undefined;

  function setDraft(kpiId: string, patch: { actual?: string; notes?: string }) {
    if (!selectedId) return;
    setSubjectMap((prev) => {
      const n = new Map(prev);
      const key = selectedId + ":" + period$;
      const cur = n.get(key);
      if (!cur) return prev;
      const d = new Map(cur.draft);
      d.set(kpiId, { ...d.get(kpiId), ...patch });
      n.set(key, { ...cur, draft: d });
      return n;
    });
  }

  function attainment(target: number, actual: number, lowerIsBetter?: boolean): number {
    if (target === 0) return actual === 0 ? 100 : 0;
    if (lowerIsBetter) return Math.max(0, Math.min(100, (target / Math.max(actual, 0.001)) * 100));
    return Math.max(0, Math.min(100, (actual / target) * 100));
  }

  async function saveAll() {
    if (!subject || !selectedId) return;
    setBusy(true);
    let saved = 0;
    try {
      for (const [kpiId, patch] of subject.draft.entries()) {
        const existing = subject.records.get(kpiId);
        const target = subject.kpis.find((k) => k.kpiId === kpiId)?.target ?? 0;
        const actualValue = patch.actual === "" || patch.actual === undefined
          ? existing?.actualValue ?? null
          : parseFloat(patch.actual);
        const managerNotes = patch.notes ?? existing?.managerNotes ?? "";
        await fetch("/api/kpi-records", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kpiId, userId: selectedId, period: period$,
            targetValue: target, actualValue, managerNotes,
          }),
        });
        saved += 1;
      }
      toast(`Saved ${saved} update${saved === 1 ? "" : "s"} for ${period$}`);
      // Force reload of this subject for the period
      setSubjectMap((prev) => {
        const n = new Map(prev);
        n.delete(selectedId + ":" + period$);
        return n;
      });
      await loadSubject(selectedId);
    } catch {
      toast("Couldn't save some updates");
    }
    setBusy(false);
  }

  const reportStatus = useMemo(() => {
    const m = new Map<string, "done" | "partial" | "empty">();
    for (const r of reports ?? []) {
      const s = subjectMap.get(r.id + ":" + period$);
      if (!s) { m.set(r.id, "empty"); continue; }
      if (s.kpis.length === 0) { m.set(r.id, "empty"); continue; }
      const scoredCount = s.kpis.filter((k) => s.records.get(k.kpiId)?.actualValue != null).length;
      if (scoredCount === 0) m.set(r.id, "empty");
      else if (scoredCount === s.kpis.length) m.set(r.id, "done");
      else m.set(r.id, "partial");
    }
    return m;
  }, [reports, subjectMap, period$]);

  return (
    <>
      <OsTitleBar
        title="KPI review"
        Icon={ChartLine}
        iconGradient={GRAD.purpleIndigo}
        description={reports === null ? "Loading…" : `${reports.length} direct report${reports.length === 1 ? "" : "s"} · period ${period$}`}
        actions={
          <div className="krar__head-actions">
            <Link href="/kra-kpi" className="krar__nav-link"><Target /> KRA library</Link>
            <div className="krar__period">
              <Calendar />
              {(["week", "month", "quarter"] as Period[]).map((p) => (
                <button key={p} type="button" className={period === p ? "is-active" : ""} onClick={() => setPeriod(p)}>
                  {p === "week" ? "Weekly" : p === "month" ? "Monthly" : "Quarterly"}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="review">

      {loadError ? (
        <div className="review__error">{loadError}</div>
      ) : reports === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className="review__empty">
          <ChartLine />
          <div>
            <h3>You don&apos;t have any direct reports</h3>
            <p>Once you&apos;re assigned reports in HR, they show up here so you can run weekly or monthly KPI reviews.</p>
          </div>
        </div>
      ) : (
        <div className="review__grid">
          <aside className="review__people">
            {reports.map((u) => {
              const st = reportStatus.get(u.id) ?? "empty";
              const isSel = u.id === selectedId;
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`review-person ${isSel ? "is-selected" : ""}`}
                  onClick={() => setSelectedId(u.id)}
                >
                  <span className={`review-person__dot review-person__dot--${st}`}
                    title={st === "done" ? "All KPIs scored" : st === "partial" ? "Partial" : "Not started"} />
                  <span className="review-person__av" style={{ background: avColor(u.id) }}>
                    {initials(u.firstName, u.lastName)}
                  </span>
                  <span className="review-person__main">
                    <span className="review-person__name">{[u.firstName, u.lastName].filter(Boolean).join(" ")}</span>
                    <span className="review-person__role">{u.role?.title ?? "—"}</span>
                  </span>
                  {isSel ? <ChevronRight /> : null}
                </button>
              );
            })}
          </aside>

          <section className="review__pane">
            {!subject ? (
              <div className="review__pane-empty">
                {selectedId ? "Loading reportee…" : "Pick a teammate from the left."}
              </div>
            ) : subject.kpis.length === 0 ? (
              <div className="review__pane-empty">
                <AlertCircle />
                <p>{subject.user.firstName} doesn&apos;t have any KRAs/KPIs assigned. Set them up in KRA & KPI first.</p>
              </div>
            ) : (
              <>
                <header className="review-pane__head">
                  <h2>{[subject.user.firstName, subject.user.lastName].filter(Boolean).join(" ")}</h2>
                  <div className="review-pane__sub">
                    {subject.user.role?.title ?? "—"}{subject.user.department?.name ? ` · ${subject.user.department.name}` : ""}
                  </div>
                </header>

                <div className="review__kpis">
                  {subject.kpis.map((k) => {
                    const rec = subject.records.get(k.kpiId);
                    const draft = subject.draft.get(k.kpiId) ?? {};
                    const rawActual = draft.actual ?? (rec?.actualValue != null ? String(rec.actualValue) : "");
                    const actualNum = rawActual === "" ? null : parseFloat(rawActual);
                    const score = actualNum != null ? attainment(k.target, actualNum, k.lowerIsBetter) : null;
                    return (
                      <article key={k.kpiId} className="review-kpi">
                        <header className="review-kpi__head">
                          <div>
                            <div className="review-kpi__kra">{k.kraName}</div>
                            <h4>{k.name}</h4>
                          </div>
                          {score != null ? (
                            <span className="review-kpi__score" style={{ background: scoreColor(score, k.lowerIsBetter) }}>
                              {score.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="review-kpi__score review-kpi__score--empty">—</span>
                          )}
                        </header>
                        <div className="review-kpi__inputs">
                          <label>
                            <span>Target</span>
                            <input type="number" value={k.target} disabled />
                            <small>{k.unit}{k.lowerIsBetter ? " · lower is better" : ""}</small>
                          </label>
                          <label>
                            <span>Actual</span>
                            <input
                              type="number"
                              value={rawActual}
                              onChange={(e) => setDraft(k.kpiId, { actual: e.target.value })}
                              placeholder="—"
                              step="any"
                            />
                            <small>{k.unit}</small>
                          </label>
                          <label className="review-kpi__notes">
                            <span>Manager notes</span>
                            <textarea
                              rows={2}
                              value={draft.notes ?? rec?.managerNotes ?? ""}
                              onChange={(e) => setDraft(k.kpiId, { notes: e.target.value })}
                              placeholder="Coaching, context, what changed this period…"
                            />
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <footer className="review-pane__foot">
                  <div className="review-pane__progress">
                    {subject.kpis.filter((k) => subject.records.get(k.kpiId)?.actualValue != null).length} / {subject.kpis.length} KPIs scored for {period$}
                  </div>
                  <button type="button" className="review-pane__save" onClick={saveAll} disabled={busy || subject.draft.size === 0}>
                    {busy ? "Saving…" : <><Save /> Save {subject.draft.size > 0 ? `(${subject.draft.size})` : ""}</>}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}

      <div className="review__legend">
        <span><span className="review-person__dot review-person__dot--done" /> All scored</span>
        <span><span className="review-person__dot review-person__dot--partial" /> Some scored</span>
        <span><span className="review-person__dot review-person__dot--empty" /> Not started</span>
      </div>
      </div>
    </>
  );
}
