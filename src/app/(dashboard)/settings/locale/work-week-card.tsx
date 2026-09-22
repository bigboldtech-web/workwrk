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

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CircleAlert, Plus, X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { formatHm } from "@/lib/time-format";
import {
  WORK_SCHEDULE_DEFAULTS,
  expectedWeekHours,
  parseWorkSchedule,
  type Holiday,
  type WorkSchedule,
  type Weekday,
} from "@/lib/work-schedule";

/** Monday first, which is how every other week in this product is drawn. */
const DAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function sameSchedule(a: WorkSchedule, b: WorkSchedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function WorkWeekCard() {
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

  async function save() {
    if (!schedule) return;
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
      return;
    }
    setSaved(schedule);
    toast("Working calendar saved");
    // The Timesheets week card and the Workload grid both read this.
    window.dispatchEvent(new CustomEvent("workwrk:work-schedule-changed"));
  }

  if (schedule === null) {
    return (
      <section className="mt-6 max-w-xl rounded-lg border border-line bg-raised p-5">
        <span className="inline-block h-5 w-40 rounded bg-skeleton os-skeleton-pulse" />
        <span className="sr-only">Loading the working calendar</span>
      </section>
    );
  }

  const dirty = saved !== null && !sameSchedule(schedule, saved);
  // A full Monday at the current settings, so the admin can see what the
  // numbers mean before saving them.
  const weekHours = expectedWeekHours(schedule, new Date(2026, 0, 5));

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
    <section className="mt-6 max-w-xl rounded-lg border border-line bg-raised p-5">
      <header className="mb-1 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
        <h2 className="text-base font-semibold text-ink">Work week</h2>
      </header>
      <p className="mb-4 text-base text-ink-2">
        Which days the organization works, how long a work day is, and the days it is closed.
        Timesheets measures a week against this, and the Workload grid draws its capacity from it.
        {canEdit ? "" : " You need Owner or Admin access to change it."}
      </p>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger-solid bg-danger-soft px-3 py-2 text-base text-ink">
          <CircleAlert className="h-4 w-4 shrink-0 text-danger-solid" strokeWidth={1.5} aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => { void save(); }} className="h-7 rounded-md border border-line-strong px-2.5 text-sm font-medium text-ink hover:bg-hover">
            Retry
          </button>
        </div>
      ) : null}

      {canEdit ? (
        <>
          <div className="mb-4">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const on = schedule.workdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDay(d.value, !on)}
                    className={on
                      ? "h-9 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover"
                      : "h-9 rounded-md border border-line-strong bg-raised px-3 text-base text-ink-2 hover:bg-hover hover:text-ink"}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Hours in a work day</span>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={schedule.hoursPerDay}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSchedule((s) => (s ? { ...s, hoursPerDay: Number.isFinite(n) && n > 0 && n <= 24 ? n : s.hoursPerDay } : s));
              }}
              className="h-9 w-28 rounded-md border border-line-strong bg-raised px-2 text-base tabular-nums text-ink outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
            <span className="ms-2 text-base text-ink-3">
              a full week is {formatHm(Math.round(weekHours * 60))}
            </span>
          </label>
        </>
      ) : (
        <dl className="mb-4 grid grid-cols-[140px_1fr] gap-y-1.5 text-base">
          <dt className="text-ink-2">Working days</dt>
          <dd className="text-ink">
            {schedule.workdays.length === 0
              ? "No fixed days"
              : DAYS.filter((d) => schedule.workdays.includes(d.value)).map((d) => d.label).join(", ")}
          </dd>
          <dt className="text-ink-2">Hours a day</dt>
          <dd className="tabular-nums text-ink">{formatHm(Math.round(schedule.hoursPerDay * 60))}</dd>
          <dt className="text-ink-2">A full week</dt>
          <dd className="tabular-nums text-ink">{formatHm(Math.round(weekHours * 60))}</dd>
        </dl>
      )}

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Holidays</span>
        {schedule.holidays.length === 0 ? (
          <p className="text-base text-ink-3">No holidays yet.</p>
        ) : (
          <ul className="mb-2 flex flex-col gap-1">
            {schedule.holidays.map((h) => (
              <li key={h.date} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-base text-ink hover:bg-hover">
                <span className="w-[110px] shrink-0 tabular-nums text-ink-2">{h.date}</span>
                <span className="min-w-0 flex-1 truncate" title={h.name}>{h.name}</span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove ${h.name}`}
                    onClick={() => setSchedule((s) => (s ? { ...s, holidays: s.holidays.filter((x) => x.date !== h.date) } : s))}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-danger-solid"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DateField
              value={newHoliday.date}
              onChange={(v) => setNewHoliday((h) => ({ ...h, date: v }))}
              allowClear={false}
              ariaLabel="Holiday date"
              placeholder="Pick a day"
              className="w-[190px]"
            />
            <input
              type="text"
              value={newHoliday.name}
              onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHoliday(); } }}
              placeholder="What is it called?"
              aria-label="Holiday name"
              className="h-9 min-w-[160px] flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
            />
            <button
              type="button"
              onClick={addHoliday}
              disabled={!newHoliday.date}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-base font-medium text-ink hover:bg-hover disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> Add
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={!dirty || saving}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {saving ? <Dots variant="pending" /> : null}
            Save work week
          </button>
          {dirty && !saving ? <span className="text-base text-ink-3">Unsaved changes</span> : null}
        </div>
      ) : null}
    </section>
  );
}
