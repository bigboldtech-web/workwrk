"use client";

// TimesheetDrawer (spec-planner.md section 3): one person's week, opened
// from the Approvals and Team tables, with the decision in its footer.
//
// WHY A DRAWER AND NOT A ROW THAT UNFOLDS. An approver reads a week and
// decides on it; unfolding it inside the table pushed every other row down
// and lost the approver's place in the queue, and there was nowhere stable
// to put the two decision buttons. The drawer is the one pattern the shell
// already owns: it registers a layer, so Esc closes the Reject modal first
// and the drawer second, and the table behind it stays exactly where it was.
//
// REJECT NEEDS A REASON, AND THE API AGREES. PATCH /api/timesheets/[id]
// answers 400 `note_required` for a REJECT with no note, so the modal's
// primary stays disabled until there is one. The person whose week it is
// reads that note in the banner on their own week card, which is the whole
// point of collecting it (audit T-4).
//
// The footer renders ONLY when the week is SUBMITTED and this viewer may
// decide on it: a control the role cannot use is not rendered, never
// rendered disabled (access spec section 5.4). Nobody decides their own
// week, and the API refuses it too.

import { useEffect, useState } from "react";
import { CircleAlert, Link2, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { useOsToast } from "@/components/layout/os/toast";
import { Dots } from "@/components/ui/dots";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFormat } from "@/lib/format/use-date-prefs";
import { apiFetchWithRetry } from "@/lib/api-fetch";
import { formatHm, utcDayKey } from "@/lib/time-format";
import type { WorkSchedule } from "@/lib/work-schedule";
import { TimesheetWeekCard } from "./timesheet-week-card";
import {
  WEEK_STATUS_LABELS,
  sumMinutes,
  type GridEntry,
  type WeekStatus,
} from "@/lib/timesheet-grid";

interface Person { id: string; firstName?: string | null; lastName?: string | null }

export interface DrawerSheet {
  id: string;
  userId: string;
  status: WeekStatus;
  weekStartDate: string;
  submittedAt?: string | null;
  decisionAt?: string | null;
  decisionNote?: string | null;
  user?: Person | null;
  approver?: Person | null;
  entries?: GridEntry[];
}

function personName(p: Person | null | undefined, fallback = "Someone"): string {
  if (!p) return fallback;
  const n = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return n || fallback;
}

export interface TimesheetDrawerProps {
  sheetId: string | null;
  onClose: () => void;
  /** Does this viewer hold the decision? The page resolves it from the scope. */
  canDecide: boolean;
  /** The viewer, so the drawer never offers a decision on their own week. */
  viewerId: string | null;
  onDecided: () => void;
  schedule?: WorkSchedule;
}

export function TimesheetDrawer({
  sheetId, onClose, canDecide, viewerId, onDecided, schedule,
}: TimesheetDrawerProps) {
  const fmt = useFormat();
  const { toast } = useOsToast();
  const [sheet, setSheet] = useState<DrawerSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Everything below happens on the next tick or after an await, so this
    // effect body sets no state inside the render that opened the drawer
    // (react-hooks/set-state-in-effect).
    const run = async () => {
      await Promise.resolve();
      if (!alive) return;
      setSheet(null);
      setLoadError(null);
      setConfirmingApprove(false);
      setRejecting(false);
      setNote("");
      setWriteError(null);
      if (!sheetId) return;
      const r = await apiFetchWithRetry<{ data?: DrawerSheet } | DrawerSheet>(`/api/timesheets/${sheetId}`);
      if (!alive) return;
      if (!r.ok) { setLoadError(r.error); return; }
      const raw = r.data as Record<string, unknown>;
      setSheet((raw.data ?? raw) as DrawerSheet);
    };
    void run();
    return () => { alive = false; };
  }, [sheetId]);

  async function decide(decision: "APPROVE" | "REJECT", reason?: string) {
    if (!sheetId) return;
    setBusy(decision === "APPROVE" ? "approve" : "reject");
    setWriteError(null);
    const r = await apiFetchWithRetry(
      `/api/timesheets/${sheetId}`,
      {
        method: "PATCH",
        json: { action: "decide", decision, ...(reason ? { note: reason } : {}) },
        keepalive: true,
      },
      { attempts: 2, retryWrites: false },
    );
    setBusy(null);
    if (!r.ok) {
      // The decision stays on screen with the reason still typed, so the
      // approver sends exactly what they wrote rather than starting again.
      setWriteError(r.error === "note_required" ? "A reason is required to send a week back." : r.error);
      return;
    }
    setRejecting(false);
    setConfirmingApprove(false);
    setNote("");
    onDecided();
    onClose();
  }

  /** The queue with this week open in the drawer: the spec's entry point. */
  function copyLink() {
    if (!sheetId || typeof window === "undefined") return;
    const url = `${window.location.origin}/timesheets?view=approvals&sheet=${sheetId}`;
    void navigator.clipboard.writeText(url).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy the link", { tone: "danger" }),
    );
  }

  const open = Boolean(sheetId);
  const weekKey = sheet ? utcDayKey(new Date(sheet.weekStartDate)) : null;
  const total = sumMinutes(sheet?.entries ?? []);
  const subject = personName(sheet?.user, "This person");
  const isOwnWeek = Boolean(sheet && viewerId && sheet.userId === viewerId);
  const decidable = canDecide && sheet?.status === "SUBMITTED" && !isOwnWeek;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        layerId="timesheet-drawer"
        ariaLabel="Timesheet"
        header={
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-base font-semibold text-ink">
                {subject}
                {weekKey ? ` · Week of ${fmt.date(`${weekKey}T12:00:00.000Z`, "date")}` : ""}
              </span>
              {sheet ? (
                <span className="shrink-0 rounded-md border border-line-strong bg-subtle px-1.5 text-sm text-ink-2">
                  {WEEK_STATUS_LABELS[sheet.status]}
                </span>
              ) : null}
            </div>
            {/* THE ICON CLUSTER. ui/drawer.tsx renders this slot verbatim and
                supplies no chrome of its own, and the drawer has no scrim, so
                without these two Esc was the only way out of the one drawer
                in the product that had no way out. Copy link hands the
                approver the deep link the spec's decision notification
                carries, so a week can be passed to somebody else. */}
            <button
              type="button"
              onClick={copyLink}
              aria-label="Copy link"
              title="Copy link to this week"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          </>
        }
        footer={
          decidable ? (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              {writeError ? (
                <p className="w-full text-sm text-danger-solid">{writeError}</p>
              ) : null}
              {confirmingApprove ? (
                <>
                  <span className="flex-1 text-base text-ink">
                    Approve {formatHm(total)} for {subject}?
                  </span>
                  <button
                    type="button"
                    onClick={() => { void decide("APPROVE"); }}
                    disabled={busy !== null}
                    className="h-9 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-40"
                  >
                    {busy === "approve" ? <Dots variant="pending" /> : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingApprove(false)}
                    className="h-9 rounded-md px-2.5 text-base text-ink-2 hover:bg-hover"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmingApprove(true)}
                    className="h-9 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRejecting(true); setWriteError(null); }}
                    className="h-9 rounded-md px-2.5 text-base font-medium text-danger-solid hover:bg-danger-soft"
                  >
                    Send back
                  </button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        <div className="p-4">
          {loadError ? (
            <div className="flex items-center gap-2 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
              <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
              <span className="flex-1">Couldn&rsquo;t load this week. {loadError}</span>
            </div>
          ) : (
            <TimesheetWeekCard
              weekStartKey={weekKey ?? "1970-01-01"}
              status={sheet?.status ?? null}
              entries={sheet?.entries ?? null}
              editable={false}
              layout="stacked"
              schedule={schedule}
              header={
                <>
                  <span className="text-base font-medium text-ink">Total</span>
                  <span className="ms-auto tabular-nums text-base font-medium text-ink">{formatHm(total)}</span>
                </>
              }
              banner={
                // The note survives a reopen on purpose (the person needs it
                // while they fix the week), so the banner follows the note
                // rather than the status, and it NAMES the person who sent
                // it back, which is the point of collecting it (audit T-4).
                sheet?.decisionNote && sheet.status !== "APPROVED" ? (
                  <p className="flex min-h-11 items-center border-b border-line-soft bg-danger-soft px-3 py-2 text-base text-danger-solid">
                    Sent back
                    {sheet.approver ? ` by ${personName(sheet.approver)}` : ""}
                    {sheet.decisionAt ? ` on ${fmt.date(sheet.decisionAt, "date")}` : ""}
                    : {sheet.decisionNote}
                  </p>
                ) : sheet?.submittedAt ? (
                  <p className="border-b border-line-soft px-3 py-2 text-base text-ink-2">
                    Submitted {fmt.date(sheet.submittedAt, "datetime")}
                    {sheet.approver ? ` to ${personName(sheet.approver)}` : ""}
                  </p>
                ) : null
              }
            />
          )}

          {isOwnWeek && canDecide ? (
            <p className="mt-3 text-base text-ink-3">
              This is your own week, so the decision is not yours to make.
            </p>
          ) : null}
        </div>
      </Drawer>

      {/* The Reject modal. A reason is required, and the primary says so by
          staying off until there is one rather than by being clicked and
          answered 400. */}
      <Dialog open={rejecting} onOpenChange={(v) => { if (!v) setRejecting(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Send back {subject}&rsquo;s week
              {weekKey ? ` of ${fmt.date(`${weekKey}T12:00:00.000Z`, "date")}` : ""}
            </DialogTitle>
            <DialogDescription>
              {subject} sees this on their own week card and can reopen it to fix the hours.
            </DialogDescription>
          </DialogHeader>
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Tell ${personName(sheet?.user, "them").split(" ")[0]} what to fix`}
            aria-label="Reason"
            className="w-full rounded-md border border-line-strong bg-raised px-2 py-1.5 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          {writeError ? <p className="text-sm text-danger-solid">{writeError}</p> : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="h-9 rounded-md px-3 text-base text-ink-2 hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!note.trim() || busy !== null}
              onClick={() => { void decide("REJECT", note.trim()); }}
              className="h-9 rounded-md bg-danger-solid px-3 text-base font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy === "reject" ? <Dots variant="pending" /> : "Send it back"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
