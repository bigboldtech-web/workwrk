"use client";

// SprintHeaderStrip — the sprint band above a sprint List's canvas
// (ClickUp Sprints parity): date range, live countdown pill, total vs
// done Sprint Points with a progress track, an honest "Burndown" stub,
// and (for editors) a date-edit popover that PATCHes settings.sprint.
//
// Reads the LIVE items state from BoardCanvas, so inline point edits and
// status changes update the totals without a refresh. No recharts here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { IterationCw, Pencil, TrendingDown } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { computeSprintPoints, sprintDayLabel, type SprintMeta } from "@/lib/sprint";
import { MorePortal } from "@/components/layout/os/more-portal";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { useOsToast } from "@/components/layout/os/toast";

interface SprintHeaderStripProps {
  boardId: string;
  canEdit: boolean;
  sprint: SprintMeta;
  items: Pick<BoardItemRow, "status" | "metadata">[];
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
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Outside-mousedown / Escape close — same pattern as SpaceCreateTrigger.
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
    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5">
      <IterationCw className="w-3.5 h-3.5 shrink-0 text-[#0073EA]" />
      <span className="text-[13.5px] font-semibold text-zinc-900">
        {format(parseISO(dates.startDate), "MMM d")} – {format(parseISO(dates.endDate), "MMM d")}
      </span>
      <span
        className={`inline-flex items-center h-5 rounded-[5px] px-2 text-[11.5px] font-bold uppercase text-white ${
          phase === "active" ? "bg-[#0073EA]" : "bg-zinc-500"
        }`}
      >
        {label}
      </span>
      <div className="h-4 w-px bg-zinc-200" />
      <span className="text-[13px] text-zinc-500">Points</span>
      <span className="text-[13.5px] font-semibold text-zinc-900">{done} / {total}</span>
      <div className="w-24 h-1.5 rounded-full bg-zinc-200 overflow-hidden">
        <div className="h-full rounded-full bg-[#0073EA]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => toast("Burndown & velocity charts coming soon")}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-zinc-600 border border-zinc-200 hover:bg-zinc-100"
      >
        <TrendingDown className="w-3.5 h-3.5" />
        Burndown
      </button>
      {canEdit ? (
        <>
          <button
            ref={anchorRef}
            type="button"
            onClick={() => (editOpen ? setEditOpen(false) : openEditor())}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-zinc-600 border border-zinc-200 hover:bg-zinc-100"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit dates
          </button>
          <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={260} open={editOpen} placement="below">
            <div className="flex flex-col gap-3 p-3">
              <div className="flex flex-col gap-1">
                <label className="text-[13px] font-medium text-zinc-600">Start date</label>
                <input
                  type="date"
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  className="w-full h-8 px-2.5 text-[14px] bg-white border border-zinc-200 rounded-md"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[13px] font-medium text-zinc-600">End date</label>
                <input
                  type="date"
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="w-full h-8 px-2.5 text-[14px] bg-white border border-zinc-200 rounded-md"
                />
              </div>
              <button
                type="button"
                onClick={() => void saveDates()}
                disabled={!canSaveDraft}
                className="h-8 px-4 text-[13.5px] font-medium rounded-md text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </MorePortal>
        </>
      ) : null}
    </div>
  );
}
