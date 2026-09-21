// my-work-sprint.ts: the arithmetic behind My work's Sprint view.
//
// The retired /tasks/sprint page was a personal sprint room: a fortnight
// window, four KPI tiles, a burndown (ideal against actual), a pace verdict
// and an at-risk list. It ran on the legacy `Task` table; the rows are Items
// now and reach the page through `GET /api/me/work`, so the room is rebuilt
// over `MyWorkRow` and the maths lives here, pure, so it can be pinned by a
// test without a server.
//
// WHAT COUNTS AS THE SPRINT. There is no personal sprint object (Sprints are
// Lists, spec-spaces-lists). The window is the fortnight that started six
// days ago, exactly what the old page did, so a bookmark to /tasks/sprint
// lands on the same fortnight it always showed. A task is IN the sprint when
// its due date (or, undated, its start date) falls inside the window; done
// tasks without a date are out.
//
// WHAT BURNS. Items carry no estimate column, so every task weighs one, the
// same fallback the old page used when `estimateHours` was null. A done task
// burns on the day it was last updated: Items keep no `completedAt`, and the
// status write is the last thing that touches a finished task, so `updatedAt`
// is the closest honest signal. It is said in the chart's caption.

import type { MyWorkRow } from "./my-work";

export const SPRINT_DAYS = 14;
const MS_DAY = 86_400_000;

export interface SprintPoint {
  /** 0-based day index inside the sprint. */
  day: number;
  /** The date this point stands on, at local midnight. */
  at: Date;
  /** Work left if the sprint burned evenly: total at day 0, zero on the last day. */
  ideal: number;
  /** Work actually left at the end of this day; null for days still ahead. */
  actual: number | null;
}

export type SprintVerdictTone = "neutral" | "good" | "ok" | "bad";

export interface SprintVerdict {
  tone: SprintVerdictTone;
  label: "Planning" | "Ahead of pace" | "On track" | "Behind pace";
}

export interface SprintSummary {
  start: Date;
  end: Date;
  /** 1-based day of the sprint today sits on, clamped to 0..SPRINT_DAYS. */
  dayOf: number;
  /** Rows inside the window. */
  rows: MyWorkRow[];
  total: number;
  done: number;
  completionPct: number;
  points: SprintPoint[];
  verdict: SprintVerdict;
  /** Open rows that are past due, or high-priority with nobody on them. */
  atRisk: MyWorkRow[];
  /** Open rows in the window with nobody assigned. */
  unassigned: MyWorkRow[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The fortnight the old page showed: starts six days back, ends 14 days on. */
export function sprintWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = startOfDay(now);
  start.setDate(start.getDate() - 6);
  const end = new Date(start.getTime() + SPRINT_DAYS * MS_DAY);
  return { start, end };
}

/** The date that decides which day a row belongs to: due first, else start. */
function anchorDate(row: MyWorkRow): Date | null {
  const raw = row.dueAt ?? row.startAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isRowDone(row: MyWorkRow): boolean {
  if (!row.status) return false;
  if (row.doneStatus) return row.status === row.doneStatus;
  return ["done", "complete", "completed", "closed", "resolved"].includes(row.status.trim().toLowerCase());
}

export function sprintSummary(rows: readonly MyWorkRow[], now: Date = new Date()): SprintSummary {
  const { start, end } = sprintWindow(now);
  const today = startOfDay(now);
  const inWindow = rows.filter((r) => {
    const at = anchorDate(r);
    return at !== null && at.getTime() >= start.getTime() && at.getTime() < end.getTime();
  });

  const total = inWindow.length;
  const doneRows = inWindow.filter(isRowDone);
  const done = doneRows.length;
  const completionPct = total === 0 ? 0 : Math.round((done / total) * 100);

  // Day index of today, 1-based, clamped so a sprint viewed after its end
  // still reads "Day 14 of 14" and one viewed before it starts reads day 0.
  const dayOf = Math.max(0, Math.min(SPRINT_DAYS, Math.floor((today.getTime() - start.getTime()) / MS_DAY) + 1));

  const points: SprintPoint[] = [];
  for (let i = 0; i < SPRINT_DAYS; i++) {
    const at = new Date(start.getTime() + i * MS_DAY);
    const ideal = total * (1 - i / (SPRINT_DAYS - 1));
    let actual: number | null = null;
    if (i <= dayOf - 1) {
      const endOfThatDay = at.getTime() + MS_DAY - 1;
      const burnedByThen = doneRows.filter((r) => new Date(r.updatedAt).getTime() <= endOfThatDay).length;
      actual = total - burnedByThen;
    }
    points.push({ day: i, at, ideal, actual });
  }

  const verdict: SprintVerdict = (() => {
    if (total === 0 || dayOf === 0) return { tone: "neutral", label: "Planning" };
    const expected = total * (1 - (dayOf - 1) / (SPRINT_DAYS - 1));
    const remaining = total - done;
    const delta = expected - remaining;
    if (delta > total * 0.05) return { tone: "good", label: "Ahead of pace" };
    if (delta < -total * 0.05) return { tone: "bad", label: "Behind pace" };
    return { tone: "ok", label: "On track" };
  })();

  const atRisk = inWindow.filter((r) => {
    if (isRowDone(r)) return false;
    const at = anchorDate(r);
    if (at && startOfDay(at).getTime() < today.getTime()) return true;
    if (r.assignees.length === 0 && r.priority !== "LOW") return true;
    return false;
  });
  const unassigned = inWindow.filter((r) => !isRowDone(r) && r.assignees.length === 0);

  return { start, end, dayOf, rows: inWindow, total, done, completionPct, points, verdict, atRisk, unassigned };
}
