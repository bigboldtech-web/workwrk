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
// MEASURED BY (C2): Check-ins (what people type) or A KPI (the owner's KPI
// records; a quarterly or yearly goal combines its months: Latest month, Sum
// of months, Average of months) work in this step. A List and A table show
// their rows so the layout is the finished one, and say they are not
// available yet; steps 4 and 5 wire them (the server refuses a List or
// table source until then). A weekly goal cannot read a KPI (C6), and the
// editor says so before the save, as the server would.
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
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PickerButton, SettingsRow } from "@/components/dashboards/widget-registry";
import type { GoalCadence } from "@/lib/goals/goal-period";

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
}

const MEASURED_OPTIONS: { value: MeasuredBy; label: string }[] = [
  { value: "checkins", label: "Check-ins" },
  { value: "list", label: "A List" },
  { value: "table", label: "A table" },
  { value: "kpi", label: "A KPI" },
];

const COMBINE_LABEL: Record<KpiCombineChoice, string> = { LATEST: "Latest month", SUM: "Sum of months", AVERAGE: "Average of months" };
const NOT_YET = "Counting a target from a List or a table is not available yet. Choose Check-ins or A KPI for now.";
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
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: f.title.trim(),
    startValue: f.startValue,
    targetValue: f.targetValue,
    unit: f.unit.trim() || null,
  };
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
  const [title, setTitle] = useState(initial.title);
  const [start, setStart] = useState(String(initial.startValue));
  const [target, setTarget] = useState(String(initial.targetValue));
  const [unit, setUnit] = useState(initial.unit ?? "");
  const [measuredBy, setMeasuredBy] = useState<MeasuredBy>(initial.kpiId ? "kpi" : "checkins");
  const [kpiId, setKpiId] = useState<string | null>(initial.kpiId);
  const [combine, setCombine] = useState<KpiCombineChoice>(initial.combine ?? "LATEST");
  const [periodStart, setPeriodStart] = useState<"START" | "LAST">(
    initial.periodStart === "START" || initial.periodStart === "LAST" ? initial.periodStart : defaultPeriodStart(initial.startValue, initial.targetValue),
  );
  const [periodStartTouched, setPeriodStartTouched] = useState(initial.periodStart === "START" || initial.periodStart === "LAST");
  const [kpis, setKpis] = useState<KpiOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const notYet = measuredBy === "list" || measuredBy === "table";
  const combines = goal.repeat === "QUARTERLY" || goal.repeat === "YEARLY";

  // The preview's number: this period's for a saved target measured the same
  // way, the owner's KPI months for a newly chosen KPI, else the start.
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
    if (measuredBy === "checkins" && !initial.kpiId && initial.currentValue != null) return initial.currentValue;
    return numbersOk ? s : null;
  }, [measuredBy, kpiId, initial.kpiId, initial.currentValue, kpi, goal.kpiMonths, combines, combine, numbersOk, s]);

  const valid = title.trim() !== "" && numbersOk && !notYet && !weeklyKpi && (measuredBy !== "kpi" || Boolean(kpiId));
  const unitWord = unit.trim();
  const periodWord = goal.periodWord ?? "So far";
  const previewLine = !numbersOk
    ? "Type a start and a target to see the preview."
    : previewValue == null
      ? `${goal.periodWord ? `${goal.periodWord}: ` : ""}no number yet. The target reads ${num(s)} until one arrives.`
      : `${goal.periodWord ? `${periodWord} so far` : "So far"}: ${num(previewValue)} of ${num(t)}${unitWord ? ` ${unitWord}` : ""}`;
  const pct = numbersOk && previewValue != null ? previewPercent(s, t, previewValue) : 0;

  // Unsaved edits ask before they go, as the goal modal does (step 3 review L6).
  const dirty = title !== initial.title || start !== String(initial.startValue) || target !== String(initial.targetValue)
    || unit !== (initial.unit ?? "") || measuredBy !== (initial.kpiId ? "kpi" : "checkins") || kpiId !== initial.kpiId
    || combine !== (initial.combine ?? "LATEST") || periodStartTouched !== (initial.periodStart === "START" || initial.periodStart === "LAST");
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
      periodStart, repeat: goal.repeat, hadSource: initial.combine != null,
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
              {/* A List or a table says why in the settings column, once. */}
              {notYet ? null : <p className="m-0 text-sm tabular-nums text-ink-2" aria-live="polite">{previewLine}</p>}
              {measuredBy === "kpi" && kpiName ? (
                <p className="m-0 text-sm text-ink-2">From KPI {kpiName}: the owner&apos;s records{goal.repeat ? ` for ${goal.periodWord?.toLowerCase() ?? "this period"}` : ", the latest one"}. It takes no check-ins.</p>
              ) : null}
            </section>
          </div>

          {/* Settings */}
          <div className="flex w-full shrink-0 flex-col gap-3 border-t border-line p-5 md:w-[340px] md:border-s md:border-t-0">
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
                  <PickerButton label={measuredBy === "list" ? "Choose Lists" : "Choose a table"} sections={[]} onSelect={() => {}} ariaLabel="Where" disabled />
                </SettingsRow>
                <SettingsRow label="What">
                  <PickerButton label={measuredBy === "list" ? "Count of tasks" : "Count of rows"} sections={[]} onSelect={() => {}} ariaLabel="What" disabled />
                </SettingsRow>
                <SettingsRow label="Counted by">
                  <PickerButton label={measuredBy === "list" ? "Done date" : "A Date column"} sections={[]} onSelect={() => {}} ariaLabel="Counted by" disabled />
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
