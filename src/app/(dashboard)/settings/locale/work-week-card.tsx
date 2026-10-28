"use client";

// The organization's WORKING CALENDAR: which days are work days, how long a
// work day is, and the holidays that take a day out of it.
//
// Decided addition (b) of docs/plans/competitor-gap-2026-09.md section 7
// shipped the table, the API, the pure math, the client hook and BOTH
// consumers (the Workload grid's capacity columns and the Timesheets week
// card's expected hours) and no door: PUT /api/organization/work-schedule
// had no caller anywhere in src/app or src/components, so an Owner could
// only set the workweek with curl. This is the door.
//
// It lives on "Locale & work week" because that is the page the settings
// registry already names for it ("week start", "capacity" are its own search
// keywords), rather than inventing a settings page the IA does not have.
//
// A NON-ADMIN SEES THE VALUES, NOT DISABLED CONTROLS. GET is open to every
// member on purpose (knowing the company works Monday to Friday is not
// privileged) and the server answers `canEdit`, so this renders the schedule
// as plain text for anybody who cannot change it (access spec 5.4).
//
// THE SHARED ROWS AND CHIPS (settings-cleanup Phase 5, B5): Working days and
// Hours in a work day are SettingsRows, the days the toolbar's toggle chip at
// 32px (toggleChipClass, with the outlined state cue: a 1px ink border when
// on), a holiday a row with its date as the hint, and "Holidays" the card's
// 13/500 sub-heading. For someone who cannot change it each row shows its
// value as text where the control would be.
//
// A FAILED READ NEVER BECOMES A WEEK ON SCREEN (Phase 5 review, H1). The
// state lives in work-week-state.ts: a failed first read draws ErrorState,
// whose Try again reads again; the banner's Retry saves only after a failed
// save; and every save carries the schedule it was made over, so the route
// refuses one the record has moved under.

import { useCallback, useEffect, useReducer, useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { toggleChipClass } from "@/components/layout/os/page-header/page-header";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { formatHm } from "@/lib/time-format";
import { useFormat } from "@/lib/format/use-date-prefs";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn } from "@/components/settings/settings-form";
import {
  expectedWeekHours,
  type Holiday,
  type WorkSchedule,
  type Weekday,
} from "@/lib/work-schedule";
import {
  WORK_WEEK_START,
  loadWorkWeek,
  saveWorkWeek,
  workWeekDirty,
  workWeekReducer,
  workWeekRetry,
  type WorkWeekProblem,
} from "./work-week-state";

/** Monday first, which is how every other week in this product is drawn. */
export const WORK_DAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

// Plain words for what reads it (final Settings review, L5).
export const WORK_WEEK_DESCRIPTION =
  "Which days the organization works, how long a work day is, and the days it is closed. Timesheets and Workload count a full week from it.";

/** The Hours input's id, for the row's <label htmlFor> (Phase 5 review, L4). */
export const HOURS_INPUT_ID = "locale-hours-input";
/** The new holiday's name input, for its visible label. */
const HOLIDAY_NAME_ID = "locale-holiday-name";

export function WorkWeekCard() {
  const fmt = useFormat();
  const { toast } = useOsToast();
  const [state, dispatch] = useReducer(workWeekReducer, WORK_WEEK_START);
  const [newHoliday, setNewHoliday] = useState<{ date: string | null; name: string }>({ date: null, name: "" });

  const load = useCallback(() => loadWorkWeek(dispatch), []);
  // Try again and Reload: read again, never save.
  const reload = useCallback(() => {
    dispatch({ type: "loadStarted" });
    void load();
  }, [load]);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  async function save(): Promise<boolean> {
    const ok = await saveWorkWeek(state, dispatch);
    if (ok && state.schedule && state.saved) {
      toast("Working calendar saved");
      // The Timesheets week card and the Workload grid both read this.
      window.dispatchEvent(new CustomEvent("workwrk:work-schedule-changed"));
    }
    return ok;
  }

  const dirty = workWeekDirty(state);
  // The card's own unsaved edits ask "Save your changes?" on the way out,
  // like every Save-bar section (settings spec 1.5).
  useDirtyGuard(dirty, { onSave: save, id: "work-week" });

  const { schedule, canEdit, saving, problem } = state;
  if (schedule === null) {
    return problem ? <WorkWeekLoadFailed message={problem.message} onRetry={reload} /> : <WorkWeekLoading />;
  }

  const edit = (update: (s: WorkSchedule) => WorkSchedule) => dispatch({ type: "edit", update });

  const setDay = (d: Weekday, on: boolean) => {
    edit((s) => ({
      ...s,
      workdays: (on ? [...s.workdays, d] : s.workdays.filter((x) => x !== d))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b) as Weekday[],
    }));
  };

  const addHoliday = () => {
    if (!newHoliday.date) return;
    const next: Holiday = { date: newHoliday.date, name: newHoliday.name.trim() || "Holiday" };
    edit((s) => (s.holidays.some((h) => h.date === next.date)
      ? s
      : { ...s, holidays: [...s.holidays, next].sort((a, b) => (a.date < b.date ? -1 : 1)) }));
    setNewHoliday({ date: null, name: "" });
  };

  return (
    <WorkWeekView
      schedule={schedule}
      canEdit={canEdit}
      problem={problem}
      dirty={dirty}
      saving={saving}
      newHoliday={newHoliday}
      wallDate={fmt.wallDate}
      onDay={setDay}
      onHours={(n) => edit((s) => ({ ...s, hoursPerDay: Number.isFinite(n) && n > 0 && n <= 24 ? n : s.hoursPerDay }))}
      onRemoveHoliday={(date) => edit((s) => ({ ...s, holidays: s.holidays.filter((x) => x.date !== date) }))}
      onNewHoliday={setNewHoliday}
      onAddHoliday={addHoliday}
      onSave={() => { void save(); }}
      onReload={reload}
    />
  );
}

/**
 * The card when its first read failed: the same card, title and
 * description, over ErrorState, whose Try again reads again. No week is drawn,
 * so there is nothing to save (Phase 5 review, H1).
 */
export function WorkWeekLoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SettingsCard title="Work week" description={WORK_WEEK_DESCRIPTION}>
      <ErrorState compact what="the working calendar" hint={message} onRetry={onRetry} />
    </SettingsCard>
  );
}

/**
 * The card while the schedule loads: the same card, title and description
 * over skeleton rows, so the page does not change shape when it arrives.
 */
export function WorkWeekLoading() {
  return (
    <SettingsCard title="Work week" description={WORK_WEEK_DESCRIPTION}>
      <SkeletonRows rows={4} />
      <span className="sr-only">Loading the working calendar</span>
    </SettingsCard>
  );
}

/** A day list in words, Monday first ("Mon, Tue, Wed"); none is "No fixed days". */
export function workDaysWords(workdays: readonly Weekday[]): string {
  return workdays.length === 0 ? "No fixed days" : WORK_DAYS.filter((d) => workdays.includes(d.value)).map((d) => d.label).join(", ");
}

/** The Work week card, drawn from its state (exported for the tests). */
export function WorkWeekView({
  schedule,
  canEdit,
  problem,
  dirty,
  saving,
  newHoliday,
  wallDate,
  onDay,
  onHours,
  onRemoveHoliday,
  onNewHoliday,
  onAddHoliday,
  onSave,
  onReload,
}: {
  schedule: WorkSchedule;
  canEdit: boolean;
  /** The last failure: a read (Retry reads again), a save (Retry saves again), or a 409 (Reload). */
  problem: WorkWeekProblem | null;
  dirty: boolean;
  saving: boolean;
  newHoliday: { date: string | null; name: string };
  wallDate: (iso: string) => string;
  onDay: (d: Weekday, on: boolean) => void;
  onHours: (n: number) => void;
  onRemoveHoliday: (date: string) => void;
  onNewHoliday: (next: { date: string | null; name: string }) => void;
  onAddHoliday: () => void;
  onSave: () => void;
  onReload: () => void;
}) {
  // A full Monday at the current settings, so the admin can see what the
  // numbers mean before saving them.
  const weekHours = expectedWeekHours(schedule, new Date(2026, 0, 5));
  const fullWeek = `A full week is ${formatHm(Math.round(weekHours * 60))}`;

  return (
    <SettingsCard
      title="Work week"
      description={<>{WORK_WEEK_DESCRIPTION}{canEdit ? "" : " You need Owner or Admin access to change it."}</>}
    >
      {problem ? <WorkWeekProblemBanner problem={problem} onSave={onSave} onReload={onReload} /> : null}

      <div>
        <SettingsRow
          id="locale.workDays"
          label={<span id="locale-workdays-label">Working days</span>}
          control={canEdit ? (
            <span role="group" aria-labelledby="locale-workdays-label" className="flex flex-wrap gap-1">
              {WORK_DAYS.map((d) => {
                const on = schedule.workdays.includes(d.value);
                return (
                  // A day toggle, not a button to press on: a pressed day is
                  // the toggle chip's pressed state (no blue fill; the page's
                  // one blue button is Save changes), outlined so on and off
                  // differ by more than a pale fill, hovered or not (Phase 5
                  // review, M1).
                  <button key={d.value} type="button" aria-pressed={on} onClick={() => onDay(d.value, !on)} className={toggleChipClass(on, { outlined: true })}>
                    {d.label}
                  </button>
                );
              })}
            </span>
          ) : undefined}
          readOnlyValue={canEdit ? undefined : workDaysWords(schedule.workdays)}
        />
        <SettingsRow
          id="locale.hoursPerDay"
          // A click on the words puts the caret in the field (Phase 5 review, L4).
          label={canEdit ? <label htmlFor={HOURS_INPUT_ID}>Hours in a work day</label> : "Hours in a work day"}
          helper={fullWeek}
          helperId="locale-hours-hint"
          control={canEdit ? (
            <span className="inline-flex items-center gap-2">
              <input
                id={HOURS_INPUT_ID}
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={schedule.hoursPerDay}
                aria-describedby="locale-hours-hint"
                onChange={(e) => onHours(Number(e.target.value))}
                className="h-9 w-24 rounded-md border border-line-strong bg-raised px-3 text-base tabular-nums text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
              />
              <span className="text-base text-ink-2">hours</span>
            </span>
          ) : undefined}
          readOnlyValue={canEdit ? undefined : <span className="tabular-nums">{formatHm(Math.round(schedule.hoursPerDay * 60))}</span>}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">Holidays</h3>
        {schedule.holidays.length === 0 ? (
          <p className="mt-1 text-base text-ink-2">No holidays yet.</p>
        ) : (
          <div className="mt-1">
            {schedule.holidays.map((h) => (
              <SettingsRow
                key={h.date}
                label={<span className="block truncate" title={h.name}>{h.name}</span>}
                helper={<span className="tabular-nums">{wallDate(h.date)}</span>}
                // A worded ghost button, so on a phone, where the row stacks,
                // it lines up under the name (GHOST_MARK) instead of an icon
                // floating alone; its name starts with the word it shows.
                control={canEdit ? (
                  // Named with its date too, so two holidays that share a name are told apart (Phase 5 review, L7).
                  <button type="button" aria-label={`Remove ${h.name}, ${wallDate(h.date)}`} onClick={() => onRemoveHoliday(h.date)} className={btn.ghost}>
                    Remove
                  </button>
                ) : undefined}
              />
            ))}
          </div>
        )}

        {canEdit ? (
          // Each field has a visible label above it (final Settings review,
          // L2): the name's placeholder, in ink-3, was its only label.
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Date</span>
              <DateField
                value={newHoliday.date}
                onChange={(v) => onNewHoliday({ ...newHoliday, date: v })}
                allowClear={false}
                ariaLabel="Holiday date"
                placeholder="Pick a day"
                className="w-[190px]"
              />
            </div>
            <div className="flex min-w-[160px] max-w-[280px] flex-1 flex-col gap-1.5">
              <label htmlFor={HOLIDAY_NAME_ID} className="text-sm font-medium text-ink">Name</label>
              <input
                id={HOLIDAY_NAME_ID}
                type="text"
                value={newHoliday.name}
                onChange={(e) => onNewHoliday({ ...newHoliday, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddHoliday(); } }}
                placeholder="What is it called?"
                aria-label="Holiday name"
                className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
              />
            </div>
            <button
              type="button"
              onClick={onAddHoliday}
              disabled={!newHoliday.date}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:cursor-default disabled:text-ink-4 disabled:hover:bg-raised"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add
            </button>
          </div>
        ) : null}
      </div>

      {/* Its own record and its own save, shown only while there is
          something to save, as a secondary button: the page's one blue
          button is the Save bar above. */}
      {canEdit && dirty ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50"
          >
            {saving ? <Dots variant="pending" /> : null}
            Save work week
          </button>
          <span className="text-base text-ink-2">Unsaved changes</span>
        </div>
      ) : null}
    </SettingsCard>
  );
}

/**
 * The card's problem line: the server's sentence and one button. Retry SAVES
 * only after a failed save; after a failed read it reads again, and after a
 * 409 it is Reload (workWeekRetry).
 */
export function WorkWeekProblemBanner({ problem, onSave, onReload }: { problem: WorkWeekProblem; onSave: () => void; onReload: () => void }) {
  const retry = workWeekRetry(problem);
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
      <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
      <span className="flex-1">{problem.message}</span>
      <button type="button" onClick={retry.does === "save" ? onSave : onReload} className="h-7 rounded-md border border-line-strong px-2.5 text-sm font-medium text-ink hover:bg-hover">
        {retry.label}
      </button>
    </div>
  );
}
