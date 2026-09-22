"use client";

// useWorkSchedule: the organization's working calendar, for client surfaces.
//
// One GET /api/organization/work-schedule per mount. No poll: a working
// calendar changes a few times a year, and the two surfaces that read it
// (the Workload grid, the Timesheets week card) remount often enough.
//
// IT NEVER RETURNS UNDEFINED, and that matters more than it looks: the
// callers colour capacity cells with it on their FIRST render, before any
// fetch resolves. Starting from WORK_SCHEDULE_DEFAULTS means the grid paints
// the Monday-to-Friday eight-hour shape it painted before this file existed,
// and then settles onto the company's real one. A `null` first value would
// make every cell flash zero capacity.
//
// `loaded` is there for the one caller that wants to say "following the
// company calendar (7.5h)" only once it knows the number is the real one.

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { parseWorkSchedule, WORK_SCHEDULE_DEFAULTS, type WorkSchedule } from "@/lib/work-schedule";

export interface UseWorkSchedule {
  schedule: WorkSchedule;
  /** True once the server has answered, however it answered. */
  loaded: boolean;
  /** True when the organization has actually saved a calendar. */
  configured: boolean;
}

export function useWorkSchedule(): UseWorkSchedule {
  const [state, setState] = useState<UseWorkSchedule>({
    schedule: WORK_SCHEDULE_DEFAULTS,
    loaded: false,
    configured: false,
  });

  useEffect(() => {
    let live = true;
    const run = async () => {
      const r = await apiFetch<{ schedule: unknown; configured?: boolean }>("/api/organization/work-schedule");
      if (!live) return;
      // A failure is not an error state here. The endpoint answers the
      // defaults when the table is absent, so the only way to land in this
      // branch is a network fault, and the right behaviour for a capacity
      // grid then is the shape it already has.
      setState({
        schedule: r.ok ? parseWorkSchedule(r.data.schedule) : WORK_SCHEDULE_DEFAULTS,
        loaded: true,
        configured: r.ok ? r.data.configured === true : false,
      });
    };
    void run();
    // Still no poll. The one moment the calendar CAN change under an open
    // tab is the settings card saving it, and that says so, so a Timesheets
    // tab beside it does not go on measuring weeks against the old number.
    const onChanged = () => { void run(); };
    window.addEventListener("workwrk:work-schedule-changed", onChanged);
    return () => {
      live = false;
      window.removeEventListener("workwrk:work-schedule-changed", onChanged);
    };
  }, []);

  return state;
}
