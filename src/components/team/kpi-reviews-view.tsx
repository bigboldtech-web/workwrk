"use client";

// KPI reviews (spec-goals /team/kpi-reviews): the manager's ONE KPI page.
// For each person the viewer manages, this month's numbers: approve what they
// recorded, ask for a change, or record the number yourself when they have
// not. It merges the two pages that did this job (the old /kra-kpi/review
// typing page and the old approval queue), and keeps everything either did:
// the person rail, per-KPI target / actual / note, the band-coloured score,
// save, the approval cards' Approve and Request changes, and a view of
// numbers waiting from other months.
//
//   left 360    PersonStatusList: one line per person with their chip for
//               the month, computed server-side (GET /api/kpi-records/summary)
//               so it is right before anyone is opened; "Needs you" and
//               "Done" sections
//   right       the person: a TableCard grouped by KRA, one line per KPI:
//               KPI · Target · Actual (an input when nothing is recorded or
//               a change was requested, in a month that takes numbers) ·
//               Recorded · Score · Note · Status · Approve / Request changes
//   save bar    56px, sticky, "3 numbers to save" with the blue Save numbers
//               and Discard; Cmd+S saves while dirty (a page-scoped chord);
//               leaving with unsaved numbers asks first (useDirtyGuard)
//
// Save posts each number through POST /api/kpi-records (a number a manager
// records lands APPROVED with reviewedById; src/lib/kpi-record-status.ts).
// A failed row keeps its number, says "Not saved, retrying", retries once,
// then offers Retry; it is never dropped. Drafts also mirror to
// localStorage (workwrk:kpi-review-draft:{person}:{period}, the key the old
// page used), so an expired session or a closed tab does not lose typing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, MessageSquare, XCircle } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { TableCard, BulkAction, type TableColumn } from "@/components/ui/table-card";
import { Picker } from "@/components/ui/picker";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { Avatar } from "@/components/ui/avatar-stack";
import { Button } from "@/components/ui/button";
import { MonthControl } from "@/components/ui/month-control";
import { ToneChip } from "@/components/people/person-bits";
import { PersonStatusList, type PersonStatusItem } from "@/components/team/person-status-list";
import { RequestChangesPopover } from "@/components/team/request-changes-popover";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useShortcut } from "@/lib/shortcuts";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { isKpiPeriodWritable, kpiPeriodLabel } from "@/lib/kpi-period";
import { kpiStatusLabel, kpiStatusTone, personKpiChip } from "@/lib/kpi-record-status";
import { previewKpiScore, type KpiDirection } from "@/lib/kpi-preview-score";
import { scoreBand } from "@/lib/people/score-band";
import { DEFAULT_SCORING_BANDS, getScoringBands, type ScoringBand } from "@/lib/review-cadence";
import { kpiReviewsSurfacePrefs, type KpiReviewsSurfacePrefs } from "@/lib/people-prefs";
import { cn } from "@/lib/utils";

interface SummaryPerson {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  pending: number;
  submitted: number;
  approved: number;
  rejected: number;
  total: number;
}

interface KpiRecordRow {
  id: string;
  kpiId: string;
  period: string;
  actualValue: number | null;
  targetValue: number;
  score: number | null;
  notes: string | null;
  managerNotes: string | null;
  evidence: string | null;
  status: "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";
  reviewedById: string | null;
  updatedAt: string;
}

interface KpiLine {
  kpiId: string;
  kraId: string;
  kraName: string;
  kraWeight: number;
  name: string;
  description: string | null;
  unit: string | null;
  type: string | null;
  target: number | null;
  direction: KpiDirection | null;
  lowerIsBetter: boolean;
}

type Draft = { actual?: string; notes?: string };
type RowState = { kind: "retrying" | "failed"; message: string };

const DRAFT_NS = "workwrk:kpi-review-draft";
const draftKey = (userId: string, period: string) => `${DRAFT_NS}:${userId}:${period}`;
function loadDraft(userId: string, period: string): Record<string, Draft> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(draftKey(userId, period)) : null;
    return raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
  } catch { return {}; }
}
function persistDraft(userId: string, period: string, d: Record<string, Draft>) {
  try {
    if (Object.keys(d).length === 0) window.localStorage.removeItem(draftKey(userId, period));
    else window.localStorage.setItem(draftKey(userId, period), JSON.stringify(d));
  } catch { /* private mode: the page still works, only the mirror is off */ }
}

const nameOf = (p: { firstName?: string | null; lastName?: string | null; email?: string | null }) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
const num = (n: number | null | undefined) => (n == null ? "" : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const parseActual = (s: string | undefined): number | null => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

type StatusFilter = "awaiting" | "notRecorded" | "approved" | "changes";

export function KpiReviewsView({ initialPeriod, currentPeriod, initialPerson, otherMonths, viewerId }: {
  initialPeriod: string;
  currentPeriod: string;
  initialPerson: string | null;
  /** SUBMITTED numbers waiting in months other than the one shown. */
  otherMonths: Array<{ period: string; count: number }>;
  viewerId: string;
}) {
  const pathname = usePathname();
  const fmt = useFormat();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { prefs, patchPrefs } = useOsShell();

  const [period, setPeriod] = useState(initialPeriod);
  const [personId, setPersonId] = useState<string | null>(initialPerson);
  const [summary, setSummary] = useState<{ people: SummaryPerson[]; direct: string[] } | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [lines, setLines] = useState<KpiLine[] | null>(null);
  const [records, setRecords] = useState<Map<string, KpiRecordRow>>(new Map());
  const [paneErr, setPaneErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bands, setBands] = useState<ScoringBand[]>(DEFAULT_SCORING_BANDS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>([]);
  const [directOnly, setDirectOnly] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<"attention" | "name">("attention");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [changesFor, setChangesFor] = useState<string[] | null>(null);
  const actualRefs = useRef(new Map<string, HTMLInputElement | null>());

  const stored = kpiReviewsSurfacePrefs(prefs.home);
  const [localPrefs, setLocalPrefs] = useState<Partial<KpiReviewsSurfacePrefs>>({});
  const display = { ...stored, ...localPrefs };
  const setDisplay = (patch: Partial<KpiReviewsSurfacePrefs>) => {
    setLocalPrefs((l) => ({ ...l, ...patch }));
    void patchPrefs({ home: { kpiReviews: patch } }).then((ok) => { if (!ok) toast("Couldn't save that setting. It applies until you leave.", { tone: "danger" }); });
  };

  const writable = isKpiPeriodWritable(period);

  // URL: ?period= and ?person= (the deep links from the Inbox and Alignment).
  useEffect(() => {
    const qs = new URLSearchParams();
    if (period !== currentPeriod) qs.set("period", period);
    if (personId) qs.set("person", personId);
    const next = qs.toString() ? `${pathname}?${qs}` : pathname;
    if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [period, personId, pathname, currentPeriod]);

  useEffect(() => {
    void apiFetch<{ scoringBands?: ScoringBand[]; settings?: Record<string, unknown> }>("/api/settings", { cache: "no-store" }).then((r) => {
      if (!r.ok) return;
      const s = (r.data as { settings?: Record<string, unknown> }).settings ?? (r.data as Record<string, unknown>);
      setBands(getScoringBands(s as never));
    });
  }, []);

  const loadSummary = useCallback(async () => {
    const r = await apiFetch<{ people: SummaryPerson[]; direct: string[] }>(`/api/kpi-records/summary?period=${period}`, { cache: "no-store" });
    if (!r.ok) { setSummaryErr(`${r.error || "Couldn't load KPI reviews"}${r.status ? ` (${r.status})` : ""}`); return; }
    setSummaryErr(null);
    setSummary({ people: r.data.people ?? [], direct: r.data.direct ?? [] });
  }, [period]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const loadPane = useCallback(async (uid: string) => {
    setPaneErr(null);
    const [a, rec] = await Promise.all([
      apiFetch<Array<{ status: string; weightage: number; kra: { id: string; name: string; kpis: Array<{ id: string; name: string; description: string | null; unit: string | null; type: string | null; targetValue: number | null; direction: KpiDirection | null; lowerIsBetter: boolean }> } }>>(`/api/kra-assignments?userId=${uid}`, { cache: "no-store" }),
      apiFetch<{ records: KpiRecordRow[] }>(`/api/kpi-records?userId=${uid}&period=${period}&limit=200`, { cache: "no-store" }),
    ]);
    if (!a.ok || !rec.ok) { setPaneErr((!a.ok ? a.error : !rec.ok ? rec.error : null) || "Couldn't load their numbers"); return; }
    const out: KpiLine[] = [];
    for (const asg of (Array.isArray(a.data) ? a.data : []).filter((x) => x.status === "ACTIVE")) {
      for (const k of asg.kra.kpis ?? []) {
        out.push({ kpiId: k.id, kraId: asg.kra.id, kraName: asg.kra.name, kraWeight: asg.weightage, name: k.name, description: k.description, unit: k.unit, type: k.type, target: k.targetValue, direction: k.direction ?? null, lowerIsBetter: k.lowerIsBetter });
      }
    }
    setLines(out);
    setRecords(new Map((rec.data.records ?? []).map((r) => [r.kpiId, r])));
  }, [period]);

  // The first person needing attention is selected unless ?person= is set.
  const peopleSorted = useMemo(() => {
    if (!summary) return null;
    const direct = new Set(summary.direct);
    let list = summary.people.filter((p) => {
      const chip = personKpiChip(p);
      if (statusFilter.length) {
        const key: StatusFilter | null = chip.key === "awaiting" ? "awaiting" : chip.key === "notRecorded" ? "notRecorded" : chip.key === "approved" ? "approved" : chip.key === "changes" ? "changes" : null;
        if (!key || !statusFilter.includes(key)) return false;
      }
      if (directOnly && !direct.has(p.userId)) return false;
      if (deptFilter.length && !deptFilter.includes(p.department?.id ?? "__none")) return false;
      return true;
    });
    const rank = (p: SummaryPerson) => { const k = personKpiChip(p).key; return k === "awaiting" ? 0 : k === "notRecorded" ? 1 : k === "changes" ? 2 : k === "approved" ? 3 : 4; };
    list = [...list].sort((x, y) => (sort === "attention" ? rank(x) - rank(y) : 0) || nameOf(x).localeCompare(nameOf(y)));
    return list;
  }, [summary, statusFilter, directOnly, deptFilter, sort]);

  useEffect(() => {
    if (!peopleSorted || personId) return;
    const first = peopleSorted.find((p) => personKpiChip(p).needsYou) ?? peopleSorted[0];
    if (first) setPersonId(first.userId);
  }, [peopleSorted, personId]);

  useEffect(() => {
    if (!personId) return;
    setLines(null);
    setSelected(new Set());
    setRowState({});
    setDrafts(loadDraft(personId, period));
    void loadPane(personId);
  }, [personId, period, loadPane]);

  const person = summary?.people.find((p) => p.userId === personId) ?? null;

  // Drafts that will save: a number typed on a row that takes one.
  const takesInput = useCallback((kpiId: string) => {
    const r = records.get(kpiId);
    return writable && (!r || r.status === "PENDING" || r.status === "REJECTED");
  }, [records, writable]);
  const pendingSaves = useMemo(() => Object.entries(drafts).filter(([kpiId, d]) => takesInput(kpiId) && parseActual(d.actual) != null), [drafts, takesInput]);
  const dirty = pendingSaves.length > 0;

  const setDraft = (kpiId: string, patch: Draft) => {
    if (!personId) return;
    const nextRow = { ...drafts[kpiId], ...patch };
    const next = { ...drafts };
    if ((nextRow.actual ?? "") === "" && (nextRow.notes ?? "") === "") delete next[kpiId];
    else next[kpiId] = nextRow;
    persistDraft(personId, period, next);
    setDrafts(next);
  };

  const saveOne = useCallback(async (kpiId: string, d: Draft): Promise<boolean> => {
    if (!personId) return false;
    const r = await apiFetch<KpiRecordRow>("/api/kpi-records", {
      method: "POST",
      json: { kpiId, userId: personId, period, actualValue: parseActual(d.actual), ...(d.notes?.trim() ? { managerNotes: d.notes.trim() } : {}) },
    });
    if (!r.ok) return false;
    setRecords((m) => new Map(m).set(kpiId, r.data));
    setDrafts((cur) => { const next = { ...cur }; delete next[kpiId]; persistDraft(personId, period, next); return next; });
    setRowState((s) => { const n = { ...s }; delete n[kpiId]; return n; });
    return true;
  }, [personId, period]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving || pendingSaves.length === 0) return true;
    setSaving(true);
    let failed = 0;
    for (const [kpiId, d] of pendingSaves) {
      let ok = await saveOne(kpiId, d);
      if (!ok) {
        setRowState((s) => ({ ...s, [kpiId]: { kind: "retrying", message: "Not saved, retrying" } }));
        await new Promise((res) => setTimeout(res, 1500));
        ok = await saveOne(kpiId, d);
        if (!ok) { failed += 1; setRowState((s) => ({ ...s, [kpiId]: { kind: "failed", message: "Not saved" } })); }
      }
    }
    setSaving(false);
    const done = pendingSaves.length - failed;
    if (done) toast(`Saved ${done} ${done === 1 ? "number" : "numbers"}`);
    if (failed) toast(`${failed} ${failed === 1 ? "number wasn't" : "numbers weren't"} saved. They are kept here; use Retry on the row.`, { tone: "danger" });
    void loadSummary();
    return failed === 0;
  }, [saving, pendingSaves, saveOne, toast, loadSummary]);

  useDirtyGuard(dirty, { onSave: save, id: "kpi-reviews" });
  useShortcut({
    id: "kpi-reviews.save",
    keys: "mod+s",
    label: "Save numbers",
    scope: "page",
    group: "On this page",
    inInputs: true,
    when: () => dirty,
    run: () => { void save(); },
  });

  const discard = async () => {
    const ok = await confirm({ title: `Discard ${pendingSaves.length} unsaved ${pendingSaves.length === 1 ? "number" : "numbers"}?`, confirmLabel: "Discard", destructive: true });
    if (!ok || !personId) return;
    setDrafts({});
    persistDraft(personId, period, {});
    setRowState({});
  };

  const guardSwitch = async (): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({
      title: `${pendingSaves.length} ${pendingSaves.length === 1 ? "number is" : "numbers are"} not saved`,
      description: "They stay as a draft on this device, but nobody sees them until you save.",
      confirmLabel: "Leave them unsaved",
    });
  };

  // Decisions on submitted numbers.
  const decide = useCallback(async (ids: string[], action: "approve" | "request_changes" | "reopen", notes?: string) => {
    let failed = 0;
    const done: string[] = [];
    for (const id of ids) {
      const rec = [...records.values()].find((r) => r.id === id);
      const noteDraft = rec ? drafts[rec.kpiId]?.notes?.trim() : undefined;
      const r = await apiFetch<{ status: KpiRecordRow["status"] }>(`/api/kpi-records/${id}/manager-review`, { method: "PATCH", json: { action, notes: notes ?? (action === "approve" ? noteDraft : undefined) } });
      if (!r.ok) { failed += 1; continue; }
      done.push(id);
      setRecords((m) => {
        const n = new Map(m);
        for (const [k, v] of n) if (v.id === id) n.set(k, { ...v, status: r.data.status, reviewedById: action === "reopen" ? null : viewerId, managerNotes: notes ?? noteDraft ?? v.managerNotes });
        return n;
      });
    }
    if (failed) toast(`${failed} couldn't be updated`, { tone: "danger" });
    setSelected(new Set());
    void loadSummary();
    return done;
  }, [records, drafts, toast, loadSummary, viewerId]);

  const approve = async (ids: string[]) => {
    const done = await decide(ids, "approve");
    if (!done.length) return;
    toast(done.length === 1 ? "Approved" : `Approved ${done.length} numbers`, { onUndo: () => { void decide(done, "reopen"); } });
  };

  const columns = useMemo<TableColumn<KpiLine>[]>(() => [
    { key: "kpi", label: "KPI", title: true, width: "minmax(130px,1.6fr)", render: (l) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{l.name}</span>
        {display.showDescriptions && l.description ? <span className="truncate text-sm font-normal text-ink-2">{l.description}</span> : null}
      </span>
    ) },
    { key: "target", label: "Target", width: "84px", numeric: true, render: (l) => <span className="truncate whitespace-nowrap tabular-nums text-ink" title={l.target == null ? undefined : `${num(l.target)}${l.unit ? ` ${l.unit}` : ""}`}>{l.target == null ? "No target" : `${num(l.target)}${l.unit ? ` ${l.unit}` : ""}`}</span> },
    { key: "actual", label: "Actual", width: "108px", render: (l) => {
      const r = records.get(l.kpiId);
      if (takesInput(l.kpiId)) {
        const st = rowState[l.kpiId];
        return (
          <span className="flex min-w-0 flex-col" onClick={(e) => e.stopPropagation()}>
            <span className="flex items-center gap-1">
              <input
                ref={(el) => { actualRefs.current.set(l.kpiId, el); }}
                aria-label={`Actual for ${l.name}`}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder={r?.actualValue != null ? num(r.actualValue) : "Record"}
                value={drafts[l.kpiId]?.actual ?? ""}
                onChange={(e) => setDraft(l.kpiId, { actual: e.target.value })}
                className={cn("h-8 w-16 min-w-0 rounded-md border bg-raised px-2 text-sm tabular-nums text-ink focus:border-brand focus:outline-none", st ? "border-danger-text" : "border-line")}
              />
              {l.unit ? <span className="max-w-[36px] truncate text-xs text-ink-2" title={l.unit}>{l.unit}</span> : null}
            </span>
            {st ? (
              <span className="text-xs text-danger-text">
                {st.message}{st.kind === "failed" ? <> · <button type="button" className="underline" onClick={() => void saveOne(l.kpiId, drafts[l.kpiId] ?? {}).then((ok) => { if (!ok) toast("Still not saved. Check your connection.", { tone: "danger" }); else void loadSummary(); })}>Retry</button></> : null}
              </span>
            ) : null}
          </span>
        );
      }
      return r?.actualValue != null ? <span className="tabular-nums">{num(r.actualValue)}{l.unit ? ` ${l.unit}` : ""}</span> : <span className="text-ink-2">None</span>;
    } },
    { key: "recorded", label: "Recorded", width: "150px", hideBelow: 1100, render: (l) => {
      const r = records.get(l.kpiId);
      if (!r || r.actualValue == null) return <span className="text-sm text-ink-2">Not recorded</span>;
      const who = r.reviewedById === viewerId ? (r.status === "APPROVED" ? "Approved by you" : "By you") : r.status === "SUBMITTED" || r.status === "REJECTED" ? (person?.firstName || "Them") : "Approved";
      return <span className="truncate text-sm text-ink-2">{who} · {fmt.date(r.updatedAt, "date")}</span>;
    } },
    { key: "score", label: "Score", width: "124px", render: (l) => {
      const r = records.get(l.kpiId);
      const typed = parseActual(drafts[l.kpiId]?.actual);
      const score = typed != null ? previewKpiScore({ type: l.type, target: l.target, direction: l.direction, lowerIsBetter: l.lowerIsBetter }, typed) : r?.score ?? null;
      if (score == null) return <span className="text-sm text-ink-2">No baseline</span>;
      // Bands run 0 to 100; a score over target (up to 120) reads as the top band.
      const band = scoreBand(Math.min(100, Math.max(0, score)), bands);
      const cls = band?.tone === "success" ? "text-success-text" : band?.tone === "warning" ? "text-warning-text" : band?.tone === "danger" ? "text-danger-text" : "text-ink";
      return <span className="truncate tabular-nums" title={band ? `${Math.round(score)}% · ${band.label}` : undefined}><span className={cls}>{Math.round(score)}%</span>{band ? <span className="text-ink-2"> · {band.label}</span> : null}</span>;
    } },
    { key: "note", label: "Note", width: "minmax(120px,1fr)", hideBelow: 900, render: (l) => {
      const r = records.get(l.kpiId);
      const canNote = takesInput(l.kpiId) || r?.status === "SUBMITTED";
      const draftNote = drafts[l.kpiId]?.notes;
      return (
        <span className="relative flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2" title={[r?.notes, r?.managerNotes ? `You: ${r.managerNotes}` : null].filter(Boolean).join("\n")}>
            {draftNote ? `You: ${draftNote}` : r?.notes ?? (r?.managerNotes ? `You: ${r.managerNotes}` : "")}
          </span>
          {canNote ? (
            <button type="button" onClick={() => setNoteFor(l.kpiId)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-ink-2 hover:bg-hover hover:text-ink" aria-label={`Note on ${l.name}`}>
              <MessageSquare className="h-4 w-4" aria-hidden /> Note
            </button>
          ) : null}
          {noteFor === l.kpiId ? <NotePopover initial={draftNote ?? ""} onClose={() => setNoteFor(null)} onDone={(text) => { setDraft(l.kpiId, { notes: text }); setNoteFor(null); }} /> : null}
        </span>
      );
    } },
    // Status and the decision share one column: a submitted number shows
    // Approve and Request changes (it is awaiting you); every other row shows
    // its one status chip. At 1440 with the sidebar open there is no room
    // for both without dropping Target or Score, which the old page had.
    { key: "status", label: "Status", width: "204px", render: (l) => {
      const r = records.get(l.kpiId);
      if (r?.status !== "SUBMITTED") {
        const st = r?.status ?? "PENDING";
        return <ToneChip tone={kpiStatusTone(st)} label={kpiStatusLabel(st, { forManager: true })} />;
      }
      return (
        <span className="relative flex items-center gap-1" title="Awaiting you" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <button type="button" onClick={() => void approve([r.id])} className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover">Approve</button>
          <button type="button" onClick={() => setChangesFor([r.id])} className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Request changes</button>
          {changesFor?.length === 1 && changesFor[0] === r.id ? (
            <div className="absolute end-0 top-8 z-50">
              <RequestChangesPopover personFirstName={person?.firstName || "them"} align="end" onCancel={() => setChangesFor(null)}
                onSend={async (note) => { const done = await decide([r.id], "request_changes", note); if (done.length) { setChangesFor(null); toast(`Sent ${person?.firstName || "them"} your note`); } return done.length > 0; }} />
            </div>
          ) : null}
        </span>
      );
    } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [records, drafts, rowState, takesInput, bands, display.showDescriptions, noteFor, changesFor, person, viewerId, fmt]);

  const kraWeight = useMemo(() => new Map((lines ?? []).map((l) => [l.kraId, l.kraWeight])), [lines]);
  const kraCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines ?? []) m.set(l.kraId, (m.get(l.kraId) ?? 0) + 1);
    return m;
  }, [lines]);
  const footerCounts = useMemo(() => {
    const c = { approved: 0, awaiting: 0, notRecorded: 0, changes: 0 };
    for (const l of lines ?? []) {
      const s = records.get(l.kpiId)?.status ?? "PENDING";
      if (s === "APPROVED") c.approved += 1; else if (s === "SUBMITTED") c.awaiting += 1; else if (s === "REJECTED") c.changes += 1; else c.notRecorded += 1;
    }
    return c;
  }, [lines, records]);

  const listItems: PersonStatusItem[] = (peopleSorted ?? []).map((p) => ({
    id: p.userId, firstName: p.firstName, lastName: p.lastName, email: p.email, avatar: p.avatar,
    title: [p.jobTitle, p.department?.name].filter(Boolean).join(" · ") || undefined,
    chip: (() => { const c = personKpiChip(p); return { label: c.label, tone: c.tone }; })(),
    muted: p.total === 0,
  }));
  const needs = (peopleSorted ?? []).filter((p) => personKpiChip(p).needsYou).map((p) => p.userId);
  const doneIds = (peopleSorted ?? []).filter((p) => !personKpiChip(p).needsYou).map((p) => p.userId);
  const sections = needs.length && doneIds.length ? [{ label: "Needs you", ids: needs }, { label: "Done", ids: doneIds }] : undefined;
  const deptOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of summary?.people ?? []) m.set(p.department?.id ?? "__none", p.department?.name ?? "No department");
    return [...m.entries()];
  }, [summary]);
  const filterCount = statusFilter.length + (directOnly ? 1 : 0) + deptFilter.length;
  const selectedSubmitted = [...selected];
  const others = otherMonths.filter((o) => o.period !== period && o.count > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OsPageHeader
        title="KPI reviews"
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((x) => !x), count: filterCount },
          sort: { onClick: () => setSortOpen((x) => !x), label: sort === "attention" ? "Sort" : "Name", active: sort !== "attention" },
          left: <MonthControl value={period} max={currentPeriod} onChange={async (p) => { if (await guardSwitch()) setPeriod(p); }} />,
          menu: [{ label: "Show KPI descriptions", checked: display.showDescriptions, keepOpen: true, onClick: () => setDisplay({ showDescriptions: !display.showDescriptions }) }],
        }}
      />
      {others.length ? (
        <p className="os-chrome m-0 px-6 pb-1 text-sm text-ink-2">
          Also awaiting you: {others.map((o, i) => (
            <span key={o.period}>{i ? ", " : ""}<button type="button" className="text-brand-deep hover:underline" onClick={async () => { if (await guardSwitch()) setPeriod(o.period); }}>{kpiPeriodLabel(o.period)} ({o.count})</button></span>
          ))}
        </p>
      ) : null}
      <div className="relative">
        {sortOpen ? (
          <div className="absolute start-[110px] top-0 z-40">
            <Picker open onClose={() => setSortOpen(false)} ariaLabel="Sort people" selected={sort}
              sections={[{ options: [{ value: "attention", label: "Needs attention first" }, { value: "name", label: "Name" }] }]}
              onSelect={(v) => { setSortOpen(false); setSort(v as "attention" | "name"); }} />
          </div>
        ) : null}
      </div>
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-4 pt-2">
        <FilterPanel open={filterOpen} onClose={() => setFilterOpen(false)} objects="people" activeCount={filterCount}
          onClearAll={() => { setStatusFilter([]); setDirectOnly(false); setDeptFilter([]); }}>
          <FilterGroup label="People">
            {([["awaiting", "Awaiting me"], ["notRecorded", "Not recorded"], ["approved", "Approved"], ["changes", "Changes requested"]] as Array<[StatusFilter, string]>).map(([k, label]) => (
              <FilterRow key={k} label={label} checked={statusFilter.includes(k)} onCheckedChange={(on) => setStatusFilter((c) => (on ? [...c, k] : c.filter((x) => x !== k)))} />
            ))}
            <FilterRow label="Direct reports only" checked={directOnly} onCheckedChange={setDirectOnly} />
          </FilterGroup>
          {deptOptions.length > 1 ? (
            <FilterGroup label="Department">
              {deptOptions.map(([id, name]) => <FilterRow key={id} label={name} checked={deptFilter.includes(id)} onCheckedChange={(on) => setDeptFilter((c) => (on ? [...c, id] : c.filter((x) => x !== id)))} />)}
            </FilterGroup>
          ) : null}
        </FilterPanel>
        {summaryErr && !summary ? (
          <div className="flex-1"><OsEmptyView variant="error" title="Couldn't load KPI reviews" hint={summaryErr} action={{ label: "Retry", onClick: () => void loadSummary() }} /></div>
        ) : summary && summary.people.length === 0 ? (
          <div className="flex-1"><OsEmptyView context="goals" title="Nobody has a manager yet" action={{ label: "See the org chart", href: "/organization" }} /></div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 gap-4 max-lg:flex-col">
            <aside className={cn("min-h-0 w-[280px] shrink-0 overflow-y-auto rounded-lg border border-line bg-subtle py-1 max-lg:w-full min-[1600px]:w-[360px]", personId ? "max-lg:hidden" : "")} aria-label="People">
              {!summary ? (
                <div className="flex flex-col gap-2 p-3" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className="h-8 animate-pulse rounded bg-surface-2" />)}</div>
              ) : listItems.length === 0 ? (
                <p className="m-0 px-3 py-3 text-row text-ink-2">Nobody matches · <button type="button" className="text-brand-deep hover:underline" onClick={() => { setStatusFilter([]); setDirectOnly(false); setDeptFilter([]); }}>Clear filters</button></p>
              ) : (
                <PersonStatusList people={listItems} selectedId={personId} sections={sections}
                  onSelect={async (id) => { if (id !== personId && (await guardSwitch())) setPersonId(id); }}
                  onEnter={() => { const first = (lines ?? []).find((l) => takesInput(l.kpiId)); if (first) actualRefs.current.get(first.kpiId)?.focus(); }} />
              )}
            </aside>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto" aria-label="Their numbers">
              {person ? (
                <>
                  <header className="flex h-14 shrink-0 items-center gap-3">
                    <button type="button" className="hidden text-sm text-brand-deep max-lg:inline" onClick={async () => { if (await guardSwitch()) setPersonId(null); }}>People</button>
                    <Avatar person={{ ...person, id: person.userId }} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-base font-semibold text-ink">{nameOf(person)}</p>
                      <p className="m-0 truncate text-sm text-ink-2">{[person.jobTitle, person.department?.name, `${person.total} ${person.total === 1 ? "KPI" : "KPIs"}`].filter(Boolean).join(" · ")}</p>
                    </div>
                    <a href={`/people/${person.userId}?tab=kras`} className="shrink-0 text-sm text-brand-deep hover:underline">Open profile</a>
                  </header>
                  {paneErr ? (
                    <OsEmptyView variant="error" title="Couldn't load their numbers" hint={paneErr} action={{ label: "Retry", onClick: () => void loadPane(person.userId) }} />
                  ) : lines && lines.length === 0 ? (
                    <OsEmptyView context="goals" title={`${person.firstName || nameOf(person)} has no KRAs or KPIs assigned yet`} action={{ label: "Assign KRAs", href: `/people/${person.userId}?tab=kras` }} />
                  ) : (
                    <TableCard
                      ariaLabel={`${nameOf(person)}'s KPIs`}
                      columns={columns}
                      rows={lines}
                      rowKey={(l) => l.kpiId}
                      groupOf={(l) => ({ key: l.kraId, label: <span className="flex items-baseline gap-2"><span>{l.kraName}</span>{(kraWeight.get(l.kraId) ?? 0) > 0 ? <span className="text-xs font-medium text-ink-2">{Math.round(kraWeight.get(l.kraId) ?? 0)}%</span> : null}</span>, count: kraCount.get(l.kraId) ?? null })}
                      selectable
                      isRowSelectable={(l) => records.get(l.kpiId)?.status === "SUBMITTED"}
                      selected={new Set([...selected].map((id) => [...records.values()].find((r) => r.id === id)?.kpiId).filter((x): x is string => !!x))}
                      onSelectedChange={(kpiIds) => setSelected(new Set([...kpiIds].map((k) => records.get(k)?.id).filter((x): x is string => !!x)))}
                      bulkActions={(
                        <span className="relative flex items-center gap-1">
                          <BulkAction icon={CheckCircle2} label="Approve" onClick={() => void approve(selectedSubmitted)} />
                          <BulkAction icon={XCircle} label="Request changes" onClick={() => setChangesFor(selectedSubmitted)} />
                          {changesFor && changesFor.length > 1 ? (
                            <div className="absolute bottom-10 start-0 z-50">
                              <RequestChangesPopover personFirstName={person.firstName || "them"} onCancel={() => setChangesFor(null)}
                                onSend={async (note) => { const done = await decide(changesFor, "request_changes", note); if (done.length) { setChangesFor(null); toast(`Sent ${person.firstName || "them"} your note on ${done.length} numbers`); } return done.length > 0; }} />
                            </div>
                          ) : null}
                        </span>
                      )}
                      footer={lines ? { total: lines.length, noun: "KPIs", from: lines.length ? 1 : 0, to: lines.length, extra: <>· {footerCounts.approved} approved · {footerCounts.awaiting} awaiting you · {footerCounts.notRecorded} not recorded{footerCounts.changes ? ` · ${footerCounts.changes} changes requested` : ""}</> } : undefined}
                    />
                  )}
                  <p className="m-0 text-sm text-ink-2">
                    Numbers are for {kpiPeriodLabel(period)}. {person.firstName || "They"} records theirs on their profile; you can record on their behalf or ask for a change.
                    {!writable ? " This month is closed for new numbers; submitted numbers can still be approved." : ""}
                  </p>
                </>
              ) : summary ? (
                <p className="m-0 text-row text-ink-2">Pick a person to see their numbers.</p>
              ) : null}
            </section>
          </div>
        )}
      </div>
      {dirty ? (
        <div className="os-chrome sticky bottom-0 z-30 flex h-14 shrink-0 items-center gap-3 border-t border-line bg-surface px-6" role="region" aria-label="Unsaved numbers">
          <span className="flex-1 text-row text-ink">{pendingSaves.length} {pendingSaves.length === 1 ? "number" : "numbers"} to save</span>
          <Button variant="ghost" onClick={() => void discard()} disabled={saving}>Discard</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving" : "Save numbers"}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** The 240 manager-note popover (the Picker frame, a textarea and Done). */
function NotePopover({ initial, onClose, onDone }: { initial: string; onClose: () => void; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const dirty = text !== initial;
  const tryClose = useCallback(async () => {
    if (dirty && !(await confirm({ title: "Discard this note?", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }, [dirty, confirm, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); void tryClose(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) void tryClose(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown); };
  }, [tryClose]);
  return (
    <div ref={ref} className="absolute end-0 top-8 z-50 w-[240px] rounded-lg border border-line bg-raised p-2" style={{ boxShadow: "var(--os-shadow-pop)" }} role="dialog" aria-label="Your note">
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={5000} placeholder="Your note to them"
        className="w-full resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none" />
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={() => onDone(text.trim())} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Done</button>
      </div>
    </div>
  );
}
