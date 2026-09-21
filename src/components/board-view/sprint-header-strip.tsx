"use client";

// SprintHeaderStrip — the sprint band above a sprint List's canvas
// (ClickUp Sprints parity): date range, live countdown pill, the pace
// verdict (Ahead / On track / Behind), total vs done Sprint Points with a
// progress track, a Burndown toggle that unfolds the real chart (ideal
// against actual, lib/sprint.ts sprintBurndown), and (for editors) a
// date-edit popover that PATCHes settings.sprint.
//
// Reads the LIVE items state from BoardCanvas, so inline point edits and
// status changes update the totals without a refresh. No recharts here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { IterationCw, Pencil, TrendingDown } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { computeSprintPoints, sprintBurndown, sprintDayLabel, sprintVerdict, type SprintMeta } from "@/lib/sprint";
import { MorePortal } from "@/components/layout/os/more-portal";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { useOsToast } from "@/components/layout/os/toast";
import { BurndownChart } from "@/components/ui/burndown-chart";

interface SprintHeaderStripProps {
  boardId: string;
  canEdit: boolean;
  sprint: SprintMeta;
  items: Pick<BoardItemRow, "status" | "metadata" | "updatedAt">[];
  statuses: StatusOption[];
}

export function SprintHeaderStrip({ boardId, canEdit, sprint, items, statuses }: SprintHeaderStripProps) {
  const router = useRouter();
  const { toast } = useOsToast();
  // Local mirror of the dates so an edit renders instantly (optimistic);
  // reverted + surfaced on double failure (data-integrity rule).
  const [dates, setDates] = useState({ startDate: sprint.startDate, endDate: sprint.endDate });
  const [editOpen, setEditOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(sprint.startDate);
  const [draftEnd, setDraftEnd] = useState(sprint.endDate);
  const [saving, setSaving] = useState(false);
  const [burndownOpen, setBurndownOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Outside-mousedown / Escape close, the same pattern the container menus use.
  useEffect(() => {
    if (!editOpen) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setEditOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [editOpen]);

  const { total, done } = computeSprintPoints(items, statuses);
  const { label, phase } = sprintDayLabel(dates.startDate, dates.endDate);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const verdict = sprintVerdict(items, statuses, dates.startDate, dates.endDate);
  const burndown = burndownOpen ? sprintBurndown(items, statuses, dates.startDate, dates.endDate) : null;
  const verdictClass =
    verdict.tone === "good" ? "bg-success-bg text-success-text"
    : verdict.tone === "bad" ? "bg-danger-bg text-danger-text"
    : verdict.tone === "ok" ? "bg-brand-soft text-brand-deep"
    : "bg-subtle text-ink-2";

  const openEditor = () => {
    setDraftStart(dates.startDate);
    setDraftEnd(dates.endDate);
    setEditOpen(true);
  };

  const canSaveDraft = !!draftStart && !!draftEnd && draftEnd >= draftStart && !saving;

  const saveDates = async () => {
    if (!canSaveDraft) return;
    const prev = dates;
    const next = { startDate: draftStart, endDate: draftEnd };
    setDates(next); // optimistic
    setEditOpen(false);
    setSaving(true);
    const push = async () => {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sprint: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    };
    try {
      try {
        await push();
      } catch {
        await push(); // one retry
      }
      // The server may auto-rename the board to the new dates — refresh the
      // page chrome (breadcrumb) + the sidebar tree.
      router.refresh();
      refreshSidebar();
    } catch {
      setDates(prev);
      toast("Couldn't save sprint dates");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-2">
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-3 py-1.5">
      <IterationCw className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
      <span className="text-base font-medium text-ink">
        {format(parseISO(dates.startDate), "MMM d")} to {format(parseISO(dates.endDate), "MMM d")}
      </span>
      {/* Countdown: a pale chip with a dot and the words (design-system
          chips), not a solid uppercase pill. Active is the brand tint, a
          sprint that has not started or has ended is quiet. */}
      <span
        className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
          phase === "active" ? "bg-brand-soft text-brand-deep" : "bg-surface-2 text-ink-2"
        }`}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${phase === "active" ? "bg-brand" : "bg-ink-3"}`} aria-hidden />
        {label}
      </span>
      <span className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${verdictClass}`} title="Pace against an even burn of the Sprint Points">
        {verdict.label}
      </span>
      <div className="h-4 w-px bg-line" aria-hidden />
      <span className="text-sm text-ink-2">Points</span>
      <span className="text-base font-medium tabular-nums text-ink">{done} / {total}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Sprint Points done">
        <div className="h-full rounded-full bg-success-solid" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setBurndownOpen((v) => !v)}
        aria-expanded={burndownOpen}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-sm ${
          burndownOpen ? "border-line-strong bg-active text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"
        }`}
      >
        <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        Burndown
      </button>
      {canEdit ? (
        <>
          <button
            ref={anchorRef}
            type="button"
            onClick={() => (editOpen ? setEditOpen(false) : openEditor())}
            aria-expanded={editOpen}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-sm ${
              editOpen ? "border-line-strong bg-active text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            Edit dates
          </button>
          <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={260} open={editOpen} placement="below">
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-3 text-ink shadow-[var(--os-shadow-pop)]">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink-2" htmlFor="sprint-start">Start date</label>
                <input
                  id="sprint-start"
                  type="date"
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  className="h-8 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink-2" htmlFor="sprint-end">End date</label>
                <input
                  id="sprint-end"
                  type="date"
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="h-8 w-full rounded-md border border-line-strong bg-raised px-2.5 text-base text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="h-8 rounded-md px-3 text-base text-ink-2 hover:bg-hover hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveDates()}
                  disabled={!canSaveDraft}
                  className="h-8 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </MorePortal>
        </>
      ) : null}
    </div>
    {burndown ? (
      <div className="mt-2 rounded-lg border border-line bg-raised p-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-base font-medium text-ink">Burndown</span>
          <span className="text-xs text-ink-2">Day {burndown.dayOf} of {burndown.days}</span>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-ink-3" aria-hidden /> Ideal
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span className="inline-block h-0.5 w-4 bg-brand" aria-hidden /> Actual
          </span>
        </div>
        {burndown.total === 0 ? (
          <p className="text-sm text-ink-2">Give tasks Sprint Points and the burndown draws itself.</p>
        ) : (
          <BurndownChart points={burndown.points} total={burndown.total} todayIndex={burndown.dayOf - 1} unit="points" />
        )}
        <p className="mt-2 text-xs text-ink-3">A done task burns its points on the day it was last updated.</p>
      </div>
    ) : null}
    </div>
  );
}
