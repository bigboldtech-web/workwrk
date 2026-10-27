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
//
// REPEATING GOALS (docs/plans/recurring-goals.md A2 to A5), only while the
// RECURRING_GOALS switch is on (the server says so: the list call's
// `recurringGoals`, or the caller's `recurring`): a Goal type control, One
// time or Repeating. One time keeps Start date and the required Due date.
// Repeating renders NO Due date field and saves without one: Repeats every
// (Week, Month, Quarter, Year) with the line saying what will happen, Starts
// (this period while half of it remains, else the next; each choice names
// its dates and the current one what is left) and Ends (Never, or the last
// period). The old Check-ins reads "Remind the owner to check in", hidden in
// edit when every target is measured automatically. In edit: a change of
// Repeats every says when it takes effect, moving Starts later says what it
// leaves behind, and making a one-time goal repeat offers "October starts
// at: 0 or What was added since 1 Oct". The rules and words are
// src/lib/goals/goal-form.ts; the server checks every choice again.
// With the switch off, the modal is exactly what it was, except that a goal
// that already repeats keeps its Repeats and Ends rather than growing a Due
// date the save would refuse.

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
import { PickerSelect } from "@/components/settings/picker-select";
import { legacyIsHrAdminLevel, legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { apiFetch } from "@/lib/api-fetch";
import type { PersonRef } from "@/components/board-view/assignee-picker";
import { isGoalCadence, nominalLastDayKey, periodDatesLabel, periodFor, type GoalCadence, type PeriodSettings } from "@/lib/goals/goal-period";
import {
  GOAL_TYPE_OPTIONS,
  REPEAT_OPTIONS,
  cadenceChangeLine,
  endChoices,
  freshLine,
  goalDatesPayload,
  periodOfKey,
  reminderFor,
  reminderOptions,
  repeatAdverb,
  shortDay,
  startChoices,
  validateGoalDates,
  type GoalType,
  type ReminderCadence,
  type SavedRepeat,
} from "@/lib/goals/goal-form";

export type GoalLevel = "COMPANY" | "DEPARTMENT" | "INDIVIDUAL";

const LEVEL_OPTIONS: { value: GoalLevel; label: string }[] = [
  { value: "COMPANY", label: "Company" },
  { value: "DEPARTMENT", label: "Department" },
  { value: "INDIVIDUAL", label: "Individual" },
];

// "NONE" silences the check-in reminder cron (src/app/api/cron/okr-reminders)
// for this one goal: a first-class opt-out, not a hidden sentinel. The
// choices are goal-form.ts reminderOptions (None reads Off with the switch on).
type Cadence = ReminderCadence;

/** The switch and the workspace's period settings, as the server answered them. */
export interface RepeatContext {
  on: boolean;
  settings: PeriodSettings | null;
}

/** GET /api/okrs/[id]?edit=1 `repeatEdit` (src/lib/goals/goal-period-view.server.ts), as JSON. */
interface RepeatEditJson {
  settings: PeriodSettings;
  current: { key: string; cadence: string; startsAt: string; endsAt: string; label: string; nominalLastDay: string; status: string } | null;
  startsEditable: boolean;
  firstKey: string | null;
  firstLabel: string | null;
  firstCheckIns: number;
  closedCount: number;
  kpiLinked: boolean;
  allAutomatic: boolean;
  conversion: Partial<Record<GoalCadence, { periodKey: string; periodName: string; startDay: string; targets: Array<{ title: string; unit: string | null; now: number; atStart: number; atStartDay: string; startValue: number }> }>>;
}

const KPI_WEEKLY = "A KPI is recorded monthly. Use it on a monthly, quarterly or yearly goal.";
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

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
  /** A repeating goal's cadence (A1), or null for one time. */
  repeat?: string | null;
  /** Its Ends: the last period's nominal last day, or null for Never. */
  repeatUntil?: string | null;
  completedAt?: string | null;
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
  /** The RECURRING_GOALS switch and the period settings, when the caller has them; else the modal reads them from its own list call. */
  recurring?: RepeatContext | null;
  /** Open with Repeating chosen at this cadence (A5, "Make this a monthly goal"). */
  initialRepeat?: GoalCadence | null;
}

// A parent is offered when the save will take it (mayLinkUnderGoal in
// src/lib/goals/goal-rights.ts): the list row's canEdit, or, for a
// Department goal under a Company goal, its canLinkTeamGoals (someone who
// manages people lines their team's goal up under the company's).
type ParentOption = { id: string; title: string; level: GoalLevel; canEdit: boolean; canLinkTeamGoals: boolean };
function attachable(p: ParentOption, childLevel: GoalLevel): boolean {
  return p.canEdit || (p.level === "COMPANY" && childLevel === "DEPARTMENT" && p.canLinkTeamGoals);
}

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

export function CreateGoalModal({ open, level, goal, focusOwner, focusParent, initialOwner, onClose, onSaved, recurring, initialRepeat }: CreateGoalModalProps) {
  const isEdit = Boolean(goal);
  const { data: session } = useSession();
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel ?? "";
  // The one shared ladder: exactly the isManager() tier POST and PATCH
  // /api/okrs ask before they accept an owner or a non-Individual level, so
  // the modal never offers a choice the save would silently drop.
  const mayAssign = legacyIsManagerLevel(accessLevel);
  const myId = (session?.user as { id?: string } | undefined)?.id ?? null;
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
  // The server's own Company-goal right (the People team list included),
  // read from the same list call; null until it answers.
  const [mayMakeCompany, setMayMakeCompany] = useState<boolean | null>(null);
  const [startDate, setStartDate] = useState<string | null>(toDateInput(goal?.startDate));
  const [endDate, setEndDate] = useState<string | null>(toDateInput(goal?.endDate));
  const [cadence, setCadence] = useState<Cadence>(
    goal?.checkInCadence === "BIWEEKLY" || goal?.checkInCadence === "MONTHLY" || goal?.checkInCadence === "NONE"
      ? goal.checkInCadence
      : "WEEKLY",
  );
  // Repeating goals (A2, A3). The switch and the period settings come from
  // the caller or from the list call below; an edit also reads repeatEdit.
  const savedRepeat: GoalCadence | null = isGoalCadence(goal?.repeat) ? goal.repeat : null;
  const [fetchedRecurring, setFetchedRecurring] = useState<RepeatContext | null>(null);
  const [editFacts, setEditFacts] = useState<RepeatEditJson | null>(null);
  const ctxRecurring = recurring ?? fetchedRecurring;
  const recurringOn = ctxRecurring?.on === true;
  const settings: PeriodSettings | null = ctxRecurring?.settings ?? editFacts?.settings ?? null;
  const [now] = useState(() => new Date());
  const [goalType, setGoalType] = useState<GoalType>(savedRepeat || initialRepeat ? "REPEATING" : "ONE_TIME");
  const [repeat, setRepeat] = useState<GoalCadence>(savedRepeat ?? initialRepeat ?? "MONTHLY");
  const [repeatStart, setRepeatStart] = useState<string | null>(null);
  const [repeatUntil, setRepeatUntil] = useState<string>(goal?.repeatUntil ?? "");
  const [firstPeriodStart, setFirstPeriodStart] = useState<"start" | "change">("start");
  // With the switch off a goal that already repeats keeps its Repeats and
  // Ends; nothing can make one repeat.
  const repeating = recurringOn ? goalType === "REPEATING" : savedRepeat != null;
  const showRepeatFields = recurringOn || savedRepeat != null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ title?: string; endDate?: string }>({});
  // A Company goal is edited only by Owner/Admin, the People team and its
  // own owner (src/lib/goals/goal-rights.ts), and POST and PATCH refuse to
  // make one the saver could not then fix. Say so before the save, not after.
  const companyBlocked = mayAssign && selLevel === "COMPANY" && goal?.level !== "COMPANY" &&
    !(mayMakeCompany ?? legacyIsHrAdminLevel(accessLevel)) && (!owner || owner.id !== myId);

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
      const all: Array<{ id: string; title: string; level: GoalLevel; canEdit?: boolean; canLinkTeamGoals?: boolean }> = [];
      let company: boolean | null = null;
      for (let page = 1; page <= 200; page += 1) {
        const qs = new URLSearchParams({ page: String(page), pageSize: "100", level: parentLevels.join(","), sort: "name" });
        const r = await apiFetch<{ data: Array<{ id: string; title: string; level: GoalLevel; canEdit?: boolean; canLinkTeamGoals?: boolean }>; pagination?: { total: number }; mayMakeCompanyGoals?: boolean; recurringGoals?: boolean; periodSettings?: PeriodSettings }>(`/api/okrs?${qs}`, { cache: "no-store" });
        if (!live) return;
        if (!r.ok) break;
        if (company === null && typeof r.data.mayMakeCompanyGoals === "boolean") company = r.data.mayMakeCompanyGoals;
        if (page === 1) setFetchedRecurring({ on: r.data.recurringGoals === true, settings: r.data.periodSettings ?? null });
        all.push(...(r.data.data ?? []));
        const total = r.data.pagination?.total ?? all.length;
        if ((r.data.data ?? []).length === 0 || all.length >= total) break;
      }
      if (!live) return;
      setParents(all.filter((g) => g.id !== goal?.id).map((g) => ({ id: g.id, title: g.title, level: g.level, canEdit: g.canEdit === true, canLinkTeamGoals: g.canLinkTeamGoals === true })));
      setMayMakeCompany(company);
    })();
    return () => { live = false; };
  }, [open, parentLevels, goal?.id]);
  const parentTitle = parents?.find((p) => p.id === parentId)?.title ?? (parentId ? "The current goal" : null);
  // Offered: the goals the save will accept, plus the goal this one is part
  // of today (kept readable by name and keepable even when the viewer can
  // no longer attach to it; the API only checks a changed parent).
  const parentChoices = (parents ?? []).filter((p) => attachable(p, selLevel) || p.id === goal?.parentId);
  // A parent picked for one level (a Company goal a Department goal may go
  // under) goes when the level changes to one it cannot take, before the
  // save is refused for it. The goal's own current parent is kept.
  const changeLevel = (next: GoalLevel) => {
    setSelLevel(next);
    if (!parents || !parentId || parentId === goal?.parentId) return;
    const p = parents.find((x) => x.id === parentId);
    if (p && !attachable(p, next)) setParentId(null);
  };
  // The why, shown only when goals one level up exist but none will take
  // this one (an org with none yet needs no explanation).
  const noAttachable = parents !== null && parents.length > 0 && !parents.some((p) => attachable(p, selLevel));

  // Edit: the current period, whether Starts may move, the conversion's
  // numbers (GET /api/okrs/[id]?edit=1), once the switch is known to be on
  // or the goal already repeats.
  const goalId = goal?.id ?? null;
  const wantFacts = open && goalId != null && (recurringOn || savedRepeat != null);
  useEffect(() => {
    if (!wantFacts || !goalId) return;
    let live = true;
    void apiFetch<{ repeatEdit?: RepeatEditJson }>(`/api/okrs/${encodeURIComponent(goalId)}?edit=1`, { cache: "no-store" }).then((r) => {
      if (live && r.ok && r.data.repeatEdit) setEditFacts(r.data.repeatEdit);
    });
    return () => { live = false; };
  }, [wantFacts, goalId]);

  const starts = useMemo(() => (settings ? startChoices(repeat, now, settings) : null), [settings, repeat, now]);
  // Starts may move on create, on a conversion, and while a repeating goal's
  // first period is the only one and still open (A3).
  // A change of Repeats every in edit takes effect at the next boundary
  // (the change line says when); Starts is not moved with it.
  const startsEditable = !savedRepeat || ((editFacts?.startsEditable ?? false) && repeat === savedRepeat);
  const savedFirstKey = savedRepeat ? editFacts?.firstKey ?? null : null;
  const startKey = repeatStart ?? (savedRepeat && savedRepeat === repeat ? savedFirstKey : null) ?? starts?.defaultKey ?? null;
  const startOptions = starts && startsEditable
    ? (startKey && !starts.options.some((o) => o.value === startKey) && settings
      ? [{ value: startKey, label: editFacts?.firstLabel ?? startKey, description: periodDatesLabel(periodOfKey(repeat, startKey, settings), settings) }, ...starts.options]
      : starts.options)
    : [];
  const startPeriod = settings && startKey ? periodOfKey(repeat, startKey, settings) : null;
  const current = editFacts?.current && isGoalCadence(editFacts.current.cadence)
    ? { key: editFacts.current.key, cadence: editFacts.current.cadence, startsAt: new Date(editFacts.current.startsAt), endsAt: new Date(editFacts.current.endsAt) }
    : null;
  const ends = useMemo(() => {
    if (!settings) return null;
    if (savedRepeat && current) return endChoices(repeat, periodFor(repeat, current.startsAt, settings), settings, now, { includeFrom: true, saved: goal?.repeatUntil ?? null });
    return startPeriod ? endChoices(repeat, startPeriod, settings, now, { includeFrom: false, saved: goal?.repeatUntil ?? null }) : null;
    // startPeriod is derived from startKey and repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, repeat, now, startKey, savedRepeat, current?.key, goal?.repeatUntil]);
  const changeLine = savedRepeat && current && editFacts?.current?.status === "OPEN" && settings && repeat !== savedRepeat
    ? cadenceChangeLine(current, repeat, settings, now)
    : null;
  const kpiBlocksWeekly = repeating && repeat === "WEEKLY" && editFacts?.kpiLinked === true;
  const movedStartLine = savedRepeat && startsEditable && editFacts && editFacts.firstCheckIns > 0 && savedFirstKey && repeatStart && repeatStart !== savedFirstKey && editFacts.firstLabel
    ? `${editFacts.firstLabel.replace(/ \d{4}$/, "")}'s ${editFacts.firstCheckIns === 1 ? "1 check-in stays" : `${editFacts.firstCheckIns} check-ins stay`} in Activity and won't count.`
    : null;
  // A3: a one-time goal made repeating from the current period, with an
  // up-counting target that moved since it began.
  const conversion = isEdit && !savedRepeat && repeating && starts && startKey === starts.options[0]?.value ? editFacts?.conversion?.[repeat] ?? null : null;
  const remindHidden = isEdit && editFacts?.allAutomatic === true;
  const reminderChoices = reminderOptions(repeating ? repeat : null, showRepeatFields);
  const chooseRepeat = (next: GoalCadence) => {
    setRepeat(next);
    setRepeatStart(null);
    setRepeatUntil(savedRepeat === next ? goal?.repeatUntil ?? "" : "");
    setCadence((c) => reminderFor(next, c));
  };
  const chooseStart = (key: string) => {
    setRepeatStart(key);
    // An Ends before the new Starts' period goes back to Never.
    if (repeatUntil && settings && repeatUntil < nominalLastDayKey(periodOfKey(repeat, key, settings), settings)) setRepeatUntil("");
  };

  const initial = useMemo(() => JSON.stringify({
    t: goal?.title ?? "", d: goal?.description ?? "", l: goal?.level ?? level, p: goal?.parentId ?? null,
    s: toDateInput(goal?.startDate), e: toDateInput(goal?.endDate), c: goal?.checkInCadence ?? "WEEKLY",
  }), [goal, level]);
  const repeatTouched = repeating !== (savedRepeat != null) || (repeating && (repeat !== (savedRepeat ?? repeat) || repeatStart != null || repeatUntil !== (goal?.repeatUntil ?? "")));
  const dirty = JSON.stringify({ t: title, d: description, l: selLevel, p: parentId, s: startDate, e: endDate, c: cadence }) !== initial || ownerTouched || (isEdit && repeatTouched) || (!isEdit && repeating);

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
    // A one-time goal needs a due date; a repeating one has none (A2).
    const type: GoalType = repeating ? "REPEATING" : "ONE_TIME";
    const dateErr = validateGoalDates({ type, startDate, endDate });
    if (dateErr.endDate) errs.endDate = dateErr.endDate;
    setFieldError(errs);
    if (errs.title || errs.endDate || companyBlocked || kpiBlocksWeekly) return;
    setSaving(true);
    setError(null);
    const saved: SavedRepeat | null = isEdit
      ? { repeat: savedRepeat, repeatUntil: goal?.repeatUntil ?? null, firstKey: savedFirstKey, startsEditable }
      : null;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      level: mayAssign ? selLevel : isEdit ? goal!.level : "INDIVIDUAL",
      // Starts goes with a new repeating goal (its default included); a goal
      // that already repeats sends it only when the person picked one.
      ...goalDatesPayload({ type, startDate, endDate, repeat, repeatStart: !startsEditable ? null : savedRepeat ? repeatStart : startKey, repeatUntil, reminder: cadence, firstPeriodStart: conversion ? firstPeriodStart : "start" }, saved),
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
              <SegmentedControl label="Level" value={selLevel} options={LEVEL_OPTIONS} onChange={(v) => changeLevel(v)} />
              {companyBlocked ? (
                <span className="text-sm font-normal text-ink-2">
                  Only an Admin, the People team or the goal&apos;s owner can make a Company goal. Make yourself the owner, or ask an Admin.
                </span>
              ) : null}
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
                    ...parentChoices.map((p) => ({ value: p.id, label: p.title, hint: LEVEL_WORD[p.level] })),
                  ],
                }]}
                onSelect={(v) => { setParentOpen(false); setParentId(v === "__none__" ? null : v); }}
                className="absolute start-0 top-10 z-50"
              />
            </div>
            {noAttachable ? (
              <span className="text-sm font-normal text-ink-2">
                {selLevel === "DEPARTMENT"
                  ? "A Department goal goes under a goal you can edit, or under a Company goal when you manage people. To link it elsewhere, ask that goal's owner or your manager."
                  : "This goal goes under a goal you can edit. To link it to another goal, ask that goal's owner or your manager."}
              </span>
            ) : null}
          </div>

          {recurringOn ? (
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>Goal type</span>
              <SegmentedControl label="Goal type" value={goalType} options={GOAL_TYPE_OPTIONS} onChange={(v) => setGoalType(v)} />
              {conversion ? (
                <div className="mt-2 flex flex-col gap-1">
                  <span>{conversion.periodName} starts at</span>
                  <SegmentedControl
                    label={`${conversion.periodName} starts at`}
                    value={firstPeriodStart}
                    onChange={setFirstPeriodStart}
                    options={[
                      { value: "start", label: conversion.targets.every((t) => t.startValue === 0) ? "0" : "Start value" },
                      { value: "change", label: `What was added since ${shortDay(conversion.startDay)}` },
                    ]}
                  />
                  {conversion.targets.length === 1 ? (
                    <span className="text-sm font-normal text-ink-2">
                      Count {conversion.periodName} so far: {num(conversion.targets[0].now - conversion.targets[0].atStart)} ({num(conversion.targets[0].now)} now, {num(conversion.targets[0].atStart)} on {shortDay(conversion.targets[0].atStartDay)})
                    </span>
                  ) : conversion.targets.map((t) => (
                    <span key={t.title} className="text-sm font-normal text-ink-2">
                      {t.title}: {num(t.now - t.atStart)} so far ({num(t.now)} now, {num(t.atStart)} on {shortDay(t.atStartDay)})
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!repeating ? (
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
          ) : (
            <>
              <div className="flex flex-col gap-1 text-sm font-medium text-ink">
                <span>Repeats every</span>
                {recurringOn ? (
                  <SegmentedControl label="Repeats every" value={repeat} options={REPEAT_OPTIONS} onChange={chooseRepeat} />
                ) : (
                  <span className="text-base font-normal text-ink">Repeats {repeatAdverb(repeat)}</span>
                )}
                {kpiBlocksWeekly ? (
                  <span className="text-sm font-normal text-danger-text">{KPI_WEEKLY}</span>
                ) : settings ? (
                  <span className="text-sm font-normal text-ink-2">{changeLine ?? freshLine(repeat, settings)}</span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 text-sm font-medium text-ink">
                  <span>Starts</span>
                  {!settings ? (
                    <span className="h-9 rounded-md bg-skeleton os-skeleton-pulse" aria-hidden />
                  ) : startsEditable && recurringOn ? (
                    <PickerSelect label="Starts" value={startKey ?? ""} options={startOptions} onChange={chooseStart} align="start" width={300} className="w-full" noSearch />
                  ) : (
                    <span className="flex h-9 items-center text-base font-normal text-ink">{editFacts?.firstLabel ? `${editFacts.current ? "Started" : "Starts"} ${editFacts.firstLabel}` : ""}</span>
                  )}
                  {startPeriod && settings && startsEditable && recurringOn ? (
                    <span className="text-sm font-normal text-ink-2">{periodDatesLabel(startPeriod, settings)}</span>
                  ) : null}
                  {movedStartLine ? <span className="text-sm font-normal text-ink-2">{movedStartLine}</span> : null}
                </div>
                <div className="flex flex-col gap-1 text-sm font-medium text-ink">
                  <span>Ends</span>
                  {ends ? (
                    <PickerSelect label="Ends" value={repeatUntil} options={ends} onChange={setRepeatUntil} align="start" width={300} className="w-full" noSearch />
                  ) : (
                    <span className="h-9 rounded-md bg-skeleton os-skeleton-pulse" aria-hidden />
                  )}
                </div>
              </div>
            </>
          )}

          {remindHidden ? null : (
            <div className="flex flex-col gap-1 text-sm font-medium text-ink">
              <span>{showRepeatFields ? "Remind the owner to check in" : "Check-ins"}</span>
              <SegmentedControl label={showRepeatFields ? "Remind the owner to check in" : "Check-ins"} value={reminderFor(repeating ? repeat : null, cadence)} options={reminderChoices} onChange={(v) => setCadence(v)} />
            </div>
          )}

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
