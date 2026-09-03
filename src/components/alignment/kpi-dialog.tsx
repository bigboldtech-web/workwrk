"use client";

// KpiDialog — create or edit a KPI gauge under a KRA.
//
// A KPI is a permanent running gauge: no deadline, no per-person numbers
// here (people record readings against it). The healthy line (target) is
// NULLABLE on purpose — leave it blank until a baseline exists and the
// gauge reads "no baseline yet". Never invent a number.
//
//   POST  /api/kpis  { kraId, name, unit, direction, targetValue, … }
//   PATCH /api/kpis  { id, … }

import { useEffect, useState } from "react";
import { Gauge, Loader2, Star, TrendingUp, TrendingDown, MoveRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export type KpiDirectionValue = "HIGHER" | "LOWER" | "MAINTAIN";
export type KpiTypeValue = "QUANTITATIVE" | "QUALITATIVE";
export type KpiFrequencyValue = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY";

export type KpiDialogKpi = {
  id: string;
  name: string;
  description?: string | null;
  unit?: string | null;
  // Loose string so any caller shape (e.g. the role bundle's KPI, typed
  // `string`) assigns; the dialog whitelist-coerces on hydration.
  type?: string | null;
  frequency?: string | null;
  formula?: string | null;
  direction?: KpiDirectionValue | null;
  lowerIsBetter?: boolean;
  targetValue?: number | null;
  baselineValue?: number | null;
  ownership?: string;
  isNorthStar?: boolean;
};

const DIRECTIONS: { value: KpiDirectionValue; label: string; icon: typeof TrendingUp }[] = [
  { value: "HIGHER", label: "Higher is better", icon: TrendingUp },
  { value: "LOWER", label: "Lower is better", icon: TrendingDown },
  { value: "MAINTAIN", label: "Hold the line", icon: MoveRight },
];

const KPI_TYPES: { value: KpiTypeValue; label: string }[] = [
  { value: "QUANTITATIVE", label: "Quantitative" },
  { value: "QUALITATIVE", label: "Qualitative" },
];

const FREQUENCIES: { value: KpiFrequencyValue; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUALLY", label: "Annually" },
];

export function KpiDialog({
  open,
  onOpenChange,
  kraId,
  kraName,
  kpi,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The KRA this gauge lives under (create mode). */
  kraId: string;
  kraName: string;
  /** When set, the dialog edits this KPI instead of creating one. */
  kpi?: KpiDialogKpi | null;
  onSaved: (msg: string) => void;
}) {
  const editing = Boolean(kpi);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [kpiType, setKpiType] = useState<KpiTypeValue>("QUANTITATIVE");
  const [frequency, setFrequency] = useState<KpiFrequencyValue>("MONTHLY");
  const [formula, setFormula] = useState("");
  const [direction, setDirection] = useState<KpiDirectionValue>("HIGHER");
  const [target, setTarget] = useState("");
  const [baseline, setBaseline] = useState("");
  const [shared, setShared] = useState(false);
  const [northStar, setNorthStar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(kpi?.name ?? "");
    setDescription(kpi?.description ?? "");
    setUnit(kpi?.unit ?? "");
    setKpiType(kpi?.type === "QUALITATIVE" ? "QUALITATIVE" : "QUANTITATIVE");
    setFrequency(
      FREQUENCIES.some((f) => f.value === kpi?.frequency)
        ? (kpi!.frequency as KpiFrequencyValue)
        : "MONTHLY",
    );
    setFormula(kpi?.formula ?? "");
    setDirection(kpi?.direction ?? (kpi?.lowerIsBetter ? "LOWER" : "HIGHER"));
    setTarget(kpi?.targetValue != null ? String(kpi.targetValue) : "");
    setBaseline(kpi?.baselineValue != null ? String(kpi.baselineValue) : "");
    setShared(kpi?.ownership === "SHARED");
    setNorthStar(kpi?.isNorthStar === true);
    setError(null);
  }, [open, kpi]);

  const parseNum = (raw: string): number | null | undefined => {
    const t = raw.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined; // undefined = invalid
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give the KPI a name."); return; }
    const targetValue = parseNum(target);
    const baselineValue = parseNum(baseline);
    if (targetValue === undefined) { setError("Healthy line must be a number, or blank."); return; }
    if (baselineValue === undefined) { setError("Baseline must be a number, or blank."); return; }
    setBusy(true);
    setError(null);
    const payload = {
      name: trimmed,
      description: description.trim() || null,
      unit: unit.trim() || null,
      type: kpiType,
      frequency,
      formula: formula.trim() || null,
      direction,
      targetValue,
      baselineValue,
      ownership: shared ? "SHARED" : "OWNED",
      isNorthStar: northStar,
    };
    try {
      const res = await fetch("/api/kpis", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: kpi!.id, ...payload } : { kraId, ...payload }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(
          res.status === 403
            ? "You don't have permission to manage KPIs."
            : (d?.error ?? "Couldn't save the KPI."),
        );
        return;
      }
      onSaved(editing ? "KPI updated" : "KPI created");
      onOpenChange(false);
    } catch {
      setError("Couldn't save the KPI.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-0 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0073EA]/10">
            <Gauge size={15} className="text-[#0073EA]" />
          </span>
          <DialogTitle className="leading-none">{editing ? "Edit KPI" : "New KPI"}</DialogTitle>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          A running gauge under <span className="font-medium text-zinc-700 dark:text-zinc-300">{kraName}</span>.
          Every holder of the job title records their own readings against it.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[13px] font-medium text-zinc-600">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="e.g. Qualified demos booked"
              autoFocus
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] focus:outline-none focus:border-[#0073EA]"
            />
          </label>

          <div className="block">
            <span className="text-[13px] font-medium text-zinc-600">Direction of good</span>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {DIRECTIONS.map((d) => {
                const ActiveIcon = d.icon;
                const active = direction === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDirection(d.value)}
                    className={`inline-flex items-center justify-center gap-1.5 h-8 rounded-md border text-[13px] font-medium transition-colors ${
                      active
                        ? "border-[#0073EA] bg-[#0073EA]/10 text-[#0073EA]"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    <ActiveIcon className="w-3.5 h-3.5" />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="block">
              <span className="text-[13px] font-medium text-zinc-600">Measurement</span>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {KPI_TYPES.map((t) => {
                  const active = kpiType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setKpiType(t.value)}
                      className={`inline-flex items-center justify-center h-9 rounded-md border text-[13px] font-medium transition-colors ${
                        active
                          ? "border-[#0073EA] bg-[#0073EA]/10 text-[#0073EA]"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <span className="text-[13px] font-medium text-zinc-600">Recorded</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as KpiFrequencyValue)}
                className="mt-1 w-full h-9 px-2 rounded-md border border-zinc-200 bg-white text-[14px] focus:outline-none focus:border-[#0073EA]"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
          </div>
          {kpiType === "QUALITATIVE" ? (
            <p className="text-[12.5px] text-zinc-400 -mt-1">
              Qualitative gauges are scored against a 1&ndash;{5} rubric rating, so a
              reading always yields a score even without a numeric target.
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2.5">
            <label className="block">
              <span className="text-[13px] font-medium text-zinc-600">Healthy line</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="decimal"
                placeholder="blank = none yet"
                className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] font-mono focus:outline-none focus:border-[#0073EA]"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-zinc-600">Baseline today</span>
              <input
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] font-mono focus:outline-none focus:border-[#0073EA]"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-zinc-600">Unit</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="%, ₹, deals…"
                className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] focus:outline-none focus:border-[#0073EA]"
              />
            </label>
          </div>
          <p className="text-[12.5px] text-zinc-400 -mt-1">
            Leave the healthy line blank until you have a baseline — the gauge
            reads &ldquo;no baseline yet&rdquo; instead of a made-up number.
          </p>

          <label className="block">
            <span className="text-[13px] font-medium text-zinc-600">
              Formula <span className="text-zinc-400 font-normal">(optional)</span>
            </span>
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="e.g. closed_won / total_leads · 100"
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[14px] font-mono focus:outline-none focus:border-[#0073EA]"
            />
            <span className="mt-1 block text-[12.5px] text-zinc-400">How the number is derived — a reference for whoever records it.</span>
          </label>

          <label className="block">
            <span className="text-[13px] font-medium text-zinc-600">
              Definition <span className="text-zinc-400 font-normal">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What exactly is counted, and where does the number come from?"
              className="mt-1 w-full px-2.5 py-2 rounded-md border border-zinc-200 text-[14px] resize-none focus:outline-none focus:border-[#0073EA]"
            />
          </label>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-zinc-800 dark:text-zinc-200">Shared gauge</div>
              <div className="text-[12.5px] text-zinc-400">Influenced by this role · reviewed, not graded</div>
            </div>
            <Switch checked={shared} onChange={setShared} aria-label="Shared gauge" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-amber-400" style={{ fill: "currentColor" }} />
                North-star gauge
              </div>
              <div className="text-[12.5px] text-zinc-400">The headline number for this KRA — shown first</div>
            </div>
            <Switch checked={northStar} onChange={setNorthStar} aria-label="North-star gauge" />
          </div>

          {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {editing ? "Save changes" : "Create KPI"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
