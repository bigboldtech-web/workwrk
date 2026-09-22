// The maths behind the two pinned desktop scenes (marketing-concept.md 2.4,
// 4 and 6.1). Pure, so it can be tested without a browser and without the
// 870 line Tuesday fixture: every scene number on the site is decided here
// and the two client islands do nothing but read the scroll position and
// hand the answers to CSS.
//
// WHY THERE IS NO ANIMATION LIBRARY IN THIS FILE.
//
// The concept names GSAP with ScrollTrigger, Flip and DrawSVG. It is the
// right tool for a scene with arbitrary keyframed timelines, and it is not
// what these two scenes are: both are one scalar, the scroll position
// through a track, mapped to transforms that CSS can interpolate on its own.
// So the island writes ONE custom property per scene and the stylesheet does
// the rest on the compositor, which means:
//
//   * the pre hydration frame and the post hydration frame are identical,
//     because the resting value of every property is the exploded state the
//     server already rendered;
//   * a visitor with JavaScript off, or with a bundle still in flight, gets
//     the resting composition rather than a blank pinned box;
//   * the scene costs no bundle at all beyond these functions.
//
// A shared element Flip is the one thing that genuinely wants a library, and
// the spine does not need one: the task card sits in the SAME slot of every
// stop panel, so cross fading the panels leaves the card where it is and its
// trail grows under it. That is the effect Flip would produce, by not moving
// the element in the first place.
//
// Every number here has a test. `scroll-scene.test.ts` asserts the clamps,
// the stagger, the stop boundaries and the clock map, because a scene that
// is off by one at a boundary shows two panels at once or none.

/** Clamp into 0 to 1. NaN, which a zero height track produces, resolves to 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * How far through a pinned track the visitor has scrolled, 0 before it and 1
 * after it.
 *
 * `top` is the track's own `getBoundingClientRect().top`, so it starts
 * positive and goes negative as the track passes the top of the viewport.
 *
 * THE THIRD ARGUMENT IS THE STICKY CHILD'S HEIGHT, NOT THE VIEWPORT'S, and
 * the difference is a real defect rather than a pedantic one. A sticky
 * child sticks while the track's top is above its offset and releases when
 * the track's BOTTOM reaches the bottom of the child, so the scrubbable
 * distance is the track minus the CHILD. The Snap's child is capped at
 * `max(560px, 64svh)`, which is 576px inside a 900px viewport, so dividing
 * by `trackHeight - 900` drove the scene to its end state about 268px of
 * scroll before the pin actually let go: the last stretch of a pin the page
 * spends two viewports on held a finished picture and did nothing.
 *
 * `stickyTop` is that child's own `top` offset, which is the nav height
 * plus half the slack the cap leaves (see the sheet), and it is where
 * progress 0 really is.
 *
 * A track no taller than its child has zero travel, and this returns 0 for
 * it rather than dividing by zero.
 */
export function trackProgress(
  top: number,
  trackHeight: number,
  stickyHeight: number,
  stickyTop = 0,
): number {
  const travel = trackHeight - stickyHeight;
  if (travel <= 0) return 0;
  return clamp01((stickyTop - top) / travel);
}

/**
 * One block's own progress through the Snap.
 *
 * The blocks arrive in RAIL ORDER rather than together (concept 2.4: "blocks
 * travel toward the navy frame in rail order, Work first"), which is what a
 * stagger is: block `index` starts `index * step` into the scene and takes
 * `span` of it. The last block must still finish inside the track, so the
 * caller's step and span are asserted against the block count in the test.
 */
export function blockProgress(p: number, index: number, step: number, span: number): number {
  if (span <= 0) return p >= index * step ? 1 : 0;
  return clamp01((p - index * step) / span);
}

/**
 * The 0 to 1 ramp a scene element rides between two points of the scroll.
 *
 * Used for the frame squaring up, the sidebar arriving and the wires
 * collapsing, each of which owns a slice of the Snap rather than the whole
 * of it. `from` may be greater than `to`, which reverses the ramp.
 */
export function ramp(p: number, from: number, to: number): number {
  if (from === to) return p >= to ? 1 : 0;
  return clamp01((p - from) / (to - from));
}

/* ═══════════════════════════════════════════════════════════════════
 * The spine: six stops over five viewports of scroll.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Which stop the visitor is on, 0 indexed, given the track progress and how
 * many stops there are.
 *
 * The boundary belongs to the stop it OPENS, so progress exactly on a
 * sixth belongs to the later stop and never to both. At p = 1 the last
 * stop holds rather than falling off the end into an index nothing renders.
 */
export function stopIndex(p: number, count: number): number {
  if (count <= 0) return 0;
  const raw = Math.floor(clamp01(p) * count);
  return raw >= count ? count - 1 : raw;
}

/**
 * How far through its own stop the visitor is, 0 to 1.
 *
 * Also the sub-slice function for anything nested inside a stop: two of the
 * six stops hold two beats each, and `stopProgress(stopProgress(p, 6), 2)`
 * is how far through the current beat the visitor is. `stopIndex` composes
 * the same way, which is why neither has a second copy under a beat name.
 */
export function stopProgress(p: number, count: number): number {
  if (count <= 0) return 0;
  const clamped = clamp01(p);
  const index = stopIndex(clamped, count);
  return clamp01(clamped * count - index);
}

/** The scroll offset, in pixels from the top of the document, that opens a stop. */
export function stopOffset(trackTop: number, trackHeight: number, viewport: number, index: number, count: number): number {
  const travel = Math.max(0, trackHeight - viewport);
  if (count <= 0) return trackTop;
  // Half a stop in, so the click lands in the MIDDLE of the stop rather than
  // exactly on the boundary, where a pixel of rounding either way would open
  // the stop before the one the visitor asked for.
  const at = (index + 0.5) / count;
  return Math.round(trackTop + travel * at);
}

/* ═══════════════════════════════════════════════════════════════════
 * The clock: the story's narrator, driven by scroll.
 * ═══════════════════════════════════════════════════════════════════ */

export interface ClockMark {
  /** Minutes past midnight at the start of the stop. */
  from: number;
  /** Minutes past midnight at the end of the stop. Equal to `from` for a single moment. */
  to: number;
}

/**
 * The fraction of a slice over which the clock covers its whole range. The
 * remaining 30 percent is a HOLD, so the minute lands as the panel arrives
 * rather than creeping for the whole length of it.
 *
 * It is exported because two things have to agree on it: the clock, and the
 * moment a two beat stop swaps its blocks over. A stop that runs 9:02 to
 * 9:03 must show the 9:03 blocks on the same scroll pixel the clock reads
 * 9:03, or the scene prints a minute for a picture that has not arrived.
 */
export const CLOCK_ADVANCE = 0.7;

/**
 * The minute a single mark reads, given how far through its own slice the
 * visitor is.
 *
 * A mark with `from` equal to `to` is one moment and holds. A mark with a
 * range really does tick through it, which is what lets stop 4 cover 2:00 to
 * 2:30 inside one panel.
 */
export function clockWithin(mark: ClockMark, progress: number): number {
  if (mark.to === mark.from) return mark.from;
  const within = clamp01(progress / CLOCK_ADVANCE);
  return Math.round(mark.from + (mark.to - mark.from) * within);
}

/**
 * The index of the sub-panel a stop is showing, for a stop built of more
 * than one beat.
 *
 * Two of the six stops hold two beats: stop 1 is the 9:02 row and the 9:03
 * SOP, stop 3 is the 10:30 decision and the 11:15 contract. The swap happens
 * where the clock's own advance would reach the halfway minute, so the
 * blocks and the minute change on the same pixel rather than 15 percent of a
 * panel apart.
 */
export function beatWithinStop(progressThroughStop: number, beatCount: number): number {
  if (beatCount <= 1) return 0;
  return stopIndex(clamp01(progressThroughStop / CLOCK_ADVANCE), beatCount);
}

/**
 * The minute the clock reads at a given track progress, over a flat list of
 * marks that each own an equal slice.
 *
 * Between slices the clock jumps, which is honest: the story skips the hours
 * nothing happens in, and a clock that crawled smoothly from 11:15 to 2:00
 * would claim three hours of scroll the scene does not have.
 */
export function clockAt(p: number, marks: ClockMark[]): number {
  if (marks.length === 0) return 0;
  const index = stopIndex(p, marks.length);
  const mark = marks[index];
  if (!mark) return 0;
  return clockWithin(mark, stopProgress(p, marks.length));
}

/**
 * Minutes past midnight rendered the way the fixture writes a time, and the
 * way a person says it: a 12 hour workday clock with no meridiem, because
 * every moment in the story falls between 9:02 in the morning and 6:02 in
 * the evening and nobody in an office says "18:02".
 *
 * This is the exact inverse of `clockMinutes` in the fixture module over the
 * range the story uses, which the test asserts by round tripping every stop
 * and every beat time.
 */
export function formatClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(total / 60);
  const mins = total % 60;
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}
