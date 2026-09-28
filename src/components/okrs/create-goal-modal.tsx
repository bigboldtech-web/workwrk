"use client";

// Create / Edit goal (spec-goals /okrs, 560, one surface for both). Fields:
// Goal name, Owner and Level (only for viewers who may assign goals to
// others: the manager tier POST and PATCH /api/okrs accept an owner and a
// level from), Part of (the goal this one supports; the new parent picker,
// sent as parentId), Start and Due dates, Check-ins, Description.
//
// Removed from the modal, never from the product:
//   Quarter        derived from the due date and the org's fiscal year
//                  (src/lib/fiscal-quarter.ts); OKR.quarter is kept, unwritten
//   Contributors   added and removed on the goal page's Details row (the
//                  same GoalAudiencePicker, one surface for one job); an edit
//                  from here never sends `assignees`, so it cannot wipe them
//
// A dirty form confirms before it closes. Errors stay inline.

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DateField } from "@/components/ui/date-field";
import { Picker } from "@/components/ui/picker";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { apiFetch } from "@/lib/api-fetch";
import type { PersonRef } from "@/components/board-view/assignee-picker";

export type GoalLevel = "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";

const LEVEL_OPTIONS: { value: GoalLevel; label: string }[] = [
  { value: "COMPANY", label: "Company" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "INDIVIDUAL", label: "Individual" },
];

// "NONE" silences the check-in reminder cron (src/app/api/cron/okr-reminders)
// for this one goal: a first-class opt-out, not a hidden sentinel.
type Cadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "NONE";
const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every two weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "NONE", label: "None" },
];

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
  parentId?: string | null;
}

interface CreateGoalModalProps {
  open: boolean;
  /** Preselected level for CREATE. */
  level: GoalLevel;
  /** EDIT mode: open pre-filled with this goal and PATCH on save. */
  goal?: EditableGoal | null;
  /** Land the user straight in the Owner picker ("Assign owner"). */
  focusOwner?: boolean;
  /** CREATE: start with this owner (a person record's "Set a goal"). */
  initialOwner?: PickPerson | null;
  /** Land the user on the Part of field ("Add" on the goal page). */
  focusParent?: boolean;
  onClose: () => void;
  /** Fires after a successful POST (create, with the new id) or PATCH (edit). */
  onSaved: (id?: string) => void;
}

type ParentOption = { id: string; title: string; level: GoalLevel };

function toDateInput(iso?: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

const LEVEL_WORD: Record<GoalLevel, string> = { COMPANY: "Company", DEPARTMENT: "Department", INDIVIDUAL: "Individual" };

/**
 * May the viewer give a new goal an owner other than themselves? The same
 * ladder the modal and POST /api/okrs read, for doors that open the modal
 * with an owner already chosen (a person record's "Set a goal").
 */
export function useMayAssignGoalOwner(): boolean {
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  return legacyIsManagerLevel(accessLevel);
}

export function CreateGoalModal({ open, level, goal, focusOwner, focusParent, initialOwner, onClose, onSaved }: CreateGoalModalProps) {
  const isEdit = Boolean(goal);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  // The one shared ladder: exactly the isManager() tier POST and PATCH
  // /api/okrs ask before they accept an owner or a non-Individual level, so
  // the modal never offers a choice the save would silently drop.
  const mayAssign = legacyIsManagerLevel(accessLevel);
  const confirm = useConfirm();

  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [selLevel, setSelLevel] = useState<GoalLevel>(goal?.level ?? (mayAssign ? level : "INDIVIDUAL"));
  const [owner, setOwner] = useState<PickPerson | null>(
    goal?.owner ? { id: goal.owner.id, firstName: goal.owner.firstName ?? null, lastName: goal.owner.lastName ?? null, avatar: goal.owner.avatar ?? null, email: goal.owner.email ?? null } : !goal && initialOwner ? initialOwner : null,
  );
  // Edit mode: only PATCH ownerId when the user touched the field, so an
  // untouched save never silently unassigns.
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [parentId, setParentId] = useState<string | null>(goal?.parentId ?? null);
  const [parentOpen, setParentOpen] = useState(Boolean(focusParent));
  const [parents, setParents] = useState<ParentOption[] | null>(null);
  const [startDate, setStartDate] = useState<string | null>(toDateInput(goal?.startDate));
  const [endDate, setEndDate] = useState<string | null>(toDateInput(goal?.endDate));
  const [cadence, setCadence] = useState<Cadence>(
    goal?.checkInCadence === "BIWEEKLY" || goal?.checkInCadence === "MONTHLY" || goal?.checkInCadence === "NONE"
      ? goal.checkInCadence
      : "WEEKLY",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ title?: string; endDate?: string }>({});

  // Part of: goals one level up that the viewer can see (Company goals for
  // a Department goal; Company or Department goals for an Individual one).
  const parentLevels = useMemo<GoalLevel[]>(
    () => (selLevel === "INDIVIDUAL" ? ["COMPANY", "DEPARTMENT"] : ["COMPANY"]),
    [selLevel],
  );
  useEffect(() => {
    if (!open) return;
    let live = true;
    // Every page, not the first 100: in a large org a later parent must
    // still be choosable, and the current parent must still read by name.
    void (async () => {
      const all: ParentOption[] = [];
      for (let page = 1; page <= 200; page += 1) {
        const qs = new URLSearchParams({ page: String(page), pageSize: "100", level: parentLevels.join(","), sort: "name" });
        const r = await apiFetch<{ data: ParentOption[]; pagination?: { total: number } }>(`/api/okrs?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!r.ok) break;
        all.push(...(r.data.data ?? []));
        const total = r.data.pagination?.total ?? all.length;
        if ((r.data.data ?? []).length === 0 || all.length >= total) break;
      }
      if (!live) return;
      setParents(all.filter((g) => g.id !== goal?.id).map((g) => ({ id: g.id, title: g.title, level: g.level })));
    })();
    return () => { live = false; };
  }, [open, parentLevels, goal?.id]);
  const parentTitle = parents?.find((p) => p.id === parentId)?.title ?? (parentId ? "The current goal" : null);

  const initial = useMemo(() => JSON.stringify({
    t: goal?.title ?? "", d: goal?.description ?? "", l: goal?.level ?? level, p: goal?.parentId ?? null,
    s: toDateInput(goal?.startDate), e: toDateInput(goal?.endDate), c: goal?.checkInCadence ?? "WEEKLY",
  }), [goal, level]);
  const dirty = JSON.stringify({ t: title, d: description, l: selLevel, p: parentId, s: startDate, e: endDate, c: cadence }) !== initial || ownerTouched;

  async function tryClose() {
    if (dirty && !saving) {
      const ok = await confirm({ title: isEdit ? "Discard your changes?" : "Discard this goal?", description: "What you typed is not saved.", confirmLabel: "Discard", destructive: true });
      if (!ok) return;
    }
    onClose();
  }

  async function submit() {
    if (saving) return;
    const errs: { title?: string; endDate?: string } = {};
    if (!title.trim()) errs.title = "Give the goal a name.";
    if (!endDate) errs.endDate = "Pick a due date.";
    if (startDate && endDate && startDate > endDate) errs.endDate = "The due date is before the start date.";
    setFieldError(errs);
    if (errs.title || errs.endDate) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      level: mayAssign ? selLevel : isEdit ? goal!.level : "INDIVIDUAL",
      startDate: startDate || null,
      endDate: endDate || null,
      checkInCadence: cadence,
      parentId: parentId ?? (isEdit ? "" : null),
    };
    if (mayAssign && (!isEdit || ownerTouched)) payload.ownerId = owner?.id ?? null;
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/okrs", {
      method: isEdit ? "PATCH" : "POST",
      json: isEdit ? { id: goal!.id, ...payload } : payload,
    });
    setSaving(false);
    if (!r.ok) { setError(r.error || (isEdit ? "Couldn't save the goal" : "Couldn't create the goal")); return; }
    onSaved(r.data?.id ?? r.data?.data?.id ?? goal?.id);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void tryClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit goal" : "New goal"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Goal name</span>
            <input
              autoFocus={!focusOwner && !focusParent}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="What do you want to achieve?"
              maxLength={300}
              aria-invalid={fieldError.title ? true : undefined}
              className="h-9 rounded-md border border-line bg-raised px-3 text-base font-normal text-ink focus:border-brand focus:outline-none"
            />
            {fieldError.title ? <span className="text-sm font-normal text-danger-text">{fieldError.title}</span> : null}
          </label>

          {mayAssign ? (
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Owner</span>
              <PeoplePickerField
                ariaLabel="Owner"
                value={owner ? [owner.id] : []}
                people={owner ? [owner] : []}
                placeholder="No owner"
                onChange={(_ids, picked) => { setOwner(picked[0] ?? null); setOwnerTouched(true); }}
              />
            </div>
          ) : null}

          {mayAssign ? (
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Level</span>
              <SegmentedControl label="Level" value={selLevel} options={LEVEL_OPTIONS} onChange={(v) => setSelLevel(v)} />
            </div>
          ) : null}

          <div className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Part of <span className="font-normal text-ink-2">(optional)</span></span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setParentOpen((x) => !x)}
                aria-haspopup="listbox"
                aria-expanded={parentOpen}
                autoFocus={focusParent}
                className="inline-flex h-9 w-full items-center rounded-md border border-line bg-raised px-3 text-start text-base font-normal text-ink"
              >
                <span className={parentTitle ? "truncate" : "text-ink-3"}>{parentTitle ?? "Not part of another goal"}</span>
              </button>
              <Picker
                open={parentOpen}
                onClose={() => setParentOpen(false)}
                ariaLabel="Part of"
                selected={parentId ?? "__none__"}
                searchPlaceholder="Search goals"
                loading={parents === null}
                emptyLabel="No goals one level up yet"
                sections={[{
                  options: [
                    { value: "__none__", label: "Not part of another goal" },
                    ...(parents ?? []).map((p) => ({ value: p.id, label: p.title, hint: LEVEL_WORD[p.level] })),
                  ],
                }]}
                onSelect={(v) => { setParentOpen(false); setParentId(v === "__none__" ? null : v); }}
                className="absolute start-0 top-10 z-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Start date</span>
              <DateField value={startDate} onChange={setStartDate} ariaLabel="Start date" placeholder="No start date" />
            </div>
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Due date</span>
              <DateField value={endDate} onChange={setEndDate} ariaLabel="Due date" allowClear={false} />
              {fieldError.endDate ? <span className="text-sm font-normal text-danger-text">{fieldError.endDate}</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Check-ins</span>
            <SegmentedControl label="Check-ins" value={cadence} options={CADENCE_OPTIONS} onChange={(v) => setCadence(v)} />
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              className="rounded-md border border-line bg-raised px-3 py-2 text-base font-normal text-ink focus:border-brand focus:outline-none"
            />
          </label>

          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => void tryClose()}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (isEdit ? "Saving" : "Creating") : isEdit ? "Save changes" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
