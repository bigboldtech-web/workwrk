"use client";

// OkrCheckInModal — ClickUp-style target check-in dialog (Mobbin ref
// 5bbde02d-26f6-45ba-9fa5-c90651de8449). Replaces the old inline
// okr-checkin-form on the goal detail Targets card. Layout mirrors
// ClickUp: target title header, progress bar, Start / Current / Target
// caption row (Current boxed), a Decrease|Increase toggle that signs the
// entered delta against the current value, value input (native spinners
// hidden), optional Note, "Save update" on brand blue.
//
// Mechanics unchanged: POST /api/okrs/[id]/check-in with
// { keyResultId, value, note } where value is the absolute NEW value
// (current ± delta). Direction-aware progress math stays server-side
// (inferKeyResultDirection). A KPI-linked target is measured BY its
// gauge: the server refuses hand check-ins with 409, so the modal shows
// that copy up front for derived targets and renders any 409 response
// in the same amber notice.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useOsToast } from "@/components/layout/os/toast";
import type { TargetRowData } from "./goal-targets";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Amber notice shared by the derived-target hint and the 409 response. */
function KpiNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      {children}
    </div>
  );
}

export function OkrCheckInModal({ okrId, target, canEdit, onClose }: {
  okrId: string;
  target: TargetRowData;
  /** canEditOkrOwner — the same gate the check-in route enforces. */
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [mode, setMode] = useState<"increase" | "decrease">("increase");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: "kpi" | "plain"; text: string } | null>(null);

  const unit = target.unit?.trim() ?? "";
  const pct = Math.max(0, Math.min(100, target.progress));
  const delta = Number(amount);
  const hasDelta = amount.trim() !== "" && !Number.isNaN(delta);
  const next = hasDelta
    ? (mode === "increase" ? target.currentValue + delta : target.currentValue - delta)
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next == null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/okrs/${okrId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Payload shape is the API contract: absolute new value, not the delta.
        body: JSON.stringify({ keyResultId: target.id, value: next, note: note.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError({
          kind: res.status === 409 ? "kpi" : "plain",
          text: typeof data?.error === "string" ? data.error : "Check-in failed",
        });
        return;
      }
      toast("Check-in saved");
      onClose();
      router.refresh();
    } catch {
      setError({ kind: "plain", text: "Check-in failed" });
    } finally {
      setSaving(false);
    }
  }

  const segBtn = (active: boolean) =>
    `h-7 rounded-md text-[12px] font-semibold transition-colors ${
      active
        ? "bg-[#0073EA] text-white"
        : "bg-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
    }`;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="block max-w-[440px] gap-0 p-0">
        {/* ── Header: title + progress + Start / Current / Target ── */}
        <div className="px-6 pb-4 pt-6 text-center">
          <DialogTitle className="px-6 text-[15px] font-semibold leading-snug">
            {target.title}
          </DialogTitle>

          <div className="mt-4" aria-hidden>
            <div className="mb-1.5 text-[11px] font-semibold tabular-nums text-zinc-500">{pct}%</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-[#0073EA] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-zinc-500">
            <span>
              Start: <strong className="font-semibold text-zinc-700">{fmtNum(target.startValue)}{unit}</strong>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 dark:border-zinc-700">
              Current: <strong className="font-semibold tabular-nums text-zinc-700">
                {fmtNum(next ?? target.currentValue)}{unit}
              </strong>
            </span>
            <span>
              Target: <strong className="font-semibold text-zinc-700">{fmtNum(target.targetValue)}{unit}</strong>
            </span>
          </div>
        </div>

        {target.isDerived ? (
          /* Measured by a KPI gauge: mirror the 409 the server would send. */
          <div className="border-t border-zinc-100 px-6 py-5">
            <KpiNotice>
              This target is measured by the KPI{" "}
              <strong className="font-semibold">{target.kpiName ?? "linked to it"}</strong>.
              Record the KPI reading instead of checking in here; the number lands automatically.
            </KpiNotice>
          </div>
        ) : !canEdit ? (
          <div className="border-t border-zinc-100 px-6 py-5">
            <p className="text-center text-[12.5px] leading-relaxed text-zinc-500">
              Only the goal&apos;s owner or their manager can check in on this target.
            </p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="border-t border-zinc-100 px-6 py-5">
              {/* Decrease | Increase signs the delta against the current value. */}
              <div
                className="mx-auto mb-4 grid w-[248px] grid-cols-2 gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
                role="group"
                aria-label="Direction of change"
              >
                <button
                  type="button"
                  className={segBtn(mode === "decrease")}
                  aria-pressed={mode === "decrease"}
                  onClick={() => setMode("decrease")}
                >
                  Decrease
                </button>
                <button
                  type="button"
                  className={segBtn(mode === "increase")}
                  aria-pressed={mode === "increase"}
                  onClick={() => setMode("increase")}
                >
                  Increase
                </button>
              </div>

              <label className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 transition-colors focus-within:border-[#0073EA] dark:border-zinc-700">
                <span className="text-[13px] font-semibold text-zinc-400" aria-hidden>
                  {unit || "#"}
                </span>
                <input
                  type="number"
                  step="any"
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  aria-label={mode === "increase" ? "Amount to increase by" : "Amount to decrease by"}
                  className="w-full bg-transparent text-[14px] font-medium text-zinc-900 outline-none placeholder:text-zinc-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>

              {next != null && (
                <p className="mt-2 text-center text-[11.5px] tabular-nums text-zinc-400">
                  {fmtNum(target.currentValue)}{unit} → <strong className="font-semibold text-zinc-600">{fmtNum(next)}{unit}</strong>
                </p>
              )}

              {error && (
                <div className="mt-3">
                  {error.kind === "kpi" ? (
                    <KpiNotice>{error.text}</KpiNotice>
                  ) : (
                    <p role="alert" className="text-center text-[12px] text-[#E2445C]">{error.text}</p>
                  )}
                </div>
              )}

              <div className="mt-4 flex justify-center">
                <Button type="submit" disabled={saving || !hasDelta} className="h-9 px-6">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save update
                </Button>
              </div>
            </div>

            {/* ── Note (optional) — the API stores it on the KRCheckIn row ── */}
            <div className="border-t border-zinc-100 px-6 pb-5 pt-4">
              <div className="mb-1 flex items-baseline justify-between">
                <label
                  htmlFor="okr-ci-note"
                  className="text-[11px] font-bold uppercase tracking-wide text-zinc-400"
                >
                  Note <span className="font-medium normal-case">(optional)</span>
                </label>
                <span className="text-[10.5px] text-zinc-300 dark:text-zinc-600">Max 2000 characters</span>
              </div>
              <Textarea
                id="okr-ci-note"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add context for this update…"
                className="min-h-[56px] border-0 bg-transparent px-0 py-1 shadow-none hover:border-0 focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
