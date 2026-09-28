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
//               leaving with unsaved numbers asks first: a person switch, a
//               month change, and any in-app link (the sidebar, Open
//               profile) get the same Save numbers and leave / Leave them
//               unsaved / Keep editing choice; tab close gets the browser's
//               own prompt (useDirtyGuard)
//
// Save posts each number through POST /api/kpi-records (a number a manager
// records lands APPROVED with reviewedById; src/lib/kpi-record-status.ts).
// A failed row keeps its number, says "Not saved, retrying", retries once,
// then offers Retry; it is never dropped. Drafts also mirror to
// localStorage (workwrk:kpi-review-draft:{person}:{period}, the key the old
// page used), so an expired session or a closed tab does not lose typing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonthControl } from "@/components/ui/month-control";
import { ToneChip } from "@/components/people/person-bits";
import { PersonStatusList, type PersonStatusItem } from "@/components/team/person-status-list";
import { RequestChangesPopover, useAnchoredPosition } from "@/components/team/request-changes-popover";
import { sectionHrefNow } from "@/components/layout/os/use-object-href";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useElementWidth } from "@/hooks/use-element-width";
import { confirmLeave, setLeaveConfirmer, type LeaveDecision } from "@/lib/dirty-guard";
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

export interface RecentDecisionRow {
  id: string;
  userId: string;
  personName: string;
  kpiName: string;
  unit: string | null;
  period: string;
  status: "APPROVED" | "REJECTED";
  actualValue: number | null;
  byYou: boolean;
  updatedAt: string;
}

export function KpiReviewsView({ initialPeriod, currentPeriod, initialPerson, otherMonths, viewerId, recentDecisions = [] }: {
  initialPeriod: string;
  currentPeriod: string;
  initialPerson: string | null;
  /** SUBMITTED numbers waiting in months other than the one shown. */
  otherMonths: Array<{ period: string; count: number }>;
  viewerId: string;
  /** The last 30 days of decisions (the old approval tab's Recently acted). */
  recentDecisions?: RecentDecisionRow[];
}) {
  const pathname = usePathname();
  const router = useRouter();
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
  const [showRecent, setShowRecent] = useState(false);
  const actualRefs = useRef(new Map<string, HTMLInputElement | null>());
  // The right pane's width decides whether a submitted row's decision fits
  // as two labelled buttons (a wide screen) or Approve plus an icon (1440
  // with the sidebar open, where the labels took the KPI name's room).
  const paneRef = useRef<HTMLElement>(null);
  const paneWidth = useElementWidth(paneRef);
  const compactDecisions = paneWidth < 960;

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

  // Drafts that will save: a number typed on a row that takes one, and a
  // manager note typed on a row that takes one or on a submitted number
  // (saved on its own, it keeps the row's status: src/lib/kpi-record-status.ts).
  const takesInput = useCallback((kpiId: string) => {
    const r = records.get(kpiId);
    return writable && (!r || r.status === "PENDING" || r.status === "REJECTED");
  }, [records, writable]);
  const pendingSaves = useMemo(() => Object.entries(drafts).filter(([kpiId, d]) => {
    const hasNote = !!d.notes?.trim();
    if (takesInput(kpiId)) return parseActual(d.actual) != null || hasNote;
    return hasNote && writable && records.get(kpiId)?.status === "SUBMITTED";
  }), [drafts, takesInput, writable, records]);
  const pendingNumbers = pendingSaves.filter(([, d]) => parseActual(d.actual) != null).length;
  const pendingNotes = pendingSaves.length - pendingNumbers;
  const pendingLabel = [
    pendingNumbers ? `${pendingNumbers} ${pendingNumbers === 1 ? "number" : "numbers"}` : null,
    pendingNotes ? `${pendingNotes} ${pendingNotes === 1 ? "note" : "notes"}` : null,
  ].filter(Boolean).join(" and ");
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
      // A note-only save sends no number, so the stored one stays as it is.
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
    if (done) toast(`Saved ${done} ${done === 1 ? "change" : "changes"}`);
    if (failed) toast(`${failed} ${failed === 1 ? "change wasn't" : "changes weren't"} saved. They are kept here; use Retry on the row.`, { tone: "danger" });
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
    const ok = await confirm({ title: `Discard ${pendingLabel}?`, confirmLabel: "Discard", destructive: true });
    if (!ok || !personId) return;
    setDrafts({});
    persistDraft(personId, period, {});
    setRowState({});
  };

  // Leaving with unsaved numbers asks, on the app's own dialog, with three
  // ways out: save and leave (a failed save keeps the person here, the rows
  // saying Not saved with Retry), leave them unsaved (they stay as this
  // device's draft), or keep editing. useDirtyGuard alone only covered tab
  // close: a sidebar link left in silence, and a manager who typed a
  // month of numbers and clicked away believed they were recorded.
  const [leaveAsk, setLeaveAsk] = useState<{ resolve: (d: LeaveDecision) => void } | null>(null);
  const askLeave = useCallback(() => new Promise<LeaveDecision>((resolve) => setLeaveAsk({ resolve })), []);
  const decideLeave = (d: LeaveDecision) => {
    const cur = leaveAsk;
    setLeaveAsk(null);
    cur?.resolve(d);
  };
  useEffect(() => {
    setLeaveConfirmer(askLeave);
    return () => setLeaveConfirmer(null);
  }, [askLeave]);
  // Any in-app link while dirty (the sidebar, the breadcrumb, Open profile,
  // an empty view's Assign KRAs) goes through confirmLeave first: the form
  // builder's pattern. A link the section interceptor already remapped
  // arrives defaultPrevented, and that interceptor asks confirmLeave itself.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmLeave().then((ok) => { if (ok) router.push(sectionHrefNow(url.pathname + url.search + url.hash)); });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, router]);

  // A person switch or a month change asks the same question. The drafts
  // are keyed by person and month, so leaving them unsaved loses nothing on
  // this device; saving first keeps the person here when a row fails.
  const guardSwitch = async (): Promise<boolean> => {
    if (!dirty) return true;
    const d = await askLeave();
    if (d === "stay") return false;
    if (d === "discard") return true;
    return save();
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
    // Widths at 1440 with the sidebar open (a 768px card, Recorded and Score
    // already hidden): the KPI name is what the manager reads a row by, so it
    // takes the larger share and Note the smaller; the names still truncate
    // on a narrower card, so the full one is on hover.
    { key: "kpi", label: "KPI", title: true, width: "minmax(160px,1.5fr)", render: (l) => (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate" title={l.name}>{l.name}</span>
        {display.showDescriptions && l.description ? <span className="truncate text-sm font-normal text-ink-2">{l.description}</span> : null}
      </span>
    ) },
    { key: "target", label: "Target", width: "96px", numeric: true, render: (l) => <span className="truncate whitespace-nowrap tabular-nums text-ink" title={l.target == null ? undefined : `${num(l.target)}${l.unit ? ` ${l.unit}` : ""}`}>{l.target == null ? "No target" : `${num(l.target)}${l.unit ? ` ${l.unit}` : ""}`}</span> },
    { key: "actual", label: "Actual", width: "140px", render: (l) => {
      const r = records.get(l.kpiId);
      if (takesInput(l.kpiId)) {
        const st = rowState[l.kpiId];
        return (
          <span className="flex min-w-0 items-center" onClick={(e) => e.stopPropagation()}>
            <span className="flex min-w-0 items-center gap-1">
              <input
                ref={(el) => { actualRefs.current.set(l.kpiId, el); }}
                aria-label={`Actual for ${l.name}`}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder={r?.actualValue != null ? num(r.actualValue) : "Record"}
                value={drafts[l.kpiId]?.actual ?? ""}
                onChange={(e) => setDraft(l.kpiId, { actual: e.target.value })}
                aria-invalid={st ? true : undefined}
                // 72px with the spin buttons hidden (the kra-dialog idiom; the arrow
                // keys still step): Chrome kept room for them inside a 56px box
                // and cut the "Record" placeholder to "Recc".
                className={cn("w-[72px] min-w-0 shrink-0 rounded-md border bg-raised px-2 text-sm tabular-nums text-ink focus:border-brand focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none", st ? "border-danger-text" : "border-line")}
                style={{ height: "calc(var(--os-row-h) - 12px)" }}
              />
              {l.unit ? <span className="min-w-0 max-w-[48px] truncate text-xs text-ink-2" title={l.unit}>{l.unit}</span> : null}
            </span>
          </span>
        );
      }
      return r?.actualValue != null ? <span className="tabular-nums">{num(r.actualValue)}{l.unit ? ` ${l.unit}` : ""}</span> : <span className="text-ink-2">None</span>;
    } },
    // Column priority at a laptop width: Recorded leaves first, then Score;
    // Note never leaves (the employee's explanation must be in front of the
    // manager who approves). Both come back through the column settings.
    { key: "recorded", label: "Recorded", width: "140px", hideBelow: 1100, render: (l) => {
      const r = records.get(l.kpiId);
      if (!r || r.actualValue == null) return <span className="text-sm text-ink-2">Not recorded</span>;
      const who = r.reviewedById === viewerId ? (r.status === "APPROVED" ? "Approved by you" : "By you") : r.status === "SUBMITTED" || r.status === "REJECTED" ? (person?.firstName || "Them") : "Approved";
      return <span className="truncate text-sm text-ink-2">{who} · {fmt.date(r.updatedAt, "date")}</span>;
    } },
    { key: "score", label: "Score", width: "112px", hideBelow: 900, render: (l) => {
      const r = records.get(l.kpiId);
      const typed = parseActual(drafts[l.kpiId]?.actual);
      const score = typed != null ? previewKpiScore({ type: l.type, target: l.target, direction: l.direction, lowerIsBetter: l.lowerIsBetter }, typed) : r?.score ?? null;
      if (score == null) return <span className="text-sm text-ink-2">No baseline</span>;
      // Bands run 0 to 100; a score over target (up to 120) reads as the top band.
      const band = scoreBand(Math.min(100, Math.max(0, score)), bands);
      const cls = band?.tone === "success" ? "text-success-text" : band?.tone === "warning" ? "text-warning-text" : band?.tone === "danger" ? "text-danger-text" : "text-ink";
      return <span className="truncate tabular-nums" title={band ? `${Math.round(score)}% · ${band.label}` : undefined}><span className={cls}>{Math.round(score)}%</span>{band ? <span className="text-ink-2"> · {band.label}</span> : null}</span>;
    } },
    { key: "note", label: "Note", width: "minmax(120px,1fr)", render: (l) => {
      const r = records.get(l.kpiId);
      const canNote = takesInput(l.kpiId) || r?.status === "SUBMITTED";
      const draftNote = drafts[l.kpiId]?.notes;
      return (
        <span className="relative flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2" title={[r?.notes, r?.managerNotes ? `You: ${r.managerNotes}` : null].filter(Boolean).join("\n")}>
            {draftNote ? `You: ${draftNote}` : r?.notes ?? (r?.managerNotes ? `You: ${r.managerNotes}` : "")}
          </span>
          {canNote ? (
            // With a note already showing, the control shrinks to its icon so
            // the note itself gets the room.
            <button type="button" onClick={() => setNoteFor(l.kpiId)} title="Your note" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-ink-2 hover:bg-hover hover:text-ink" aria-label={`Note on ${l.name}`}>
              <MessageSquare className="h-4 w-4" aria-hidden />{draftNote || r?.notes || r?.managerNotes ? null : " Note"}
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
    // On a pane under 960px Request changes is an icon (named in its tooltip
    // and label, and still a word in the bulk bar), which gives the KPI name
    // the room the two labels took.
    { key: "status", label: "Status", width: compactDecisions ? "164px" : "220px", render: (l) => {
      const r = records.get(l.kpiId);
      // An unsaved row says so here, where there is room for the Retry.
      const st = rowState[l.kpiId];
      if (st) {
        return (
          <span className="flex min-w-0 items-center gap-1 text-sm text-danger-text" role="status" onClick={(e) => e.stopPropagation()}>
            <span className="truncate">{st.kind === "retrying" ? "Not saved, retrying" : "Not saved"}</span>
            {st.kind === "failed" ? (
              <button type="button" className="shrink-0 rounded px-1 font-medium underline hover:bg-hover" onClick={() => void saveOne(l.kpiId, drafts[l.kpiId] ?? {}).then((ok) => { if (!ok) toast("Still not saved. Check your connection.", { tone: "danger" }); else void loadSummary(); })}>Retry</button>
            ) : null}
          </span>
        );
      }
      if (r?.status !== "SUBMITTED") {
        const st = r?.status ?? "PENDING";
        return <ToneChip tone={kpiStatusTone(st)} label={kpiStatusLabel(st, { forManager: true })} />;
      }
      return (
        <span className="relative flex items-center gap-1" title="Awaiting you" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <button type="button" onClick={() => void approve([r.id])} style={{ height: "calc(var(--os-row-h) - 16px)" }} className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-line bg-raised px-2 text-sm font-medium text-ink hover:bg-hover">Approve</button>
          {compactDecisions ? (
            <button type="button" onClick={() => setChangesFor([r.id])} title="Request changes" aria-label={`Request changes on ${l.name}`} style={{ height: "calc(var(--os-row-h) - 16px)", width: "calc(var(--os-row-h) - 16px)" }} className="inline-flex shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><XCircle className="h-4 w-4" aria-hidden /></button>
          ) : (
            <button type="button" onClick={() => setChangesFor([r.id])} style={{ height: "calc(var(--os-row-h) - 16px)" }} className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Request changes</button>
          )}
          {/* Fixed, hung off this cell: it floats over the table instead of
              being clipped by the card (request-changes-popover.tsx). */}
          {changesFor?.length === 1 && changesFor[0] === r.id ? (
            <RequestChangesPopover personFirstName={person?.firstName || "them"} align="end" onCancel={() => setChangesFor(null)}
              onSend={async (note) => { const done = await decide([r.id], "request_changes", note); if (done.length) { setChangesFor(null); toast(`Sent ${person?.firstName || "them"} your note`); } return done.length > 0; }} />
          ) : null}
        </span>
      );
    } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [records, drafts, rowState, takesInput, bands, display.showDescriptions, noteFor, changesFor, person, viewerId, fmt, compactDecisions]);

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
      {others.length || recentDecisions.length ? (
        <p className="os-chrome m-0 flex flex-wrap items-center gap-x-4 px-6 pb-1 text-sm text-ink-2">
          {others.length ? (
            <span>
              Also awaiting you: {others.map((o, i) => (
                <span key={o.period}>{i ? ", " : ""}<button type="button" className="text-brand-deep hover:underline" onClick={async () => { if (await guardSwitch()) { setShowRecent(false); setPeriod(o.period); } }}>{kpiPeriodLabel(o.period)} ({o.count})</button></span>
              ))}
            </span>
          ) : null}
          {recentDecisions.length ? (
            <button type="button" className="text-brand-deep hover:underline" aria-pressed={showRecent} onClick={() => setShowRecent((x) => !x)}>
              {showRecent ? "Back to people" : `Recently decided (${recentDecisions.length})`}
            </button>
          ) : null}
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
                <div className="flex flex-col gap-2 p-3" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className="h-8 rounded bg-skeleton os-skeleton-pulse" />)}</div>
              ) : listItems.length === 0 ? (
                <p className="m-0 px-3 py-3 text-row text-ink-2">Nobody matches · <button type="button" className="text-brand-deep hover:underline" onClick={() => { setStatusFilter([]); setDirectOnly(false); setDeptFilter([]); }}>Clear filters</button></p>
              ) : (
                <PersonStatusList people={listItems} selectedId={personId} sections={sections}
                  onSelect={async (id) => { if (id !== personId && (await guardSwitch())) setPersonId(id); }}
                  onEnter={() => { const first = (lines ?? []).find((l) => takesInput(l.kpiId)); if (first) actualRefs.current.get(first.kpiId)?.focus(); }} />
              )}
            </aside>
            <section ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto" aria-label="Their numbers">
              {showRecent ? (
                <RecentDecisions rows={recentDecisions} fmt={fmt} onOpen={async (row) => {
                  if (!(await guardSwitch())) return;
                  setShowRecent(false);
                  setPeriod(row.period);
                  setPersonId(row.userId);
                }} />
              ) : person ? (
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
                        // self-stretch: the popover hangs off this span, so it
                        // is as tall as the bar and "above" clears the bar's edge.
                        <span className="relative flex items-center gap-1 self-stretch">
                          <BulkAction icon={CheckCircle2} label="Approve" onClick={() => void approve(selectedSubmitted)} />
                          <BulkAction icon={XCircle} label="Request changes" onClick={() => setChangesFor(selectedSubmitted)} />
                          {changesFor && changesFor.length > 1 ? (
                            <RequestChangesPopover personFirstName={person.firstName || "them"} prefer="above" onCancel={() => setChangesFor(null)}
                              onSend={async (note) => { const done = await decide(changesFor, "request_changes", note); if (done.length) { setChangesFor(null); toast(`Sent ${person.firstName || "them"} your note on ${done.length} numbers`); } return done.length > 0; }} />
                          ) : null}
                        </span>
                      )}
                      columnSettings={{ storageKey: "kpi-reviews" }}
                      footer={lines ? { total: lines.length, noun: "KPIs", from: lines.length ? 1 : 0, to: lines.length, hidePaging: true, extra: <>· {footerCounts.approved} approved · {footerCounts.awaiting} awaiting you · {footerCounts.notRecorded} not recorded{footerCounts.changes ? ` · ${footerCounts.changes} changes requested` : ""}</> } : undefined}
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
          <span className="flex-1 text-row text-ink">{pendingLabel} to save</span>
          <Button variant="ghost" onClick={() => void discard()} disabled={saving}>Discard</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving" : pendingNumbers ? "Save numbers" : "Save notes"}</Button>
        </div>
      ) : null}
      <Dialog open={!!leaveAsk} onOpenChange={(o) => { if (!o) decideLeave("stay"); }}>
        <DialogContent className="os-chrome max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="text-lg">{pendingLabel || "Your changes"} not saved</DialogTitle>
            <DialogDescription>They stay as a draft on this device, but nobody sees them until you save.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => decideLeave("stay")}>Keep editing</Button>
            <Button variant="outline" onClick={() => decideLeave("discard")}>Leave them unsaved</Button>
            <Button onClick={() => decideLeave("save")}>{pendingNumbers ? "Save numbers and leave" : "Save notes and leave"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The old approval tab's "Recently acted": 30 days of decisions, newest first. */
function RecentDecisions({ rows, fmt, onOpen }: { rows: RecentDecisionRow[]; fmt: ReturnType<typeof useFormat>; onOpen: (row: RecentDecisionRow) => void }) {
  const columns: TableColumn<RecentDecisionRow>[] = [
    { key: "person", label: "Person", title: true, width: "minmax(140px,1fr)", render: (r) => <span className="truncate">{r.personName}</span> },
    { key: "kpi", label: "KPI", width: "minmax(140px,1.4fr)", render: (r) => <span className="truncate">{r.kpiName}</span> },
    { key: "month", label: "Month", width: "160px", render: (r) => <span className="truncate text-ink-2">{kpiPeriodLabel(r.period)}</span> },
    { key: "actual", label: "Actual", width: "96px", numeric: true, render: (r) => (r.actualValue == null ? <span className="text-ink-2">None</span> : <span className="truncate">{num(r.actualValue)}{r.unit ? ` ${r.unit}` : ""}</span>) },
    { key: "status", label: "Decision", width: "180px", render: (r) => <ToneChip tone={kpiStatusTone(r.status)} label={`${kpiStatusLabel(r.status, { forManager: true })}${r.byYou ? " by you" : ""}`} /> },
    { key: "when", label: "When", width: "96px", hideBelow: 760, render: (r) => <span className="text-sm text-ink-2">{fmt.date(r.updatedAt, "date")}</span> },
  ];
  return (
    <>
      <header className="flex h-14 shrink-0 items-center">
        <p className="m-0 text-base font-semibold text-ink">Recently decided</p>
        <span className="ms-2 text-sm text-ink-2">The last 30 days</span>
      </header>
      <TableCard
        ariaLabel="Recently decided KPI numbers"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r)}
        columnSettings={{ storageKey: "kpi-reviews-recent" }}
        footer={{ total: rows.length, noun: "decisions", from: rows.length ? 1 : 0, to: rows.length, hidePaging: true }}
      />
    </>
  );
}

/** The 240 manager-note popover (the Picker frame, a textarea and Done). */
function NotePopover({ initial, onClose, onDone }: { initial: string; onClose: () => void; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const dirty = text !== initial;
  // Fixed and hung off the note cell, like RequestChangesPopover: absolute,
  // the table card clipped it and scrolled its own row away.
  useAnchoredPosition(ref, { align: "end" });
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
    <div ref={ref} className="fixed z-[60] w-[240px] rounded-lg border border-line bg-raised p-2" style={{ boxShadow: "var(--os-shadow-pop)" }} role="dialog" aria-label="Your note">
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={5000} placeholder="Your note to them"
        className="w-full resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none" />
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={() => onDone(text.trim())} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">Done</button>
      </div>
    </div>
  );
}
