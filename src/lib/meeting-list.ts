// When a meeting is joinable, when it is live, and which side of now it
// falls on.
//
// spec-planner.md section 2 /meetings fixes the rules this file holds:
//
//   Join renders "only while the meeting is within 15 minutes before its
//   start and before its end"; the list row that is live now is washed with
//   the live dot; Upcoming sorts soonest first and Past sorts newest first
//   with no thirty-day cap.
//
// And section 2 /meetings/[id] gives the header's call slot exactly three
// states, so a finished meeting never wears a live affordance: before the
// window (secondary Start call), in the window (the blue Join call), after
// the end (nothing, and Start call again in the "..." menu).
//
// One module, so the list and the page cannot disagree about whether the
// meeting a person is looking at has started. Pure: no React, no Date
// formatting, no imports. `now` is always passed in, because a function
// that reads the clock itself renders differently on the server and the
// client and cannot be tested.

export const JOIN_LEAD_MINUTES = 15;

const MS_MIN = 60_000;

/** The instant a meeting ends, in milliseconds. */
export function meetingEndMs(startIso: string, durationMinutes: number): number {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return NaN;
  const mins = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30;
  return start + mins * MS_MIN;
}

/**
 * Where a meeting sits relative to now.
 *
 *   "before"   more than 15 minutes away
 *   "soon"     inside the 15 minute lead, not started
 *   "live"     started and not finished
 *   "ended"    finished
 *   "unknown"  the clock has not been sampled yet, or the date is unreadable
 *
 * "unknown" is a real answer rather than a guess: a component that has not
 * sampled the clock in an effect yet must render the neutral state, not the
 * one that happens to be true on the server.
 */
export type MeetingWindow = "before" | "soon" | "live" | "ended" | "unknown";

export function meetingWindow(
  startIso: string,
  durationMinutes: number,
  nowMs: number | null,
): MeetingWindow {
  if (nowMs === null) return "unknown";
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return "unknown";
  const end = meetingEndMs(startIso, durationMinutes);
  if (nowMs >= end) return "ended";
  if (nowMs >= start) return "live";
  if (start - nowMs <= JOIN_LEAD_MINUTES * MS_MIN) return "soon";
  return "before";
}

/** Join is offered from 15 minutes before the start until the end. */
export function canJoinNow(startIso: string, durationMinutes: number, nowMs: number | null): boolean {
  const w = meetingWindow(startIso, durationMinutes, nowMs);
  return w === "soon" || w === "live";
}

export interface MeetingLike {
  id: string;
  scheduledAt: string;
  duration: number;
}

/**
 * Upcoming and Past, by the rule the two view pills name.
 *
 * A meeting counts as Upcoming until it ENDS, not until it starts, so the
 * standup a person is sitting in does not vanish out from under them at
 * 9:00 and reappear under Past. Upcoming is soonest first; Past is newest
 * first. With no clock yet, everything is Upcoming in stored order, which
 * is the neutral render.
 */
export function splitMeetings<T extends MeetingLike>(
  meetings: readonly T[],
  nowMs: number | null,
): { upcoming: T[]; past: T[] } {
  if (nowMs === null) return { upcoming: [...meetings], past: [] };
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const m of meetings) {
    const end = meetingEndMs(m.scheduledAt, m.duration);
    if (Number.isNaN(end) || end > nowMs) upcoming.push(m);
    else past.push(m);
  }
  upcoming.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  past.sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
  return { upcoming, past };
}

/** "30 min", "1 h", "1 h 30 min". Never "90m" on a read-only surface. */
export function formatLength(minutes: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** The four lengths the segmented control offers, plus Custom. */
export const MEETING_LENGTHS = [15, 30, 45, 60] as const;
