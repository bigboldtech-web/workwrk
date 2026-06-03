"use client";

// KpiScoreModal — inline scoring for a KPIRecord from MyAlignment.
// Single number input + optional notes + Submit. Posts to
// /api/me/kpi-prompts/[id]/score; on success calls onScored so the
// parent removes the row from the prompts column.

import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface KpiPromptLike {
  id: string;
  period: string;
  targetValue: number | null;
  kpi: { id: string; name: string; unit: string | null; frequency: string; lowerIsBetter: boolean };
}

export function KpiScoreModal({
  open,
  onOpenChange,
  prompt,
  onScored,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prompt: KpiPromptLike | null;
  onScored?: (id: string) => void;
}) {
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setActual("");
    setNotes("");
    setError(null);
    setSubmitting(false);
  }, [open, prompt?.id]);

  const submit = async () => {
    if (!prompt) return;
    setError(null);
    const num = Number(actual);
    if (!Number.isFinite(num)) {
      setError("Enter a number");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/me/kpi-prompts/${prompt.id}/score`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actualValue: num, notes: notes.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to submit");
        setSubmitting(false);
        return;
      }
      onScored?.(prompt.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
      setSubmitting(false);
    }
  };

  if (!prompt) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] p-0">
        <div className="px-5 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-[var(--os-brand)]" />
            Score {prompt.kpi.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted mt-1">
            Period {prompt.period} · target {prompt.targetValue ?? "—"}{prompt.kpi.unit ? ` ${prompt.kpi.unit}` : ""} · {prompt.kpi.frequency.toLowerCase()}
          </DialogDescription>
        </div>

        <div className="px-5 py-3 space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">
              Actual value{prompt.kpi.unit ? ` (${prompt.kpi.unit})` : ""}
            </label>
            <input
              type="number"
              step="any"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoFocus
              placeholder={String(prompt.targetValue ?? "")}
              className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm focus:outline-none focus:border-[var(--os-brand)]"
            />
            {prompt.kpi.lowerIsBetter ? (
              <div className="text-[10px] uppercase tracking-wide text-muted mt-1">Lower is better</div>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">
              Notes <span className="text-muted">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
          </div>
          {error ? <div className="text-xs text-red-500">{error}</div> : null}
        </div>

        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-border">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted hover:text-foreground px-3 py-2"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || actual === ""}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
