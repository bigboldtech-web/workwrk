"use client";

// Check in on a target (spec-goals /okrs/[id], the 400 modal). The person
// either sets the new value, or adds to or subtracts from the current one
// (the old Decrease / Increase toggle); a live line previews "42 to 58 units
// · 58%" before anything is saved. POST /api/okrs/[id]/check-in with the
// ABSOLUTE new value, the API contract since the check-in route shipped;
// direction-aware progress math stays server-side. A target fed by a KPI is
// measured by the KPI: the server refuses a hand check-in with 409, so the
// modal says so up front and shows any 409 the same way.
//
// A repeating goal (docs/plans/recurring-goals.md C1, B7): the check-in
// always carries the periodKey of the period on screen, so it lands there
// and never depends on which period the server thinks is running (a stopped
// goal's last period in its grace has none running after it: step 3 review
// M1). The title always names the period it lands in ("Check in on Demos
// booked for November 2026"), so a late number for October is never typed
// into November by mistake (final review H1). After its window the server
// answers 409 ("October took its last numbers on 5 Nov. Its numbers are
// final."), shown as it comes. Closing it puts focus back on the control
// that opened it (`returnFocus`, final review M9).

import { useState, type RefObject } from "react";
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

/**
 * Why a target takes no check-in (C2, C9): counted from a List or a table
 * names it ("from Sales pipeline"), or only "a private List" or "a private
 * table" for a viewer who cannot open it; a KPI names the KPI.
 */
export function automaticWords(target: Pick<TargetRowData, "kpiName" | "source">): string {
  if (target.source) {
    const from = target.source.private ? (target.source.kind === "table" ? "a private table" : "a private List") : target.source.label.replace(/^From /, "");
    return `This target is counted from ${from}. Its number comes from there, so there is nothing to check in here.`;
  }
  return `This target is measured by the KPI ${target.kpiName ?? "it is linked to"}. Its number comes from the KPI, so there is nothing to check in here.`;
}

/** The dialog's title: a repeating goal's always names the period the number lands in (final review H1). */
export function checkInTitle(target: Pick<TargetRowData, "title">, writable: boolean, period: { label: string } | null): string {
  if (!writable) return target.title;
  return `Check in on ${target.title}${period ? ` for ${period.label}` : ""}`;
}

/**
 * Radix's close focus, sent to `returnFocus` when it is still on the page:
 * a check-in opened from the row's menu would otherwise drop focus to the
 * page, since the menu item that opened it is gone (final review M9).
 */
export function returnFocusOnClose(ref: RefObject<HTMLElement | null> | null | undefined) {
  return (e: Event) => {
    const el = ref?.current;
    if (!el || !el.isConnected) return;
    e.preventDefault();
    el.focus();
  };
}

/** POST /api/okrs/[id]/check-in's body: a repeating goal's always names the period on screen. */
export function checkInBody(targetId: string, value: number, note: string, period: { key: string } | null): Record<string, unknown> {
  return { keyResultId: targetId, value, note: note.trim() || null, ...(period ? { periodKey: period.key } : {}) };
}

export function OkrCheckInModal({ okrId, target, canEdit, onClose, period = null, returnFocus = null }: {
  okrId: string;
  target: TargetRowData;
  /** May check in (owner, contributors, manager chain, People team, Admin). */
  canEdit: boolean;
  onClose: () => void;
  /** A repeating goal's period on screen; `ended` when it takes only late numbers. Null for a one-time goal. */
  period?: { key: string; label: string; ended: boolean } | null;
  /** Where focus goes when it closes: the control that opened it. */
  returnFocus?: RefObject<HTMLElement | null> | null;
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
        body: JSON.stringify(checkInBody(target.id, next, note, period)),
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
      <DialogContent className="max-w-[400px]" onCloseAutoFocus={returnFocusOnClose(returnFocus)}>
        <DialogHeader>
          <DialogTitle>{checkInTitle(target, writable, period)}</DialogTitle>
        </DialogHeader>
        <form id="okr-checkin" onSubmit={submit} className="flex flex-col gap-3">
          <p className="m-0 text-sm tabular-nums text-ink-2">
            Start {fmtNum(target.startValue)} · Now {fmtNum(target.currentValue)} · Target {fmtNum(target.targetValue)}{unit ? ` ${unit}` : ""}
          </p>
          {target.isDerived ? (
            <p role="status" className="m-0 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink">
              {automaticWords(target)}
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
          {/* Outlined, as every goal dialog's Cancel (final review L12). */}
          <Button variant="outline" onClick={onClose}>{writable ? "Cancel" : "Close"}</Button>
          {writable ? <Button type="submit" form="okr-checkin" disabled={next == null || saving}>{saving ? "Saving" : "Save check-in"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
