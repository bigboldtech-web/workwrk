"use client";

// NewReviewCycleDialog — replaces the window.prompt() create flow.
// Captures name + type, and auto-fills the period dates from the chosen
// cadence (monthly → this month, quarterly → this quarter, annual → this
// year). Dates stay editable. POSTs /api/reviews.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Award, Loader2 } from "lucide-react";

type ReviewType = "MONTHLY_PULSE" | "QUARTERLY" | "ANNUAL" | "PROBATION" | "PIP_REVIEW";

const TYPE_OPTIONS: Array<{ value: ReviewType; label: string; hint: string }> = [
  { value: "MONTHLY_PULSE", label: "Monthly pulse", hint: "Lightweight monthly KPI + SOP check" },
  { value: "QUARTERLY", label: "Quarterly", hint: "OKR scoring + KRA/KPI rollup + rating" },
  { value: "ANNUAL", label: "Annual appraisal", hint: "Self + peer + calibration + 9-box" },
  { value: "PROBATION", label: "Probation", hint: "New-hire probation review" },
  { value: "PIP_REVIEW", label: "PIP", hint: "Performance-improvement plan" },
];

/** YYYY-MM-DD for an <input type=date>. */
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Period [start,end] implied by a cadence type, anchored on `now`. */
function periodFor(type: ReviewType, now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (type === "MONTHLY_PULSE") {
    return { start: isoDate(new Date(Date.UTC(y, m, 1))), end: isoDate(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (type === "QUARTERLY") {
    const q0 = Math.floor(m / 3) * 3;
    return { start: isoDate(new Date(Date.UTC(y, q0, 1))), end: isoDate(new Date(Date.UTC(y, q0 + 3, 0))) };
  }
  if (type === "ANNUAL") {
    return { start: isoDate(new Date(Date.UTC(y, 0, 1))), end: isoDate(new Date(Date.UTC(y, 11, 31))) };
  }
  // PROBATION / PIP — default to a 30-day window from today.
  return { start: isoDate(now), end: isoDate(new Date(now.getTime() + 30 * 86_400_000)) };
}

/** A sensible default name for the cadence + period. */
function defaultName(type: ReviewType, now: Date): string {
  const y = now.getUTCFullYear();
  if (type === "MONTHLY_PULSE") return `${now.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y} pulse`;
  if (type === "QUARTERLY") return `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${y} review`;
  if (type === "ANNUAL") return `${y} annual appraisal`;
  if (type === "PROBATION") return "Probation review";
  return "Performance improvement plan";
}

export function NewReviewCycleDialog({
  open,
  onOpenChange,
  /** Today (passed from the page so the dialog stays render-pure). */
  now,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  now: Date;
  onCreated: (msg: string) => void;
}) {
  const [type, setType] = useState<ReviewType>("QUARTERLY");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const period = useMemo(() => periodFor(type, now), [type, now]);

  // When the dialog opens or the type changes, re-seed name + dates
  // (unless the user has hand-edited the name).
  useEffect(() => {
    if (!open) return;
    setStart(period.start);
    setEnd(period.end);
    if (!touchedName) setName(defaultName(type, now));
  }, [open, type, period.start, period.end, touchedName, now]);

  useEffect(() => {
    if (open) {
      setTouchedName(false);
      setError(null);
      const t = setTimeout(() => nameRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give the cycle a name."); return; }
    if (new Date(start) > new Date(end)) { setError("Start date must be before end date."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          type,
          startDate: new Date(`${start}T00:00:00Z`).toISOString(),
          endDate: new Date(`${end}T23:59:59Z`).toISOString(),
        }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "Only HR can create review cycles." : "Couldn't create the cycle.");
        setBusy(false);
        return;
      }
      onCreated("Cycle created");
      onOpenChange(false);
    } catch {
      setError("Couldn't create the cycle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="New review cycle" className="relative w-full max-w-md rounded-xl bg-white shadow-xl border border-zinc-200">
        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-100">
          <span className="grid place-items-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600">
            <Award className="w-4 h-4" />
          </span>
          <h2 className="text-[14px] font-semibold text-zinc-900 flex-1">New review cycle</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="w-7 h-7 grid place-items-center rounded-md text-zinc-400 hover:bg-zinc-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-3">
          <div>
            <span className="text-[12px] font-medium text-zinc-600">Type</span>
            <div className="mt-1 grid grid-cols-1 gap-1.5">
              {TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setType(o.value)}
                  className={`flex items-center justify-between text-left px-2.5 py-1.5 rounded-md border text-[12.5px] ${
                    type === o.value ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <span className="font-medium text-zinc-800">{o.label}</span>
                  <span className="text-[11px] text-zinc-400 truncate ml-2">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setTouchedName(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[13px] focus:outline-none focus:border-zinc-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-600">Starts</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[12.5px]" />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-600">Ends</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[12.5px]" />
            </label>
          </div>

          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-100">
          <button type="button" onClick={() => onOpenChange(false)} className="h-8 px-3 rounded-md text-[12.5px] text-zinc-600 hover:bg-zinc-100">Cancel</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-zinc-900 text-white text-[12.5px] font-medium disabled:opacity-40 hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Create cycle
          </button>
        </footer>
      </div>
    </div>
  );
}
