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
 * Period toggle (top): week / month / quarter — the review CADENCE. The
 * KPIRecord.period storage key is always the canonical "YYYY-MM" month key
 * (see periodKey below): goals/KR derivation reads only canonical keys.
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
import { getScoringBands, bandFor, DEFAULT_SCORING_BANDS, type ScoringBand } from "@/lib/review-cadence";

/* localStorage-backed drafts so unsaved manager edits survive a refresh.
 * Keyed per subject+period. Cleared once the draft is saved server-side. */
const DRAFT_NS = "workwrk:kpi-review-draft";
type DraftPatch = { actual?: string; notes?: string };
function draftKey(userId: string, period: string) { return `${DRAFT_NS}:${userId}:${period}`; }
function loadDraft(userId: string, period: string): Map<string, DraftPatch> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(draftKey(userId, period));
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, DraftPatch>));
  } catch { return new Map(); }
}
function persistDraft(userId: string, period: string, draft: Map<string, DraftPatch>) {
  if (typeof window === "undefined") return;
  try {
    if (draft.size === 0) localStorage.removeItem(draftKey(userId, period));
    else localStorage.setItem(draftKey(userId, period), JSON.stringify(Object.fromEntries(draft)));
  } catch { /* quota / private mode — non-fatal */ }
}

type KpiDir = "HIGHER" | "LOWER" | "MAINTAIN";

type ApiUser = { id: string; firstName?: string | null; lastName?: string | null; department?: { name?: string | null } | null; role?: { title?: string | null } | null };
type ApiKra = { id: string; name: string; category?: string | null; kpis?: { id: string; name: string; unit?: string | null; type?: string | null; targetValue?: number | null; lowerIsBetter?: boolean; direction?: KpiDir | null }[] };
type ApiKraAssignment = { id: string; kraId: string; weightage: number; kra?: ApiKra };
type ApiRecord = { id: string; kpiId: string; period: string; targetValue: number; actualValue?: number | null; score?: number | null; managerNotes?: string | null };

const AV_PALETTE = ["var(--os-c-blue)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-sage)", "var(--os-c-teal)", "var(--os-c-yellow)", "var(--os-c-brown)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

/**
 * KPIRecord.period storage key — ALWAYS the canonical "YYYY-MM" month key,
 * whatever the review cadence. lib/alignment.ts#latestKpiValues (which
 * drives goal key results and every "latest reading" surface) reads ONLY
 * canonical month keys, so the legacy "YYYY-Www"/"YYYY-Qn" keys this page
 * used to write were invisible to goals forever. Weekly/quarterly cadences
 * now land on the month they fall in — a weekly review simply updates the
 * current month's reading in place (POST /api/kpi-records upserts on
 * kpiId+userId+period). Historical W/Q rows are left untouched; derivation
 * already ignores them.
 */
function periodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Human label for the current review month, e.g. "September 2026". */
function monthLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// `score` here is already direction-adjusted (previewScore below), so a
// high value is always good — no per-direction inversion.
function scoreColor(score: number): string {
  if (score >= 95) return "var(--os-c-green)";
  if (score >= 75) return "var(--os-c-teal)";
  if (score >= 50) return "var(--os-c-orange)";
  return "var(--os-c-red)";
}

// Client-side mirror of the server's scoring (src/lib/kpi-record.ts:
// resolveKpiLine + scoreKpiRecord) so the review chip previews EXACTLY the
// score the POST will store. Direction: the enum wins, else the legacy
// lowerIsBetter boolean. QUALITATIVE with no target scores against a rubric
// ceiling. Scores cap at 120; null = "no baseline yet".
const QUALITATIVE_SCALE_MAX = 5;
function resolveKpiLine(type: string | null | undefined, target: number): number {
  if (type === "QUALITATIVE" && target <= 0) return QUALITATIVE_SCALE_MAX;
  return target;
}
function resolveDir(direction: KpiDir | null | undefined, lowerIsBetter?: boolean): KpiDir {
  if (direction) return direction;
  return lowerIsBetter ? "LOWER" : "HIGHER";
}
function previewScore(
  kpi: { type?: string | null; target: number; direction?: KpiDir | null; lowerIsBetter?: boolean },
  actual: number | null,
): number | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const target = resolveKpiLine(kpi.type, kpi.target);
  if (!Number.isFinite(target) || target === 0) return null;
  const dir = resolveDir(kpi.direction, kpi.lowerIsBetter);
  if (dir === "MAINTAIN") {
    const deviation = Math.abs(actual - target) / Math.abs(target);
    return Math.max(0, Math.round((1 - deviation) * 100));
  }
  if (dir === "LOWER") {
    if (actual === 0) return 120;
    return Math.min(Math.round((target / actual) * 100), 120);
  }
  return Math.min(Math.round((actual / target) * 100), 120);
}

type SubjectState = {
  user: ApiUser;
  kpis: { kpiId: string; kraName: string; name: string; unit?: string | null; type?: string | null; target: number; lowerIsBetter?: boolean; direction?: KpiDir | null }[];
  records: Map<string, ApiRecord>;       // kpiId -> existing record
  draft: Map<string, { actual?: string; notes?: string }>; // pending edits
};

export default function ReviewPage() {
  const [reports, setReports] = useState<ApiUser[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subjectMap, setSubjectMap] = useState<Map<string, SubjectState>>(new Map());
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bands, setBands] = useState<ScoringBand[]>(DEFAULT_SCORING_BANDS);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const period$ = periodKey();
  const monthLbl = monthLabel();

  // Org scoring bands drive the score-chip color + legend (set in
  // Settings → Scoring & reviews).
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.settings) setBands(getScoringBands(d.settings)); })
      .catch(() => {});
  }, []);

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
            type: k.type,
            target: typeof k.targetValue === "number" ? k.targetValue : 0,
            lowerIsBetter: k.lowerIsBetter,
            direction: k.direction,
          });
        }
      }

      const records: ApiRecord[] = rJson?.data?.records ?? rJson?.data ?? [];
      const recordMap = new Map(records.filter((r) => r.period === period$).map((r) => [r.kpiId, r]));

      const user = (reports ?? []).find((u) => u.id === userId);
      if (!user) return;

      // Re-hydrate any unsaved draft from localStorage so a refresh
      // mid-review doesn't lose the manager's typing.
      const restoredDraft = loadDraft(userId, period$);
      setSubjectMap((prev) => {
        const n = new Map(prev);
        n.set(userId + ":" + period$, { user, kpis, records: recordMap, draft: restoredDraft });
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
      persistDraft(selectedId, period$, d);
      n.set(key, { ...cur, draft: d });
      return n;
    });
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
      toast(`Saved ${saved} update${saved === 1 ? "" : "s"} for ${monthLbl}`);
      // Saved server-side — drop the local draft so it isn't re-restored.
      persistDraft(selectedId, period$, new Map());
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
        description={reports === null ? "Loading…" : `${reports.length} direct report${reports.length === 1 ? "" : "s"} · ${monthLbl}`}
        actions={
          <div className="krar__head-actions">
            <Link href="/kra-kpi" className="krar__nav-link"><Target /> KRA library</Link>
            <div className="krar__period krar__period--static" title="Readings record against the current month; review as often as you like.">
              <Calendar />
              <span>{monthLbl}</span>
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
                    const score = previewScore(k, actualNum);
                    return (
                      <article key={k.kpiId} className="review-kpi">
                        <header className="review-kpi__head">
                          <div>
                            <div className="review-kpi__kra">{k.kraName}</div>
                            <h4>{k.name}</h4>
                          </div>
                          {score != null ? (
                            <span
                              className="review-kpi__score"
                              style={{ background: bandFor(score, bands)?.color ?? scoreColor(score) }}
                              title={bandFor(score, bands)?.label ?? undefined}
                            >
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
                            <small>{k.unit}{(() => {
                              const d = resolveDir(k.direction, k.lowerIsBetter);
                              return d === "LOWER" ? " · lower is better" : d === "MAINTAIN" ? " · hold at target" : "";
                            })()}</small>
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
                    {subject.kpis.filter((k) => subject.records.get(k.kpiId)?.actualValue != null).length} / {subject.kpis.length} KPIs scored for {monthLbl}
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
        <span aria-hidden style={{ width: 1, height: 12, background: "var(--os-line)", margin: "0 2px" }} />
        {bands.map((b) => (
          <span key={b.label} title={`${b.min}–${b.max}%`}>
            <span
              className="review-person__dot"
              style={{ background: b.color?.startsWith("#") || /^[a-z]+$/i.test(b.color) ? b.color : "var(--os-ink-3)" }}
            />
            {b.label}
          </span>
        ))}
      </div>
      </div>
    </>
  );
}
