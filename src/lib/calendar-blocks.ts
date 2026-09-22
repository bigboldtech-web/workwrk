// The Calendar's block maths: lane packing, pixel-to-minute, and the three
// small time formats the grid and its modal share.
//
// A SEPARATE MODULE FROM THE COMPONENT, on purpose. These are the rules a
// calendar is actually made of, and they are the part worth proving in a
// test with no DOM: "two 2pm meetings sit side by side" is a statement about
// arithmetic, not about React. Keeping them in calendar-grid.tsx would put
// them behind "use client" and a lucide import, where a node test cannot
// reach them.
//
// Pure: no React, no prisma, no Intl, no imports.

/** Pixels per hour on the week grid. */
export const HOUR_PX = 48;

/** Everything on the grid snaps to a quarter hour. A product decision. */
export const SNAP_MIN = 15;

/** The minimum a block occupies in the packer, so a zero-length one still
 *  pushes its neighbours aside. A reminder has no duration at all. */
const MIN_SPAN_MS = 20 * 60_000;

export interface PackInput {
  id: string;
  start: string;
  end: string;
}

export interface Packed<T extends PackInput> {
  e: T;
  lane: number;
  lanes: number;
}

/**
 * Lane packing inside one day column.
 *
 * Two 2pm meetings render side by side at half width each, rather than one
 * drawn on top of the other with the second one unreachable (audit P-8).
 *
 * A CLUSTER is a run of blocks that overlap transitively; every block in one
 * cluster gets the same `lanes` count, so a column of three overlapping
 * things is three even thirds instead of three different widths. Within a
 * cluster each block takes the first lane whose last block has already
 * ended, which is the standard sweep and is what keeps a long block from
 * pushing everything after it sideways.
 */
export function packEvents<T extends PackInput>(events: readonly T[]): Packed<T>[] {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const out: Packed<T>[] = [];
  let cluster: Array<{ e: T; lane: number; end: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 1);
    for (const c of cluster) out.push({ e: c.e, lane: c.lane, lanes });
    cluster = [];
  };
  for (const e of sorted) {
    const s = new Date(e.start).getTime();
    const en = Math.max(s + MIN_SPAN_MS, new Date(e.end).getTime());
    if (cluster.length && s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.end);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ e, lane, end: en });
    clusterEnd = Math.max(clusterEnd, en);
  }
  if (cluster.length) flush();
  return out;
}

/**
 * How many side-by-side columns one day may split into before the rest go
 * behind a "+N" chip.
 *
 * spec-planner.md section 2 Blocks: "Overlapping blocks pack side by side
 * (column packing, up to 3 columns, then a '+N' chip that opens the day
 * list)". The cap is the whole point of the rule: in a 142px day column four
 * concurrent blocks become 31px each and every title collapses to one
 * letter, which is less readable than a chip that says there are four.
 */
export const MAX_LANES = 3;

export interface CappedPack<T extends PackInput> {
  /** The blocks that fit, with `lanes` clamped so the widths still add up. */
  shown: Packed<T>[];
  /** Everything past the cap, in start order: what the "+N" chip stands for. */
  hidden: T[];
  /** The start of the earliest hidden block, so the chip sits beside its cluster. */
  overflowStart: string | null;
}

/**
 * Apply the column cap to an already packed day.
 *
 * Separate from `packEvents` on purpose: the packing answers "what overlaps
 * what", which is true whatever the column is wide, and the cap is a drawing
 * decision the Week view makes and the Month view does not.
 */
export function capLanes<T extends PackInput>(packed: readonly Packed<T>[], max: number = MAX_LANES): CappedPack<T> {
  const limit = Math.max(1, Math.floor(max));
  const shown: Packed<T>[] = [];
  const hidden: T[] = [];
  for (const p of packed) {
    if (p.lane < limit) shown.push({ ...p, lanes: Math.min(p.lanes, limit) });
    else hidden.push(p.e);
  }
  hidden.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { shown, hidden, overflowStart: hidden.length ? hidden[0].start : null };
}

/** A y offset inside a day column to minutes past midnight, snapped to 15. */
export function yToMinutes(y: number): number {
  const raw = (y / HOUR_PX) * 60;
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

/**
 * Minutes as "1:30".
 *
 * THE UNIT OF THE WHOLE PLANNER (naming canon section 1): "Hours render as
 * h:mm everywhere in this unit ... 1:30, never 1.5h or 90m in display."
 */
export function hoursMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Minutes past midnight as the "HH:MM" an `<input type="time">` wants. */
export function hhmm(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** "HH:MM" back to minutes past midnight. Junk reads as midnight. */
export function minutesOfHhmm(v: string): number {
  const [h, m] = String(v).split(":").map(Number);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, Math.min(24 * 60, hh * 60 + mm));
}

/**
 * The live duration hint under the New event modal's times: "45 min",
 * "1h", "1h 30m". A backwards range is "0 min" and not a negative number,
 * because the modal fixes it on save rather than refusing it.
 */
export function durationHint(startMin: number, endMin: number): string {
  const total = Math.max(0, Math.round(endMin - startMin));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Minutes from now until the next `h:m`, optionally N days ahead.
 *
 * The snooze and quick-chip arithmetic. It can never return a number that
 * puts the reminder in the PAST: "This evening" clicked at 9pm means
 * tomorrow evening, not eighteen hours ago.
 *
 * `now` is a parameter so the test does not have to move the clock.
 */
export function minutesUntil(h: number, m: number, addDays = 0, now: Date = new Date()): number {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  const mins = Math.round((d.getTime() - now.getTime()) / 60_000);
  return mins > 0 ? mins : mins + 24 * 60;
}
