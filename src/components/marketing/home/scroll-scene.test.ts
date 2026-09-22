// The maths behind the two pinned desktop scenes.
//
// Every number the scenes use is decided in `scroll-scene.ts` and read by
// two client islands that do nothing but hand the answers to CSS, which is
// what makes the scenes testable without a browser at all. What is asserted
// here is the set of things that go wrong SILENTLY in a scroll scene:
//
//   a boundary that belongs to two stops, so two panels are visible at once
//   a boundary that belongs to neither, so the stage goes blank
//   a stagger whose last block starts after the track has ended
//   a clock that reads a minute for a picture that has not arrived
//   a division by a zero height track, which produces NaN and a stuck scene
//
// None of those throw. All of them look like a design problem in a
// screenshot, which is why they are pinned down as arithmetic here.

import { describe, expect, it } from "vitest";

import {
  CLOCK_ADVANCE,
  beatWithinStop,
  blockProgress,
  clamp01,
  clockAt,
  clockWithin,
  formatClock,
  ramp,
  stopIndex,
  stopOffset,
  stopProgress,
  trackProgress,
  type ClockMark,
} from "./scroll-scene";
import { clockMarkForBeat, clockMarkForStop, stopElementId, surfaceForBlock } from "./spine";
import { clockMinutes, tuesday, type Beat } from "../data/tuesday";
import { SURFACES } from "../shell/surfaces";

describe("clamp01", () => {
  it("holds the ends and passes the middle through", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(9)).toBe(1);
  });

  it("resolves the NaN a zero height track produces, rather than spreading it", () => {
    // 0/0 is NaN, NaN fails every comparison, and a NaN written into a
    // custom property makes the whole transform invalid: the scene freezes
    // at its resting frame with no error anywhere.
    expect(clamp01(Number.NaN)).toBe(0);
    // Every non-finite value resolves to the RESTING end, not to the
    // nearest one. Neither infinity can arise from a scroll position over a
    // positive travel, and when a number this scene cannot explain turns
    // up, the composition the server rendered is the safe thing to show.
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("trackProgress", () => {
  it("is 0 before the track and 1 after it", () => {
    expect(trackProgress(900, 2000, 900)).toBe(0);
    expect(trackProgress(-2000, 2000, 900)).toBe(1);
  });

  it("measures against the SCRUBBABLE distance, not the track height", () => {
    // The sticky child occupies its own height of the track, so a 2000px
    // track holding a 900px child has 1100px of travel, not 2000.
    expect(trackProgress(-550, 2000, 900)).toBeCloseTo(0.5, 5);
  });

  it("divides by the STICKY CHILD, which is not the viewport", () => {
    // The Snap's child is capped at max(560px, 64svh), so at 1440 by 900 it
    // is 576px inside a 900px viewport. Dividing by 900 finished the scene
    // 324px of scroll before the pin released, which is a third of a
    // viewport of scrubbing that moved nothing.
    const track = 1980;
    const viewport = 900;
    const child = 576;
    // Halfway by the wrong measure is NOT halfway by the right one.
    expect(trackProgress(-(track - viewport) / 2, track, viewport)).toBeCloseTo(0.5, 5);
    expect(trackProgress(-(track - viewport) / 2, track, child)).toBeCloseTo(0.3846, 3);
    // And the end of the scrub is the end of the pin, not before it.
    expect(trackProgress(-(track - child), track, child)).toBe(1);
    expect(trackProgress(-(track - child) + 1, track, child)).toBeLessThan(1);
  });

  it("starts at 0 where the sticky child's own top offset is, not at the viewport top", () => {
    // The child is centred in the pinned viewport, so its offset is the nav
    // height plus half the slack. Progress 0 is there.
    const stickyTop = 56 + (900 - 56 - 576) / 2;
    expect(trackProgress(stickyTop, 1980, 576, stickyTop)).toBe(0);
    expect(trackProgress(stickyTop + 200, 1980, 576, stickyTop)).toBe(0);
    expect(trackProgress(stickyTop - (1980 - 576), 1980, 576, stickyTop)).toBe(1);
  });

  it("returns 0 for a track with no travel rather than dividing by zero", () => {
    expect(trackProgress(-10, 900, 900)).toBe(0);
    expect(trackProgress(-10, 400, 900)).toBe(0);
  });
});

/* THE SNAP'S STAGGER IS GONE, and so are the six assertions that held it.
 *
 * They tested the home page's exploded hero: eight blocks staggered into a
 * centre frame across a pinned scroll track, with the frame's own centre
 * asserted to sit inside the band the placement map allowed. That hero has
 * been replaced. The home page has no pin, no stage, no stagger and no
 * scrubbed geometry: it shows one whole product frame, legible at rest.
 *
 * `blockProgress` itself is still exercised by the two assertions below it
 * that did not depend on the hero's constants, because /tuesday's spine pin
 * still uses the same helper.
 * ═══════════════════════════════════════════════════════════════════ */

describe("blockProgress", () => {
  it("gives each block its own progress, 0 before its turn and 1 once it has landed", () => {
    expect(blockProgress(0, 3, 0.1, 0.3)).toBe(0);
    expect(blockProgress(3 * 0.1, 3, 0.1, 0.3)).toBe(0);
    expect(blockProgress(3 * 0.1 + 0.15, 3, 0.1, 0.3)).toBeCloseTo(0.5, 5);
    expect(blockProgress(1, 3, 0.1, 0.3)).toBe(1);
  });

  it("degrades to a step when a block is given no span to travel over", () => {
    expect(blockProgress(0.1, 2, 0.1, 0)).toBe(0);
    expect(blockProgress(0.2, 2, 0.1, 0)).toBe(1);
  });
});

describe("ramp", () => {
  it("rides 0 to 1 between its two points and holds outside them", () => {
    expect(ramp(0.2, 0.35, 0.55)).toBe(0);
    expect(ramp(0.45, 0.35, 0.55)).toBeCloseTo(0.5, 5);
    expect(ramp(0.9, 0.35, 0.55)).toBe(1);
  });

  it("reverses when its points are given the other way round", () => {
    expect(ramp(0.1, 0.5, 0.1)).toBe(1);
    expect(ramp(0.5, 0.5, 0.1)).toBe(0);
  });

  it("is a step when both points are the same, rather than a division by zero", () => {
    expect(ramp(0.4, 0.5, 0.5)).toBe(0);
    expect(ramp(0.6, 0.5, 0.5)).toBe(1);
  });
});

describe("stopIndex and stopProgress", () => {
  const count = 6;

  it("gives a boundary to the stop it OPENS, never to both", () => {
    // Exactly on a sixth is the later stop's first pixel. Two panels
    // visible at once is what the other answer looks like.
    for (let i = 1; i < count; i += 1) {
      expect(stopIndex(i / count, count)).toBe(i);
      expect(stopIndex(i / count - 1e-9, count)).toBe(i - 1);
    }
  });

  it("holds the last stop at the end of the track", () => {
    expect(stopIndex(1, count)).toBe(count - 1);
    expect(stopIndex(1.5, count)).toBe(count - 1);
  });

  it("covers the whole track with no gap between the stops", () => {
    const seen = new Set<number>();
    for (let p = 0; p <= 1.0001; p += 0.001) seen.add(stopIndex(p, count));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("runs 0 to 1 inside each stop", () => {
    expect(stopProgress(0, count)).toBe(0);
    expect(stopProgress(1 / (count * 2), count)).toBeCloseTo(0.5, 5);
    expect(stopProgress(1 / count - 1e-9, count)).toBeCloseTo(1, 4);
    expect(stopProgress(1 / count, count)).toBeCloseTo(0, 5);
  });

  it("answers for a zero stop list rather than throwing", () => {
    expect(stopIndex(0.5, 0)).toBe(0);
    expect(stopProgress(0.5, 0)).toBe(0);
  });
});

describe("stopOffset", () => {
  it("lands in the MIDDLE of the stop the visitor asked for", () => {
    // Exactly on the boundary, a pixel of rounding either way opens the
    // stop before the one the rail button names.
    const top = 4000;
    const height = 5580;
    const viewport = 900;
    const travel = height - viewport;
    for (let i = 0; i < 6; i += 1) {
      const y = stopOffset(top, height, viewport, i, 6);
      expect(y).toBe(Math.round(top + travel * ((i + 0.5) / 6)));
      // And scrolling there really does select that stop.
      expect(stopIndex(trackProgress(top - y, height, viewport), 6)).toBe(i);
    }
  });

  it("returns the top of the track when there are no stops", () => {
    expect(stopOffset(4000, 5580, 900, 0, 0)).toBe(4000);
  });

  it("never asks for a negative scroll on a track with no travel", () => {
    expect(stopOffset(4000, 500, 900, 3, 6)).toBe(4000);
  });
});

describe("the clock", () => {
  it("holds on a moment and ticks through a range", () => {
    const moment: ClockMark = { from: 544, to: 544 };
    expect(clockWithin(moment, 0)).toBe(544);
    expect(clockWithin(moment, 1)).toBe(544);

    const span: ClockMark = { from: 840, to: 870 }; // 2:00 to 2:30
    expect(clockWithin(span, 0)).toBe(840);
    expect(clockWithin(span, CLOCK_ADVANCE / 2)).toBe(855);
    expect(clockWithin(span, CLOCK_ADVANCE)).toBe(870);
    // The last 30 percent of the slice is a hold, so the minute lands as
    // the panel arrives rather than creeping for the whole length of it.
    expect(clockWithin(span, 1)).toBe(870);
  });

  it("never runs past the end of its own range", () => {
    const span: ClockMark = { from: 840, to: 870 };
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const at = clockWithin(span, p);
      expect(at).toBeGreaterThanOrEqual(840);
      expect(at).toBeLessThanOrEqual(870);
    }
  });

  it("jumps between slices rather than claiming hours the scroll does not have", () => {
    const marks: ClockMark[] = [
      { from: 542, to: 542 },
      { from: 630, to: 630 },
    ];
    expect(clockAt(0.2, marks)).toBe(542);
    expect(clockAt(0.7, marks)).toBe(630);
  });

  it("answers for an empty mark list rather than throwing", () => {
    expect(clockAt(0.5, [])).toBe(0);
  });

  it("reads the way a person says the time on a workday", () => {
    expect(formatClock(542)).toBe("9:02");
    expect(formatClock(630)).toBe("10:30");
    expect(formatClock(870)).toBe("2:30");
    expect(formatClock(1082)).toBe("6:02");
    expect(formatClock(720)).toBe("12:00");
  });

  it("is the exact inverse of the fixture's own clock parser, over the story's range", () => {
    const times = [
      ...tuesday.beats.map((b) => b.clock),
      ...tuesday.stops.map((s) => s.clock),
      ...tuesday.receipt.lines.map((l) => l.time),
    ];
    for (const t of times) expect(formatClock(clockMinutes(t))).toBe(t);
  });

  it("wraps a minute outside the day rather than printing a negative hour", () => {
    expect(formatClock(-60)).toBe("11:00");
    expect(formatClock(1440)).toBe("12:00");
  });
});

describe("the beat inside a stop", () => {
  it("is always the only beat when a stop has one", () => {
    for (let p = 0; p <= 1.0001; p += 0.05) expect(beatWithinStop(p, 1)).toBe(0);
    expect(beatWithinStop(0.5, 0)).toBe(0);
  });

  it("swaps on the same pixel the clock advances, not a panel later", () => {
    // A two beat stop covering one minute reads the later minute from
    // CLOCK_ADVANCE / 2 of the way through. The blocks have to change
    // there too, or the stage prints 9:03 under the 9:02 picture.
    const swap = CLOCK_ADVANCE / 2;
    expect(beatWithinStop(swap - 1e-9, 2)).toBe(0);
    expect(beatWithinStop(swap, 2)).toBe(1);

    const minute: ClockMark = { from: 542, to: 543 };
    expect(clockWithin(minute, swap - 1e-9)).toBe(542);
    expect(clockWithin(minute, swap)).toBe(543);
  });

  it("holds the last beat through the hold at the end of the stop", () => {
    expect(beatWithinStop(CLOCK_ADVANCE, 2)).toBe(1);
    expect(beatWithinStop(1, 2)).toBe(1);
  });
});

describe("the storyboard, read as scene data", () => {
  const beatsFor = (n: number): Beat[] => tuesday.beats.filter((b) => b.stop === n);

  it("reads a stop's clock range off the string the beat rail prints", () => {
    const four = tuesday.stops.find((s) => s.n === 4)!;
    expect(four.clockRange).toBe("2:00 to 2:30");
    expect(clockMarkForStop(four)).toEqual({ from: clockMinutes("2:00"), to: clockMinutes("2:30") });

    const two = tuesday.stops.find((s) => s.n === 2)!;
    expect(clockMarkForStop(two).from).toBe(clockMarkForStop(two).to);
  });

  it("gives a beat inside a multi beat stop its OWN minute, not the stop's midpoint", () => {
    // Stop 3 spans 10:30 to 11:15. Interpolated across the stop, the clock
    // reads 10:52 at the moment the 11:15 contract arrives.
    const three = tuesday.stops.find((s) => s.n === 3)!;
    const beats = beatsFor(3);
    expect(beats).toHaveLength(2);
    for (const beat of beats) {
      const mark = clockMarkForBeat(three, beats, beat);
      expect(mark.from).toBe(mark.to);
      expect(formatClock(mark.from)).toBe(beat.clock);
    }
  });

  it("lets a single beat stop tick through its own half hour", () => {
    const four = tuesday.stops.find((s) => s.n === 4)!;
    const beats = beatsFor(4);
    expect(beats).toHaveLength(1);
    const mark = clockMarkForBeat(four, beats, beats[0]);
    expect(formatClock(mark.from)).toBe("2:00");
    expect(formatClock(mark.to)).toBe("2:30");
  });

  it("never prints a minute for a beat that is not on the stage", () => {
    // The whole scene, walked: at every scroll position the clock the stage
    // shows is the clock of the beat the stage is showing.
    const stops = tuesday.stops;
    for (let p = 0; p <= 1.0001; p += 0.002) {
      const stop = stops[stopIndex(p, stops.length)];
      const beats = beatsFor(stop.n);
      const within = stopProgress(p, stops.length);
      const beat = beats[beatWithinStop(within, beats.length)];
      const mark = clockMarkForBeat(stop, beats, beat);
      const minute = clockWithin(mark, stopProgress(within, beats.length));
      expect(minute).toBeGreaterThanOrEqual(mark.from);
      expect(minute).toBeLessThanOrEqual(mark.to);
      if (beats.length > 1) expect(formatClock(minute)).toBe(beat.clock);
    }
  });

  it("names a real surface for every block of every beat", () => {
    // The scene renders SURFACES[surfaceForBlock(...)], and a miss renders
    // an empty frame: navy chrome around nothing, with the narration beside
    // it still describing what is supposedly on screen.
    for (const beat of tuesday.beats) {
      const stop = tuesday.stops.find((s) => s.n === beat.stop);
      for (const id of beat.hubs) {
        const hub = tuesday.hubs.find((h) => h.id === id)!;
        expect(hub, `beat ${beat.n} names hub ${id}`).toBeDefined();
        const surface = surfaceForBlock(stop, hub, beat);
        expect(SURFACES[surface], `beat ${beat.n}, ${id} -> ${surface}`).toBeTypeOf("function");
      }
    }
  });

  it("shows the state the sentence beside it describes", () => {
    const hub = (id: string) => tuesday.hubs.find((h) => h.id === id)!;
    const stop = (n: number) => tuesday.stops.find((s) => s.n === n);
    const beat = (n: number) => tuesday.beats.find((b) => b.n === n)!;

    // 2:00, "Blocked doesn't mean stuck": the frame is blocked.
    expect(surfaceForBlock(stop(4), hub("work"), beat(6))).toBe("board-list-blocked");
    // 4:45, "Every task moves a goal": the task is done.
    expect(surfaceForBlock(stop(5), hub("work"), beat(7))).toBe("board-list-done");
    // 11:15, "The paperwork follows": the contract, not the SOP.
    expect(surfaceForBlock(stop(3), hub("docs"), beat(5))).toBe("contract-doc");
    // 10:30, same stop, same block: still the SOP.
    expect(surfaceForBlock(stop(3), hub("docs"), beat(4))).toBe(hub("docs").surface);
    // A hub the stop does not name keeps its own default.
    expect(surfaceForBlock(stop(1), hub("tables"), beat(1))).toBe(hub("tables").surface);
  });

  it("gives the rail one anchor per stop, and each anchor is the panel's own id", () => {
    const ids = tuesday.stops.map((s) => stopElementId(s.n));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("stop-1");
  });
});
