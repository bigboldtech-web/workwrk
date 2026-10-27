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
// 32px (toggleChipClass), a holiday a row with its date as the hint, and
// "Holidays" the card's 13/500 sub-heading. For someone who cannot change it
// each row shows its value as text where the control would be. The load, the
// one PUT, its retry, the dirty guard and "Save work week" are unchanged.

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { toggleChipClass } from "@/components/layout/os/page-header/page-header";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { formatHm } from "@/lib/time-format";
import { useFormat } from "@/lib/format/use-date-prefs";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn } from "@/components/settings/settings-form";
import {
  WORK_SCHEDULE_DEFAULTS,
  expectedWeekHours,
  parseWorkSchedule,
  type Holiday,
  type WorkSchedule,
  type Weekday,
} from "@/lib/work-schedule";

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

export const WORK_WEEK_DESCRIPTION =
  "Which days the organization works, how long a work day is, and the days it is closed. Timesheets measures a week against this, and the Workload grid draws its capacity from it.";

function sameSchedule(a: WorkSchedule, b: WorkSchedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function WorkWeekCard() {
  const fmt = useFormat();
  const { toast } = useOsToast();
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [saved, setSaved] = useState<WorkSchedule | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newHoliday, setNewHoliday] = useState<{ date: string | null; name: string }>({ date: null, name: "" });

  const load = useCallback(async () => {
    const r = await apiFetch<Record<string, unknown>>("/api/organization/work-schedule");
    if (!r.ok) {
      // The reader tolerates the table being absent for a release, so a
      // failure here is a real one and is shown rather than swallowed.
      setSchedule(WORK_SCHEDULE_DEFAULTS);
      setSaved(WORK_SCHEDULE_DEFAULTS);
      setError(r.error);
      return;
    }
    const raw = r.data as Record<string, unknown>;
    const d = (raw.data ?? raw) as { schedule?: unknown; canEdit?: boolean };
    const next = parseWorkSchedule(d.schedule);
    setSchedule(next);
    setSaved(next);
    setCanEdit(Boolean(d.canEdit));
    setError(null);
  }, []);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  async function save(): Promise<boolean> {
    if (!schedule) return true;
    setSaving(true);
    setError(null);
    const r = await apiFetchWithRetry<Record<string, unknown>>(
      "/api/organization/work-schedule",
      { method: "PUT", json: schedule, keepalive: true },
      { attempts: 2, retryWrites: false },
    );
    setSaving(false);
    if (!r.ok) {
      // The typed schedule stays on screen. The server's own sentence when
      // there is one: only it can say the SQL file has not been applied.
      setError(r.error);
      return false;
    }
    setSaved(schedule);
    toast("Working calendar saved");
    // The Timesheets week card and the Workload grid both read this.
    window.dispatchEvent(new CustomEvent("workwrk:work-schedule-changed"));
    return true;
  }

  // The card's own unsaved edits ask "Save your changes?" on the way out,
  // like every Save-bar section (settings spec 1.5).
  useDirtyGuard(schedule !== null && saved !== null && !sameSchedule(schedule, saved), { onSave: save, id: "work-week" });

  if (schedule === null) return <WorkWeekLoading />;

  const dirty = saved !== null && !sameSchedule(schedule, saved);

  const setDay = (d: Weekday, on: boolean) => {
    setSchedule((s) => (s ? {
      ...s,
      workdays: (on ? [...s.workdays, d] : s.workdays.filter((x) => x !== d))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b) as Weekday[],
    } : s));
  };

  const addHoliday = () => {
    if (!newHoliday.date) return;
    setSchedule((s) => {
      if (!s) return s;
      if (s.holidays.some((h) => h.date === newHoliday.date)) return s;
      const next: Holiday = { date: newHoliday.date!, name: newHoliday.name.trim() || "Holiday" };
      return { ...s, holidays: [...s.holidays, next].sort((a, b) => (a.date < b.date ? -1 : 1)) };
    });
    setNewHoliday({ date: null, name: "" });
  };

  return (
    <WorkWeekView
      schedule={schedule}
      canEdit={canEdit}
      error={error}
      dirty={dirty}
      saving={saving}
      newHoliday={newHoliday}
      wallDate={fmt.wallDate}
      onDay={setDay}
      onHours={(n) => setSchedule((s) => (s ? { ...s, hoursPerDay: Number.isFinite(n) && n > 0 && n <= 24 ? n : s.hoursPerDay } : s))}
      onRemoveHoliday={(date) => setSchedule((s) => (s ? { ...s, holidays: s.holidays.filter((x) => x.date !== date) } : s))}
      onNewHoliday={setNewHoliday}
      onAddHoliday={addHoliday}
      onSave={() => { void save(); }}
    />
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
  error,
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
}: {
  schedule: WorkSchedule;
  canEdit: boolean;
  error: string | null;
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
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
          <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onSave} className="h-7 rounded-md border border-line-strong px-2.5 text-sm font-medium text-ink hover:bg-hover">
            Retry
          </button>
        </div>
      ) : null}

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
                  // one blue button is Save changes).
                  <button key={d.value} type="button" aria-pressed={on} onClick={() => onDay(d.value, !on)} className={toggleChipClass(on)}>
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
          label="Hours in a work day"
          helper={fullWeek}
          helperId="locale-hours-hint"
          control={canEdit ? (
            <span className="inline-flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                max={24}
                step={0.5}
                value={schedule.hoursPerDay}
                aria-label="Hours in a work day"
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
                  <button type="button" aria-label={`Remove ${h.name}`} onClick={() => onRemoveHoliday(h.date)} className={btn.ghost}>
                    Remove
                  </button>
                ) : undefined}
              />
            ))}
          </div>
        )}

        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DateField
              value={newHoliday.date}
              onChange={(v) => onNewHoliday({ ...newHoliday, date: v })}
              allowClear={false}
              ariaLabel="Holiday date"
              placeholder="Pick a day"
              className="w-[190px]"
            />
            <input
              type="text"
              value={newHoliday.name}
              onChange={(e) => onNewHoliday({ ...newHoliday, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddHoliday(); } }}
              placeholder="What is it called?"
              aria-label="Holiday name"
              className="h-9 min-w-[160px] max-w-[280px] flex-1 rounded-md border border-line-strong bg-raised px-3 text-base text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
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
