"use client";

// Goal modal — ONE surface for create and edit, mirroring ClickUp's
// create-goal flow: Goal name → Owner ("Who is responsible for this
// Goal?", a first-class single-person field) → access/sharing (our
// Contributors = GoalAudiencePicker) → dates → description. ClickUp
// reuses the same panel for editing; so do we — pass `goal` and the
// modal opens pre-filled and PATCHes on save.
//
// A goal stays ONE record: single accountable owner (ownerId), many
// contributors (GoalAssignee refs resolved at read time), one shared
// scoreboard — never per-person copies. ClickUp's purple accents
// translate to brand blue #0073EA per the design system.

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoalAudiencePicker, type AudienceEntry } from "@/components/okrs/goal-audience-picker";
import { GoalOwnerPicker } from "@/components/okrs/goal-owner-picker";
import type { PersonRef } from "@/components/board-view/assignee-picker";

export type GoalLevel = "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";

const LEVEL_OPTIONS: { value: GoalLevel; label: string }[] = [
  { value: "COMPANY", label: "Company" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "INDIVIDUAL", label: "Individual" },
];

// "NONE" silences the check-in reminder cron (src/app/api/cron/okr-reminders)
// for this one goal — a first-class opt-out, not a hidden sentinel.
type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "NONE";
const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "NONE", label: "None" },
];

// Mirrors isManager() server-side (api-helpers): only these levels may
// assign goals to other people or set non-INDIVIDUAL levels — the API
// enforces it regardless, this just keeps the UI honest.
const MANAGER_LEVELS = new Set([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "HR",
]);

/** Everything the modal needs to open pre-filled in edit mode. */
export interface EditableGoal {
  id: string;
  title: string;
  description?: string | null;
  level: GoalLevel;
  ownerId?: string | null;
  owner?: PersonRef | null;
  quarter?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  checkInCadence?: string | null;
}

interface CreateGoalModalProps {
  open: boolean;
  /** Preselected level for CREATE (which section's "Add" was clicked).
   *  Render with `key={level}` (create) / `key={goal.id}` (edit) so
   *  reopening remounts with fresh state. */
  level: GoalLevel;
  /** EDIT mode: open pre-filled with this goal and PATCH on save. */
  goal?: EditableGoal | null;
  /** Land the user straight in the Owner picker ("Assign owner"). */
  focusOwner?: boolean;
  onClose: () => void;
  /** Fires after a successful POST (create) or PATCH (edit). */
  onSaved: () => void;
}

/** ISO date → the YYYY-MM-DD an <input type="date"> wants. */
function toDateInput(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function CreateGoalModal({ open, level, goal, focusOwner, onClose, onSaved }: CreateGoalModalProps) {
  const isEdit = Boolean(goal);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  const isManagerViewer = MANAGER_LEVELS.has(accessLevel);

  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [selLevel, setSelLevel] = useState<GoalLevel>(goal?.level ?? level);
  const [owner, setOwner] = useState<PersonRef | null>(goal?.owner ?? null);
  // Edit mode: only PATCH ownerId when the user actually touched the
  // field — if the caller couldn't resolve the owner object for a goal
  // that HAS an ownerId, an untouched save must not silently unassign.
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [audience, setAudience] = useState<AudienceEntry[]>([]);
  // Edit mode: contributors load async from the goal's audience rows —
  // hold the PATCH's `assignees` until they arrive so a fast save can't
  // wipe an audience the user never saw.
  const [audienceLoaded, setAudienceLoaded] = useState(!isEdit);
  const [startDate, setStartDate] = useState(toDateInput(goal?.startDate));
  const [endDate, setEndDate] = useState(toDateInput(goal?.endDate));
  const [quarter, setQuarter] = useState(goal?.quarter ?? "");
  const [cadence, setCadence] = useState<Cadence>(
    goal?.checkInCadence === "BIWEEKLY" ||
    goal?.checkInCadence === "MONTHLY" ||
    goal?.checkInCadence === "NONE"
      ? goal.checkInCadence
      : "WEEKLY",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: current contributors come from the goal's audience rows
  // (labeled entries — the same shape the picker edits).
  useEffect(() => {
    if (!isEdit || !goal?.id) return;
    let active = true;
    fetch(`/api/okrs/${goal.id}/assignees`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        const entries = Array.isArray(d?.entries) ? d.entries : [];
        setAudience(entries);
        setAudienceLoaded(true);
      })
      .catch(() => { if (active) setAudienceLoaded(true); });
    return () => { active = false; };
  }, [isEdit, goal?.id]);

  function reset() {
    setError(null);
  }

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      level: selLevel,
      quarter: quarter.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
      checkInCadence: cadence,
    };
    if (isManagerViewer && (!isEdit || ownerTouched)) payload.ownerId = owner?.id ?? null;
    // Only send the audience once we actually know it (see above).
    if (audienceLoaded) payload.assignees = audience.map((e) => ({ type: e.type, id: e.id }));
    try {
      const res = await fetch("/api/okrs", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: goal!.id, ...payload } : payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      reset();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : isEdit ? "Couldn't save the goal" : "Couldn't create the goal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit goal" : "New objective"}</DialogTitle>
          <DialogDescription>
            One goal, one scoreboard — everyone assigned shares the same progress bar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Goal name
            </label>
            <Input
              autoFocus={!focusOwner}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="What do you want to do?"
              className="h-8 text-[13px]"
            />
          </div>

          {isManagerViewer && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Owner
              </label>
              <GoalOwnerPicker
                value={owner}
                onChange={(p) => { setOwner(p); setOwnerTouched(true); }}
                initialOpen={focusOwner}
              />
              {/* Helper, not a link — gray like every other field hint (blue
                  made it read as clickable). */}
              <p className="mt-1 text-[11px] text-zinc-400">
                Who is responsible for this Goal?
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Level
            </label>
            {/* flex-wrap: three labels + translations must never clip out of a
                narrow modal — wrap to a second line instead. */}
            <div className="flex flex-wrap gap-1.5">
              {LEVEL_OPTIONS.map((o) => {
                const locked = !isManagerViewer && o.value !== "INDIVIDUAL";
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={locked}
                    onClick={() => setSelLevel(o.value)}
                    className={`h-7 rounded-md border px-2.5 text-[12px] transition-colors ${
                      selLevel === o.value
                        ? "border-[#0073EA] bg-[#0073EA]/10 font-medium text-[#0073EA]"
                        : locked
                          ? "border-zinc-100 text-zinc-300 cursor-not-allowed dark:border-zinc-800 dark:text-zinc-600"
                          : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Contributors
            </label>
            <GoalAudiencePicker value={audience} onChange={setAudience} />
            <p className="mt-1 text-[11px] text-zinc-400">
              Who can see and push this Goal — departments and roles resolve to their current members.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Start date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                End date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
          </div>

          {/* Quarter is a short input but the cadence group is three buttons —
              side-by-side they overflow a narrow modal (the "Monthly clips out
              of the box" bug), so the pair stacks below the sm breakpoint.
              min-w-0 lets the cadence cell actually shrink inside the grid. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Quarter
              </label>
              <Input
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="e.g. Q3 2026"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Check-in cadence
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CADENCE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setCadence(o.value)}
                    className={`h-7 rounded-md border px-2 text-[12px] transition-colors ${
                      cadence === o.value
                        ? "border-[#0073EA] bg-[#0073EA]/10 font-medium text-[#0073EA]"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {cadence === "NONE" && (
                <p className="mt-1 text-[11px] text-zinc-400">
                  No check-in reminders for this goal.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why is this Goal set, and how should it be achieved?"
              rows={2}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-[#0073EA]/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
          </div>

          {error && <p className="text-[12px] text-[#E2445C]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
