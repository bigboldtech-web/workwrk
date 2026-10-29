"use client";

// The target editor (docs/plans/recurring-goals.md E3): the one new dialog.
// Opened by "Edit target" in a target's row menu and by "More options" on
// the inline composer (which stays for quick hand-typed targets), only while
// the RECURRING_GOALS switch is on.
//
// THE LAYOUT IS THE DASHBOARD WIDGET EDITOR'S, copied as a pattern (its
// Title, kind and Scope rows mean nothing for a target): a 48px title bar, a
// live preview on the left on the subtle canvas, a 340px settings column on
// the right, and a footer with Cancel and the dialog's one blue primary.
// Reused as they are: Dialog, SettingsRow and PickerButton (the widget
// registry's), SegmentedControl. New: this component, its rows, the KPI
// Latest / Sum / Average picker and the preview line ("This month so far: 42
// of 60").
//
// MEASURED BY (C2): Check-ins (what people type), A List (C3: Where, A Space
// or Choose Lists through WidgetSourcePicker's goal surface; What, Count of
// tasks, Sum of or Average of a number field; Which tasks, the dashboard's
// WidgetFilterEditor unchanged; Counted by, Done date, Created date, Due
// date, a Date field or Right now) or A KPI (the owner's KPI records; a
// quarterly or yearly goal combines its months: Latest month, Sum of months,
// Average of months). A table shows its rows so the layout is the finished
// one, and says it is not available yet; step 5 wires it. A weekly goal
// cannot read a KPI (C6), and the editor says so before the save, as the
// server would.
//
// A LIST'S PREVIEW is POST /api/okrs/[id]/key-results/preview, counted as
// the person editing over the period running now ("This month so far: 42 of
// 60"). Before saving a source not open to the whole workspace, the editor
// says "Everyone who can see this goal will see this number." (C9). A
// source the editor cannot open is private to them too: they read who
// connected it and may Replace it, never its settings (the server never sent
// them). A paused source shows why; Reconnect is in the target's row menu
// (C10).
//
// EACH PERIOD STARTS AT (B4): Start value or Last period's number, on a
// repeating goal's hand-checked target; the default follows the target's
// direction (a target that counts down carries its level).
//
// Saving: POST /api/okrs/[id]/key-results (new) or PATCH .../[krId] (edit),
// then router.refresh(). A failed save keeps the dialog open with the error.
// Every popover inside is an absolutely positioned DOM child (PickerButton),
// never a portal: ui/dialog centres itself with a transform.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, PauseCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { numberFields, PickerButton, SettingsRow } from "@/components/dashboards/widget-registry";
import { WidgetSourcePicker } from "@/components/dashboards/widget-source-picker";
import { WidgetFilterEditor } from "@/components/dashboards/widget-filter-editor";
import { useListFacts } from "@/components/dashboards/widget-editor";
import { EMPTY_FILTER, type WidgetFilter, type WidgetSource } from "@/lib/dashboards/widgets";
import type { FieldDef } from "@/lib/field-catalog";
import type { GoalCadence } from "@/lib/goals/goal-period";
import {
  AUDIENCE_LINE,
  COUNTED_BY_LABEL,
  GOAL_DATE_TYPES,
  PRIVATE_LIST_WORDS,
  parseListSource,
  serializeListSource,
  type ListCountedBy,
  type ListMetric,
  type ListSource,
} from "@/lib/goals/goal-source";

export type MeasuredBy = "checkins" | "list" | "table" | "kpi";
export type KpiCombineChoice = "LATEST" | "SUM" | "AVERAGE";

export interface TargetEditorGoal {
  okrId: string;
  /** The goal's cadence, or null for a one-time goal. */
  repeat: GoalCadence | null;
  ownerId: string | null;
  /** The period the preview names ("This month"), or null for a one-time goal. */
  periodWord: string | null;
  /** The current period's KPI months ("YYYY-MM"), for a KPI's preview. */
  kpiMonths: string[];
}

export interface TargetEditorInitial {
  /** Set when editing a saved target. */
  id?: string;
  title: string;
  startValue: number;
  targetValue: number;
  unit: string | null;
  /** This period's number (edit), for the preview. */
  currentValue?: number;
  kpiId: string | null;
  kpiName?: string | null;
  periodStart?: string | null;
  combine?: KpiCombineChoice | null;
  /** A List source's settings (C3), when the editor can open it. */
  listSource?: Record<string, unknown> | null;
  /** A List source the editor cannot open (C9): who connected it, never its settings. */
  privateSource?: { connectorName: string | null } | null;
  /** Why the List source stopped counting (C10), or null. */
  paused?: string | null;
}

/** A List source being edited: where, what, which tasks, counted by. */
export interface ListDraft {
  where: WidgetSource;
  metric: ListMetric;
  filter: WidgetFilter;
  countedBy: ListCountedBy;
  dateFieldKey: string | null;
}

export function emptyListDraft(): ListDraft {
  return { where: { kind: "lists", listIds: [] }, metric: { op: "count" }, filter: { ...EMPTY_FILTER, rules: [] }, countedBy: "done", dateFieldKey: null };
}

export function draftOf(s: ListSource): ListDraft {
  return {
    where: s.kind === "space" ? { kind: "space", spaceId: s.spaceId ?? "" } : { kind: "lists", listIds: s.listIds },
    metric: s.metric, filter: s.filter, countedBy: s.countedBy, dateFieldKey: s.dateFieldKey,
  };
}

/** The draft as the routes take it, or null while it is not complete. */
export function listSourceOf(d: ListDraft): ListSource | null {
  const raw = {
    kind: d.where.kind === "space" ? "space" : "list",
    ...(d.where.kind === "space" ? { spaceId: d.where.spaceId } : { listIds: d.where.kind === "lists" ? d.where.listIds : [] }),
    metric: d.metric,
    filter: d.filter,
    countedBy: d.countedBy,
    ...(d.countedBy === "field" ? { dateFieldKey: d.dateFieldKey } : {}),
  };
  return parseListSource(raw);
}

/** The fields a target may add up: the dashboard's number fields, and ratings (C3). */
export function goalNumberFields(fields: readonly FieldDef[]): FieldDef[] {
  return [...numberFields(fields), ...fields.filter((f) => String(f.type) === "RATING")];
}

const MEASURED_OPTIONS: { value: MeasuredBy; label: string }[] = [
  { value: "checkins", label: "Check-ins" },
  { value: "list", label: "A List" },
  { value: "table", label: "A table" },
  { value: "kpi", label: "A KPI" },
];

const COMBINE_LABEL: Record<KpiCombineChoice, string> = { LATEST: "Latest month", SUM: "Sum of months", AVERAGE: "Average of months" };
const NOT_YET = "Counting a target from a table is not available yet. Choose Check-ins, A List or A KPI for now.";
const KPI_WEEKLY = "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.";

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** B4's default: a target that counts down carries its level; every other one starts again. */
export function defaultPeriodStart(startValue: number, targetValue: number): "START" | "LAST" {
  return targetValue < startValue ? "LAST" : "START";
}

/** The preview's progress, as the server measures a hand-checked target (direction from start and target). */
export function previewPercent(start: number, target: number, value: number): number {
  if (target === start) return value >= target ? 100 : 0;
  const raw = target > start ? (value - start) / (target - start) : (start - value) / (start - target);
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

/** What the editor sends (POST or PATCH body), from its fields. */
export function targetEditorPayload(f: {
  title: string;
  startValue: number;
  targetValue: number;
  unit: string;
  measuredBy: MeasuredBy;
  kpiId: string | null;
  combine: KpiCombineChoice;
  periodStart: "START" | "LAST";
  repeat: GoalCadence | null;
  hadSource: boolean;
  /** Measured by a List: the source to send, or null to keep the stored one (a private source not replaced). */
  listSource?: ListSource | null;
  /** Reconnect the stored List source as the person saving (C10). */
  reconnect?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: f.title.trim(),
    startValue: f.startValue,
    targetValue: f.targetValue,
    unit: f.unit.trim() || null,
  };
  if (f.measuredBy === "list") {
    body.kpiId = null;
    if (f.listSource) body.source = serializeListSource(f.listSource);
    if (f.reconnect) body.reconnect = true;
    return body;
  }
  if (f.measuredBy === "kpi") {
    body.kpiId = f.kpiId;
    // A quarterly or yearly goal combines the KPI's months (C6).
    if (f.repeat === "QUARTERLY" || f.repeat === "YEARLY") body.source = { kind: "kpi", combine: f.combine };
    else if (f.hadSource) body.source = null;
  } else {
    body.kpiId = null;
    if (f.hadSource) body.source = null;
    if (f.repeat) body.periodStart = f.periodStart;
  }
  return body;
}

interface KpiOption { id: string; name: string; unit: string | null; kra?: { name: string } | null; records?: Array<{ period: string; actualValue: number | null; status?: string }> }

export function TargetEditor({ goal, initial, onClose, onSaved }: {
  goal: TargetEditorGoal;
  initial: TargetEditorInitial;
  onClose: () => void;
  /** After a successful save, before the dialog closes. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const isEdit = Boolean(initial.id);
  const initialList = useMemo(() => parseListSource(initial.listSource ?? null), [initial.listSource]);
  const hadList = Boolean(initialList || initial.privateSource);
  const initialMeasure: MeasuredBy = initial.kpiId ? "kpi" : hadList ? "list" : "checkins";
  const [title, setTitle] = useState(initial.title);
  const [start, setStart] = useState(String(initial.startValue));
  const [target, setTarget] = useState(String(initial.targetValue));
  const [unit, setUnit] = useState(initial.unit ?? "");
  const [measuredBy, setMeasuredBy] = useState<MeasuredBy>(initialMeasure);
  const [kpiId, setKpiId] = useState<string | null>(initial.kpiId);
  const [combine, setCombine] = useState<KpiCombineChoice>(initial.combine ?? "LATEST");
  const [periodStart, setPeriodStart] = useState<"START" | "LAST">(
    initial.periodStart === "START" || initial.periodStart === "LAST" ? initial.periodStart : defaultPeriodStart(initial.startValue, initial.targetValue),
  );
  const [periodStartTouched, setPeriodStartTouched] = useState(initial.periodStart === "START" || initial.periodStart === "LAST");
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A List source (C3): the draft, and whether a private one is being replaced.
  const [draft, setDraft] = useState<ListDraft>(() => (initialList ? draftOf(initialList) : emptyListDraft()));
  const [replacing, setReplacing] = useState(false);
  const [preview, setPreview] = useState<{ key: string; value: number | null; paused: string | null; open: boolean } | null>(null);

  // The org's KPIs, with the owner's recent numbers for the preview when the
  // viewer may read them (GET /api/kpis?userId=); else the definitions only.
  const wantKpis = measuredBy === "kpi" && kpis === null;
  useEffect(() => {
    if (!wantKpis) return;
    let live = true;
    void (async () => {
      const withOwner = goal.ownerId ? await fetch(`/api/kpis?userId=${encodeURIComponent(goal.ownerId)}`, { cache: "no-store" }).catch(() => null) : null;
      const res = withOwner?.ok ? withOwner : await fetch("/api/kpis", { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (live) setKpis(((j?.data ?? j) as KpiOption[] | null) ?? []);
    })();
    return () => { live = false; };
  }, [wantKpis, goal.ownerId]);

  const s = Number(start);
  const t = Number(target);
  const numbersOk = start.trim() !== "" && target.trim() !== "" && Number.isFinite(s) && Number.isFinite(t);
  const kpi = kpis?.find((k) => k.id === kpiId) ?? null;
  const kpiName = kpi?.name ?? (kpiId === initial.kpiId ? initial.kpiName ?? null : null);
  const weeklyKpi = measuredBy === "kpi" && goal.repeat === "WEEKLY";
  const notYet = measuredBy === "table";
  const combines = goal.repeat === "QUARTERLY" || goal.repeat === "YEARLY";

  // The List rows: a private source not being replaced keeps what it is.
  const keepsPrivate = measuredBy === "list" && !!initial.privateSource && !replacing;
  const listIds = draft.where.kind === "lists" ? draft.where.listIds : [];
  const facts = useListFacts(measuredBy === "list" && !keepsPrivate ? listIds : [], []);
  const chosen = keepsPrivate ? null : listSourceOf(draft);
  const chosenKey = chosen ? JSON.stringify(serializeListSource(chosen)) : "";
  const sourceChanged = !!chosen && (!initialList || chosenKey !== JSON.stringify(serializeListSource(initialList)));

  // The List's preview, counted on the server as the person editing.
  useEffect(() => {
    if (measuredBy !== "list" || !chosen || !chosenKey) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/okrs/${goal.okrId}/key-results/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: JSON.parse(chosenKey) }),
          });
          const j = res.ok ? await res.json().catch(() => null) : null;
          if (!live) return;
          setPreview({ key: chosenKey, value: typeof j?.value === "number" ? j.value : null, paused: typeof j?.paused === "string" ? j.paused : res.ok ? null : "The preview could not be counted.", open: j?.openToWorkspace !== false });
        } catch {
          if (live) setPreview({ key: chosenKey, value: null, paused: "The preview could not be counted.", open: true });
        }
      })();
    }, 300);
    return () => { live = false; clearTimeout(timer); };
    // chosenKey is the content of `chosen`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuredBy, chosenKey, goal.okrId]);
  const listPreview = preview && preview.key === chosenKey ? preview : null;

  // The preview's number: this period's for a saved target measured the same
  // way, the owner's KPI months for a newly chosen KPI, the List's count, else
  // the start.
  const previewValue = useMemo(() => {
    if (measuredBy === "kpi") {
      if (kpiId && kpiId === initial.kpiId && initial.currentValue != null) return initial.currentValue;
      const recs = (kpi?.records ?? []).filter((r) => r.actualValue != null && r.status !== "REJECTED" && goal.kpiMonths.includes(r.period));
      if (recs.length === 0) return null;
      const values = goal.kpiMonths.map((m) => recs.find((r) => r.period === m)?.actualValue).filter((v): v is number => v != null);
      if (values.length === 0) return null;
      if (!combines || combine === "LATEST") return values[values.length - 1];
      const sum = values.reduce((a, b) => a + b, 0);
      return combine === "SUM" ? sum : sum / values.length;
    }
    if (measuredBy === "list") {
      if (keepsPrivate || (!sourceChanged && hadList)) return initial.currentValue ?? null;
      return listPreview?.value ?? null;
    }
    if (measuredBy === "checkins" && !initial.kpiId && !hadList && initial.currentValue != null) return initial.currentValue;
    return numbersOk ? s : null;
  }, [measuredBy, kpiId, initial.kpiId, initial.currentValue, kpi, goal.kpiMonths, combines, combine, numbersOk, s, keepsPrivate, sourceChanged, hadList, listPreview]);

  const listValid = measuredBy !== "list" || keepsPrivate || !!chosen;
  const valid = title.trim() !== "" && numbersOk && !notYet && !weeklyKpi && listValid && (measuredBy !== "kpi" || Boolean(kpiId));
  const unitWord = unit.trim();
  const periodWord = goal.periodWord ?? "So far";
  const previewLine = !numbersOk
    ? "Type a start and a target to see the preview."
    : measuredBy === "list" && !keepsPrivate && !chosen
      ? "Choose where to count from to see the preview."
      : previewValue == null
        ? `${goal.periodWord ? `${goal.periodWord}: ` : ""}no number yet. The target reads ${num(s)} until one arrives.`
        : `${goal.periodWord ? `${periodWord} so far` : "So far"}: ${num(previewValue)} of ${num(t)}${unitWord ? ` ${unitWord}` : ""}`;
  const pct = numbersOk && previewValue != null ? previewPercent(s, t, previewValue) : 0;

  // Unsaved edits ask before they go, as the goal modal does (step 3 review L6).
  const dirty = title !== initial.title || start !== String(initial.startValue) || target !== String(initial.targetValue)
    || unit !== (initial.unit ?? "") || measuredBy !== initialMeasure || kpiId !== initial.kpiId
    || combine !== (initial.combine ?? "LATEST") || periodStartTouched !== (initial.periodStart === "START" || initial.periodStart === "LAST")
    || replacing || (measuredBy === "list" && sourceChanged);
  async function tryClose() {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({ title: "Discard your changes?", description: "What you changed on this target is not saved.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onClose();
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const body = targetEditorPayload({
      title, startValue: s, targetValue: t, unit, measuredBy, kpiId, combine,
      periodStart, repeat: goal.repeat, hadSource: initial.combine != null || hadList,
      listSource: measuredBy === "list" && !keepsPrivate && (sourceChanged || !hadList) ? chosen : null,
    });
    try {
      const res = await fetch(isEdit ? `/api/okrs/${goal.okrId}/key-results/${initial.id}` : `/api/okrs/${goal.okrId}/key-results`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d?.error === "string" ? d.error : "Couldn't save the target");
        return;
      }
      toast(isEdit ? "Target saved" : "Target added");
      onSaved?.();
      onClose();
      router.refresh();
    } catch {
      setError("Couldn't save the target. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const field = "h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-[var(--os-focus)]";
  const kpiSections = [{ options: (kpis ?? []).map((k) => ({ value: k.id, label: k.name, description: k.kra?.name ?? undefined })) }];

  // The List rows' choices: number and Date fields need chosen Lists, as a
  // dashboard card's Sum does.
  const listsChosen = draft.where.kind === "lists";
  const numbers = listsChosen ? goalNumberFields(facts.fields) : [];
  const dates = listsChosen ? facts.fields.filter((f) => GOAL_DATE_TYPES.has(String(f.type))) : [];
  const metricField = draft.metric.op === "count" ? null : numbers.find((f) => f.key === (draft.metric as { fieldKey: string }).fieldKey);
  const metricLabel = draft.metric.op === "count"
    ? "Count of tasks"
    : `${draft.metric.op === "sum" ? "Sum of" : "Average of"} ${metricField?.label ?? "a number field"}`;
  const dateField = draft.countedBy === "field" ? dates.find((f) => f.key === draft.dateFieldKey) : undefined;
  const countedLabel = draft.countedBy === "field" ? dateField?.label ?? "A Date field" : COUNTED_BY_LABEL[draft.countedBy];
  const setWhere = (where: WidgetSource) => setDraft((d) => {
    // A field picked for other Lists may not be theirs: they start again from Count, Done date.
    const keepFields = where.kind === "lists";
    return { ...d, where, ...(keepFields ? {} : { metric: { op: "count" }, ...(d.countedBy === "field" ? { countedBy: "done" as const, dateFieldKey: null } : {}) }) };
  });
  const listPaused = measuredBy === "list" && !replacing && !sourceChanged ? initial.paused ?? null : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) void tryClose(); }}>
      <DialogContent className="max-w-[860px] gap-0 p-0 outline-none" onInteractOutside={(e) => e.preventDefault()}>
        <div className="flex h-12 items-center gap-2 border-b border-line px-5 pe-12">
          <DialogTitle className="text-base">{isEdit ? "Edit target" : "New target"}</DialogTitle>
          <DialogDescription className="sr-only">A target&apos;s name, numbers and what measures it</DialogDescription>
        </div>

        <div className="flex min-h-0 flex-col md:flex-row">
          {/* Preview */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 bg-subtle p-5">
            <span className="text-xs font-medium text-ink-2">Preview</span>
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4">
              {/* One 36px row as the Targets card draws it; below sm the
                  numbers go under the name so the name is never cut. */}
              <div className="os-row flex min-w-0 flex-col gap-1 sm:h-9 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 truncate text-row text-ink sm:flex-1">{title.trim() || "Untitled target"}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-sm tabular-nums text-ink-2">
                    {numbersOk ? `${num(previewValue ?? s)} of ${num(t)}${unitWord ? ` ${unitWord}` : ""}` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="h-1 w-[72px] overflow-hidden rounded-full bg-active" aria-hidden>
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-9 text-end text-sm tabular-nums text-ink">{pct}%</span>
                  </span>
                </span>
              </div>
              {/* A table says why in the settings column, once. */}
              {notYet ? null : <p className="m-0 text-sm tabular-nums text-ink-2" aria-live="polite">{previewLine}</p>}
              {measuredBy === "kpi" && kpiName ? (
                <p className="m-0 text-sm text-ink-2">From KPI {kpiName}: the owner&apos;s records{goal.repeat ? ` for ${goal.periodWord?.toLowerCase() ?? "this period"}` : ", the latest one"}. It takes no check-ins.</p>
              ) : null}
              {measuredBy === "list" && !keepsPrivate && chosen ? (
                <p className="m-0 text-sm text-ink-2">Counted {chosen.countedBy === "now" ? "as it stands right now" : `by ${countedLabel.toLowerCase()}`}{goal.repeat && chosen.countedBy !== "now" ? `, ${goal.periodWord?.toLowerCase() ?? "this period"}` : ""}. It takes no check-ins.</p>
              ) : null}
              {measuredBy === "list" && listPreview?.paused && sourceChanged ? (
                <p role="status" className="m-0 text-sm text-danger-text">{listPreview.paused}</p>
              ) : null}
            </section>
            {measuredBy === "list" && listPreview && !listPreview.open && !listPreview.paused ? (
              <p className="m-0 flex items-start gap-2 text-sm text-ink-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                {AUDIENCE_LINE}
              </p>
            ) : null}
          </div>

          {/* Settings */}
          <div className="flex w-full shrink-0 flex-col gap-3 border-t border-line p-5 md:max-h-[70vh] md:w-[340px] md:overflow-y-auto md:border-s md:border-t-0">
            <SettingsRow label="Name">
              <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} aria-label="Name" placeholder="Name this target" className={field} autoFocus={!isEdit} />
            </SettingsRow>

            <SettingsRow label="Measured by" stacked>
              <SegmentedControl label="Measured by" size="sm" value={measuredBy} options={MEASURED_OPTIONS} onChange={setMeasuredBy} />
            </SettingsRow>

            {notYet ? (
              <>
                <p className="m-0 flex items-start gap-2 rounded-md bg-subtle px-2.5 py-2 text-xs text-ink-2">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                  {NOT_YET}
                </p>
                <SettingsRow label="Where">
                  <PickerButton label="Choose a table" sections={[]} onSelect={() => {}} ariaLabel="Where" disabled />
                </SettingsRow>
                <SettingsRow label="What">
                  <PickerButton label="Count of rows" sections={[]} onSelect={() => {}} ariaLabel="What" disabled />
                </SettingsRow>
                <SettingsRow label="Counted by">
                  <PickerButton label="A Date column" sections={[]} onSelect={() => {}} ariaLabel="Counted by" disabled />
                </SettingsRow>
              </>
            ) : null}

            {keepsPrivate ? (
              <div className="flex flex-col gap-2 rounded-md bg-subtle px-2.5 py-2">
                <p className="m-0 text-sm text-ink">{PRIVATE_LIST_WORDS}</p>
                <p className="m-0 text-xs text-ink-2">
                  {initial.privateSource?.connectorName ? `Connected by ${initial.privateSource.connectorName}. ` : ""}You can&apos;t open it, so its settings stay hidden. You can replace it with a source you can open.
                </p>
                {initial.paused ? <p className="m-0 text-xs text-ink-2">Paused: {initial.paused}</p> : null}
                <span>
                  <button type="button" onClick={() => { setReplacing(true); setDraft(emptyListDraft()); }} className="inline-flex h-7 items-center rounded-md border border-line-strong bg-raised px-2 text-sm font-medium text-ink hover:bg-hover">
                    Replace source
                  </button>
                </span>
              </div>
            ) : null}

            {measuredBy === "list" && !keepsPrivate ? (
              <>
                {/* Paused (C10): its reason; Reconnect is in the target's row menu,
                    and a changed source counts as the person saving it. */}
                {listPaused ? (
                  <p className="m-0 flex items-start gap-2 rounded-md bg-subtle px-2.5 py-2 text-sm text-ink">
                    <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                    <span>Paused. {listPaused}</span>
                  </p>
                ) : null}
                <WidgetSourcePicker surface="goal" source={draft.where} onChange={setWhere} />
                <SettingsRow
                  label="What"
                  hint={!listsChosen ? "Add up a number field by choosing Lists." : numbers.length === 0 && facts.ready && listIds.length > 0 ? "None of the chosen Lists has a number field." : undefined}
                >
                  <PickerButton
                    ariaLabel={`What, ${metricLabel}`}
                    label={metricLabel}
                    value={draft.metric.op === "count" ? "count" : `${draft.metric.op}:${(draft.metric as { fieldKey: string }).fieldKey}`}
                    width={280}
                    sections={[
                      { options: [{ value: "count", label: "Count of tasks" }] },
                      ...(numbers.length ? [
                        { label: "Sum of", options: numbers.map((f) => ({ value: `sum:${f.key}`, label: f.label })) },
                        { label: "Average of", options: numbers.map((f) => ({ value: `average:${f.key}`, label: f.label })) },
                      ] : []),
                    ]}
                    onSelect={(v) => setDraft((d) => ({
                      ...d,
                      metric: v === "count" ? { op: "count" } : { op: v.startsWith("sum:") ? "sum" : "average", fieldKey: v.slice(v.indexOf(":") + 1) },
                    }))}
                  />
                </SettingsRow>
                <SettingsRow label="Counted by" hint={draft.countedBy === "now" ? "Its number stands for the period when the period ends." : undefined}>
                  <PickerButton
                    ariaLabel={`Counted by, ${countedLabel}`}
                    label={countedLabel}
                    value={draft.countedBy === "field" ? `field:${draft.dateFieldKey ?? ""}` : draft.countedBy}
                    width={260}
                    sections={[
                      { options: (["done", "created", "due"] as const).map((c) => ({ value: c, label: COUNTED_BY_LABEL[c] })) },
                      ...(dates.length ? [{ label: "A Date field", options: dates.map((f) => ({ value: `field:${f.key}`, label: f.label })) }] : []),
                      { options: [{ value: "now", label: COUNTED_BY_LABEL.now }] },
                    ]}
                    onSelect={(v) => setDraft((d) => (v.startsWith("field:")
                      ? { ...d, countedBy: "field", dateFieldKey: v.slice(6) }
                      : { ...d, countedBy: v as ListCountedBy, dateFieldKey: null }))}
                  />
                </SettingsRow>
                <SettingsRow label="Which tasks" stacked>
                  <WidgetFilterEditor
                    filter={draft.filter}
                    onChange={(filter) => setDraft((d) => ({ ...d, filter }))}
                    listsSource={listsChosen}
                    fields={facts.fields}
                    statuses={facts.statuses}
                    hideCompletedToggle={draft.countedBy !== "done"}
                  />
                </SettingsRow>
              </>
            ) : null}

            {measuredBy === "kpi" ? (
              <>
                <SettingsRow label="KPI">
                  <PickerButton
                    label={kpiName ?? "Choose a KPI"}
                    value={kpiId}
                    sections={kpiSections}
                    loading={kpis === null}
                    emptyLabel="No KPIs in this workspace yet"
                    searchPlaceholder="Search KPIs"
                    ariaLabel={`KPI, ${kpiName ?? "none chosen"}`}
                    width={280}
                    onSelect={(v) => {
                      setKpiId(v);
                      const k = kpis?.find((x) => x.id === v);
                      if (k?.unit && !unit.trim()) setUnit(k.unit);
                    }}
                  />
                </SettingsRow>
                {combines ? (
                  <SettingsRow label="Months" hint="A quarter or a year holds several KPI months.">
                    <PickerButton
                      label={COMBINE_LABEL[combine]}
                      value={combine}
                      sections={[{ options: (Object.keys(COMBINE_LABEL) as KpiCombineChoice[]).map((c) => ({ value: c, label: COMBINE_LABEL[c] })) }]}
                      ariaLabel={`Months, ${COMBINE_LABEL[combine]}`}
                      onSelect={(v) => setCombine(v as KpiCombineChoice)}
                    />
                  </SettingsRow>
                ) : null}
                {weeklyKpi ? <p role="alert" className="m-0 text-sm text-danger-text">{KPI_WEEKLY}</p> : null}
              </>
            ) : null}

            <SettingsRow label="Start">
              <input type="number" step="any" inputMode="decimal" value={start} onChange={(e) => { setStart(e.target.value); if (!periodStartTouched) setPeriodStart(defaultPeriodStart(Number(e.target.value), t)); }} aria-label="Start" className={`${field} tabular-nums`} />
            </SettingsRow>
            <SettingsRow label="Target">
              <input type="number" step="any" inputMode="decimal" value={target} onChange={(e) => { setTarget(e.target.value); if (!periodStartTouched) setPeriodStart(defaultPeriodStart(s, Number(e.target.value))); }} aria-label="Target" className={`${field} tabular-nums`} />
            </SettingsRow>
            <SettingsRow label="Unit">
              <input value={unit} maxLength={32} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" placeholder="demos, %, bugs" className={field} />
            </SettingsRow>

            {goal.repeat && measuredBy === "checkins" ? (
              <SettingsRow label="Each period starts at" stacked>
                <SegmentedControl
                  label="Each period starts at"
                  size="sm"
                  value={periodStart}
                  onChange={(v) => { setPeriodStart(v); setPeriodStartTouched(true); }}
                  options={[{ value: "START", label: "Start value" }, { value: "LAST", label: "Last period's number" }]}
                />
              </SettingsRow>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-14 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-2.5">
          {error ? <p role="alert" className="m-0 me-auto min-w-0 flex-1 text-sm text-danger-text">{error}</p> : null}
          <button
            type="button"
            onClick={() => void tryClose()}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:text-ink-4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4"
          >
            {saving ? "Saving" : error ? "Retry" : isEdit ? "Save" : "Add target"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
