"use client";

// Check in on a target (spec-goals /okrs/[id], the 400 modal). The person
// either sets the new value, or adds to or subtracts from the current one
// (the old Decrease / Increase toggle); a live line previews "42 to 58 units
// · 58%" before anything is saved. POST /api/okrs/[id]/check-in with the
// ABSOLUTE new value, the API contract since the check-in route shipped;
// direction-aware progress math stays server-side. A target fed by a KPI is
// measured by the KPI: the server refuses a hand check-in with 409, so the
// modal says so up front and shows any 409 the same way.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOsToast } from "@/components/layout/os/toast";
import type { TargetRowData } from "./goal-targets";

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

type Mode = "set" | "add" | "subtract";

export function previewProgress(start: number, target: number, value: number): number {
  if (target === start) return value >= target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((value - start) / (target - start)) * 100)));
}

export function OkrCheckInModal({ okrId, target, canEdit, onClose }: {
  okrId: string;
  target: TargetRowData;
  /** May check in (owner, contributors, manager chain, People team, Admin). */
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [mode, setMode] = useState<Mode>("set");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: "kpi" | "plain"; text: string } | null>(null);

  const unit = target.unit?.trim() ?? "";
  const n = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(n);
  const next = !valid ? null : mode === "set" ? n : mode === "add" ? target.currentValue + n : target.currentValue - n;
  const writable = canEdit && !target.isDerived;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next == null || saving || !writable) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/okrs/${okrId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId: target.id, value: next, note: note.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError({ kind: res.status === 409 ? "kpi" : "plain", text: typeof data?.error === "string" ? data.error : "Couldn't save the check-in" });
        return;
      }
      toast("Check-in saved");
      onClose();
      router.refresh();
    } catch {
      setError({ kind: "plain", text: "Couldn't save the check-in. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{writable ? `Check in on ${target.title}` : target.title}</DialogTitle>
        </DialogHeader>
        <form id="okr-checkin" onSubmit={submit} className="flex flex-col gap-3">
          <p className="m-0 text-sm tabular-nums text-ink-2">
            Start {fmtNum(target.startValue)} · Now {fmtNum(target.currentValue)} · Target {fmtNum(target.targetValue)}{unit ? ` ${unit}` : ""}
          </p>
          {target.isDerived ? (
            <p role="status" className="m-0 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink">
              This target is measured by the KPI {target.kpiName ?? "it is linked to"}. Its number comes from the KPI, so there is nothing to check in here.
            </p>
          ) : !canEdit ? (
            <p role="status" className="m-0 text-sm text-ink-2">You need Can edit on this goal to check in.</p>
          ) : (
            <>
              <SegmentedControl label="How to change the value" value={mode} onChange={setMode}
                options={[{ value: "set", label: "Set value" }, { value: "add", label: "Add" }, { value: "subtract", label: "Subtract" }]} />
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                <span>{mode === "set" ? "Current value" : mode === "add" ? "Add" : "Subtract"}</span>
                <span className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-line bg-raised px-3 text-base font-normal tabular-nums text-ink focus:border-brand focus:outline-none"
                  />
                  {unit ? <span className="text-sm font-normal text-ink-2">{unit}</span> : null}
                </span>
              </label>
              <p className="m-0 text-sm tabular-nums text-ink-2" aria-live="polite">
                {next != null
                  ? `${fmtNum(target.currentValue)} to ${fmtNum(next)}${unit ? ` ${unit}` : ""} · ${previewProgress(target.startValue, target.targetValue, next)}%`
                  : "Type a number to see the new progress."}
              </p>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                <span>Note <span className="font-normal text-ink-2">(optional)</span></span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
                  className="rounded-md border border-line bg-raised px-3 py-2 text-base font-normal text-ink focus:border-brand focus:outline-none" />
              </label>
            </>
          )}
          {error ? (
            <p role="alert" className={error.kind === "kpi" ? "m-0 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink" : "m-0 text-sm text-danger-text"}>{error.text}</p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{writable ? "Cancel" : "Close"}</Button>
          {writable ? <Button type="submit" form="okr-checkin" disabled={next == null || saving}>{saving ? "Saving" : "Save check-in"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
