"use client";

// WeeklyReviewForm — client-side editor for a single weekly review.
// Owns local state (debounced auto-save would be nice but Phase 5a
// uses an explicit Save Draft button to keep things obvious).
//
// Three save modes:
//   - Save draft (PATCH with action="save")
//   - Submit for review (PATCH with action="submit")
//   - Reopen after submit (PATCH with action="reopen")

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Save, Undo2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { KpiSnapshot, KraProgressEntry, WeeklyReviewDoc } from "@/lib/weekly-review";

interface KraOption {
  id: string;
  name: string;
  category: string | null;
  weightage: number;
  kpis: Array<{ id: string; name: string; unit: string | null; frequency: string; targetValue: number | null; lowerIsBetter: boolean }>;
}

interface FormProps {
  initialReview: WeeklyReviewDoc;
  kras: KraOption[];
}

function bucketProgress(kraProgress: KraProgressEntry[]): Record<string, KraProgressEntry> {
  return Object.fromEntries(kraProgress.map((k) => [k.kraId, k] as const));
}
function bucketKpis(kpiSnapshots: KpiSnapshot[]): Record<string, KpiSnapshot> {
  return Object.fromEntries(kpiSnapshots.map((k) => [k.kpiId, k] as const));
}

export function WeeklyReviewForm({ initialReview, kras }: FormProps) {
  const router = useRouter();
  const [review, setReview] = useState<WeeklyReviewDoc>(initialReview);
  const [kraDraft, setKraDraft] = useState<Record<string, KraProgressEntry>>(bucketProgress(initialReview.kraProgress));
  const [kpiDraft, setKpiDraft] = useState<Record<string, KpiSnapshot>>(bucketKpis(initialReview.kpiSnapshots));
  const [highlights, setHighlights] = useState(initialReview.highlights ?? "");
  const [blockers, setBlockers] = useState(initialReview.blockers ?? "");
  const [plan, setPlan] = useState(initialReview.plan ?? "");
  const [busy, setBusy] = useState<null | "save" | "submit" | "reopen">(null);
  const [error, setError] = useState<string | null>(null);

  const readOnly = review.status === "SUBMITTED" || review.status === "ACKNOWLEDGED";

  const submitPatch = async (action: "save" | "submit" | "reopen") => {
    setBusy(action);
    setError(null);
    try {
      const body = {
        kpiSnapshots: Object.values(kpiDraft),
        kraProgress: Object.values(kraDraft),
        highlights: highlights.trim() || null,
        blockers: blockers.trim() || null,
        plan: plan.trim() || null,
        action,
      };
      const res = await fetch(`/api/me/weekly-review/${review.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save");
        return;
      }
      setReview(data.review as WeeklyReviewDoc);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <StatusBanner review={review} />

      {/* KRA progress */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">KRA progress</h2>
        {kras.length === 0 ? (
          <div className="text-sm text-zinc-500 px-4 py-3 border border-zinc-200 rounded-md bg-white">
            No active KRAs assigned to you. Add one from /kra-kpi to populate this section.
          </div>
        ) : (
          <ul className="space-y-2">
            {kras.map((k) => {
              const entry = kraDraft[k.id] ?? { kraId: k.id, progressPct: 0, note: "" };
              return (
                <li key={k.id} className="rounded-md border border-zinc-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium flex-1 truncate">{k.name}</span>
                    {k.category ? <span className="text-[10px] uppercase tracking-wide text-zinc-500">{k.category}</span> : null}
                    <span className="text-xs text-zinc-500">{entry.progressPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={entry.progressPct}
                    disabled={readOnly}
                    onChange={(e) =>
                      setKraDraft((d) => ({ ...d, [k.id]: { ...entry, progressPct: Number(e.target.value) } }))
                    }
                    className="w-full"
                  />
                  <input
                    type="text"
                    value={entry.note ?? ""}
                    disabled={readOnly}
                    placeholder="Note (optional)"
                    onChange={(e) =>
                      setKraDraft((d) => ({ ...d, [k.id]: { ...entry, note: e.target.value } }))
                    }
                    className="w-full mt-2 px-2 py-1 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:border-[var(--os-brand)] disabled:opacity-60"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* KPI snapshots */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">KPI snapshots</h2>
        {kras.flatMap((k) => k.kpis).length === 0 ? (
          <div className="text-sm text-zinc-500 px-4 py-3 border border-zinc-200 rounded-md bg-white">
            No KPIs under your active KRAs yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {kras.flatMap((k) =>
              k.kpis.map((kpi) => {
                const snap = kpiDraft[kpi.id] ?? { kpiId: kpi.id, value: null };
                return (
                  <li key={kpi.id} className="flex items-center gap-3 px-4 py-2 rounded-md border border-zinc-200 bg-white">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{kpi.name}</div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        Target {kpi.targetValue ?? "—"}{kpi.unit ? ` ${kpi.unit}` : ""} · {kpi.frequency.toLowerCase()}
                        {kpi.lowerIsBetter ? " · lower is better" : ""}
                      </div>
                    </div>
                    <input
                      type="number"
                      step="any"
                      value={snap.value ?? ""}
                      disabled={readOnly}
                      placeholder="—"
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = raw === "" ? null : Number(raw);
                        setKpiDraft((d) => ({ ...d, [kpi.id]: { ...snap, value: Number.isFinite(next as number) ? next : null } }));
                      }}
                      className="w-24 h-8 px-2 rounded-md border border-zinc-200 bg-white text-sm text-right focus:outline-none focus:border-[var(--os-brand)] disabled:opacity-60"
                    />
                  </li>
                );
              }),
            )}
          </ul>
        )}
      </section>

      {/* Narrative blocks */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NarrativeField
          label="Highlights"
          subtitle="What went well"
          value={highlights}
          onChange={setHighlights}
          disabled={readOnly}
        />
        <NarrativeField
          label="Blockers"
          subtitle="What's stuck or where you need help"
          value={blockers}
          onChange={setBlockers}
          disabled={readOnly}
        />
        <NarrativeField
          label="Plan for next week"
          subtitle="What you'll ship next"
          value={plan}
          onChange={setPlan}
          disabled={readOnly}
        />
      </section>

      {error ? <div className="text-xs text-red-500">{error}</div> : null}

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-200">
        {review.status === "DRAFT" ? (
          <>
            <button
              type="button"
              onClick={() => submitPatch("save")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => submitPatch("submit")}
              disabled={busy !== null}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {busy === "submit" ? "Submitting…" : "Submit for review"}
            </button>
          </>
        ) : null}
        {review.status === "SUBMITTED" ? (
          <button
            type="button"
            onClick={() => submitPatch("reopen")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Undo2 className="w-3.5 h-3.5" />
            {busy === "reopen" ? "Reopening…" : "Reopen to edit"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NarrativeField({
  label, subtitle, value, onChange, disabled,
}: {
  label: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-3">
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[11px] text-zinc-500 mb-2">{subtitle}</div>
      <textarea
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? "—" : "Type here…"}
        className="w-full text-sm bg-transparent outline-none resize-y disabled:opacity-60"
      />
    </div>
  );
}

function StatusBanner({ review }: { review: WeeklyReviewDoc }) {
  if (review.status === "DRAFT") {
    return (
      <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-zinc-500" />
        <span className="text-zinc-500">Draft — not yet submitted to your manager.</span>
      </div>
    );
  }
  if (review.status === "SUBMITTED") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-amber-700" />
        <span className="flex-1">Submitted — awaiting manager review.</span>
        {review.managerStatus === "PENDING" ? <span className="text-[11px] text-amber-700">Pending</span> : null}
      </div>
    );
  }
  // ACKNOWLEDGED
  const isApproved = review.managerStatus === "APPROVED";
  return (
    <div className={`rounded-md px-4 py-3 flex items-center gap-2 text-sm ${
      isApproved ? "border border-emerald-500/40 bg-emerald-500/10" : "border border-red-500/40 bg-red-500/10"
    }`}>
      {isApproved ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : <AlertCircle className="w-4 h-4 text-red-700" />}
      <div className="flex-1">
        <div className="font-medium">
          {isApproved ? "Approved by manager." : "Manager requested changes."}
        </div>
        {review.managerNotes ? (
          <div className="text-xs text-zinc-500 mt-0.5 whitespace-pre-wrap">{review.managerNotes}</div>
        ) : null}
      </div>
    </div>
  );
}
