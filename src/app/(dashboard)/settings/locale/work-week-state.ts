// The Work week card's state, as a reducer and two async steps, with no
// React in it, so what the card does on a failed read is tested as it runs
// (settings-cleanup Phase 5 review, H1).
//
// THE BUG THIS FILE EXISTS FOR. A failed GET used to fill the card with
// WORK_SCHEDULE_DEFAULTS as both what is shown and what was saved, and the
// error banner's Retry called SAVE: one press wrote Monday to Friday, eight
// hours, no zone and no holidays over the workspace's real week. Now:
//
//   - a failed read leaves `schedule` and `saved` as they were: empty on the
//     first load (the card draws ErrorState, whose Try again READS again),
//     or the last values the server really answered, never the defaults;
//   - the banner's Retry saves only after a failed SAVE; after a failed read
//     it reads again, and after a 409 it is Reload;
//   - nothing is written while nothing has been read (`saveWorkWeek` sends no
//     request), and every PUT carries `base`, the schedule last read, so the
//     route refuses (409) when the record is no longer that.

import { apiFetch, apiFetchWithRetry, type ApiResult } from "@/lib/api-fetch";
import { parseWorkSchedule, type WorkSchedule } from "@/lib/work-schedule";

export const WORK_SCHEDULE_URL = "/api/organization/work-schedule";

/** What went wrong last: a read, a save, or a save the record had moved under. */
export type WorkWeekProblem = { kind: "load" | "save" | "conflict"; message: string };

export interface WorkWeekState {
  /** What is on screen, edits included. Null until the server has answered once. */
  schedule: WorkSchedule | null;
  /** The record as last read from or written to the server. Null until then. */
  saved: WorkSchedule | null;
  canEdit: boolean;
  saving: boolean;
  problem: WorkWeekProblem | null;
}

export const WORK_WEEK_START: WorkWeekState = { schedule: null, saved: null, canEdit: false, saving: false, problem: null };

export type WorkWeekAction =
  | { type: "loadStarted" }
  | { type: "loaded"; schedule: WorkSchedule; canEdit: boolean }
  | { type: "loadFailed"; message: string }
  | { type: "edit"; update: (s: WorkSchedule) => WorkSchedule }
  | { type: "saveStarted" }
  | { type: "saved"; sent: WorkSchedule }
  | { type: "saveFailed"; message: string; conflict: boolean };

export function workWeekReducer(s: WorkWeekState, a: WorkWeekAction): WorkWeekState {
  switch (a.type) {
    case "loadStarted":
      // A read again (Try again, Reload): its own failure clears, the values stay.
      return s.problem?.kind === "load" || s.problem?.kind === "conflict" ? { ...s, problem: null } : s;
    case "loaded":
      return { ...s, schedule: a.schedule, saved: a.schedule, canEdit: a.canEdit, problem: null };
    case "loadFailed":
      // Never the defaults: what was on screen stays (null on a first load).
      return { ...s, problem: { kind: "load", message: a.message } };
    case "edit":
      return s.schedule ? { ...s, schedule: a.update(s.schedule) } : s;
    case "saveStarted":
      return { ...s, saving: true, problem: null };
    case "saved":
      return { ...s, saving: false, saved: a.sent };
    case "saveFailed":
      // The typed schedule stays on screen.
      return { ...s, saving: false, problem: { kind: a.conflict ? "conflict" : "save", message: a.message } };
  }
}

/** Whether there is something to save: a schedule read, then changed. */
export function workWeekDirty(s: WorkWeekState): boolean {
  return s.schedule !== null && s.saved !== null && JSON.stringify(s.schedule) !== JSON.stringify(s.saved);
}

/** What the problem banner's button does: save again only after a failed save; otherwise read again. */
export function workWeekRetry(problem: WorkWeekProblem): { label: "Retry" | "Reload"; does: "save" | "reload" } {
  if (problem.kind === "save") return { label: "Retry", does: "save" };
  return { label: problem.kind === "conflict" ? "Reload" : "Retry", does: "reload" };
}

type Get = () => Promise<ApiResult<unknown>>;
type Put = (body: WorkSchedule & { base: WorkSchedule }) => Promise<ApiResult<unknown>>;

const getSchedule: Get = () => apiFetch<unknown>(WORK_SCHEDULE_URL, { cache: "no-store" });
const putSchedule: Put = (body) =>
  apiFetchWithRetry<unknown>(WORK_SCHEDULE_URL, { method: "PUT", json: body, keepalive: true }, { attempts: 2, retryWrites: false });

/** One read. A failure is reported, and nothing on screen is replaced. */
export async function loadWorkWeek(dispatch: (a: WorkWeekAction) => void, get: Get = getSchedule): Promise<void> {
  const r = await get();
  if (!r.ok) {
    // The server's own sentence when there is one.
    dispatch({ type: "loadFailed", message: r.error });
    return;
  }
  const raw = (r.data ?? {}) as Record<string, unknown>;
  const d = (raw.data ?? raw) as { schedule?: unknown; canEdit?: boolean };
  dispatch({ type: "loaded", schedule: parseWorkSchedule(d.schedule), canEdit: Boolean(d.canEdit) });
}

/**
 * One save of what is on screen, over the record last read (`base`). With
 * nothing read there is nothing to save, and no request is sent. Resolves
 * false when the save failed (the dirty guard then keeps the person here).
 */
export async function saveWorkWeek(s: WorkWeekState, dispatch: (a: WorkWeekAction) => void, put: Put = putSchedule): Promise<boolean> {
  if (!s.schedule || !s.saved) return true;
  const sent = s.schedule;
  dispatch({ type: "saveStarted" });
  const r = await put({ ...sent, base: s.saved });
  if (!r.ok) {
    // The server's own sentence when there is one: only it can say the SQL
    // file has not been applied, or that the record moved.
    dispatch({ type: "saveFailed", message: r.error, conflict: r.status === 409 });
    return false;
  }
  dispatch({ type: "saved", sent });
  return true;
}
