"use client";

// Two jobs, neither of them visual (concept 4.2 and 6.3 measurement).
//
//   1. While the spine is in view, the sticky bar carries the clock label
//      of the beat the visitor is reading. That is the phone's version of
//      the desktop scene's clock: the story's narrator, kept with the one
//      piece of chrome that is always on screen.
//   2. One `beat_reached` event per beat, once, and one `stop_reached`
//      event per STOP, once. Per beat drop off is how the decision between
//      six stops and eight gets made with data instead of taste; per stop
//      drop off is the comparable number, because a stop is what the
//      desktop scene will show when it lands and each beat already knows
//      which stop it belongs to. Without it, `trackStop` was a function
//      with no caller and the site emitted no stop_reached at all.
//
// It renders nothing. Everything it touches is either a document event or
// an attribute on an element the sticky bar already owns, which is what
// keeps the spine itself a pile of server rendered sections.
//
// The event is gated on consent inside `trackBeat`, so a visitor who
// rejected analytics is not measured here either.

import { useEffect, useState } from "react";
import { trackBeat, trackStop } from "../instrumentation";

export const SPINE_CLOCK_EVENT = "workwrk:mk:clock";

export interface BeatRef {
  n: number;
  clock: string;
  id: string;
  /** The storyboard stop this beat belongs to (one stop, one or two beats). */
  stop: number;
}

function announce(clock: string | null) {
  try {
    document.dispatchEvent(new CustomEvent(SPINE_CLOCK_EVENT, { detail: { clock } }));
  } catch {
    // The clock is a garnish. An engine without CustomEvent keeps the bar.
  }
}

/**
 * The widths and motion setting at which the DESKTOP pinned scene owns the
 * spine instead of this observer.
 *
 * The two cannot both run. Under the pin every stop panel is stacked in one
 * sticky box, so all eight beats intersect the viewport at once and this
 * observer would fire all eight `beat_reached` and all six `stop_reached`
 * events in a single frame, the moment the section came on screen. Per stop
 * drop off is the number the scene exists to produce, and that is how you
 * destroy it.
 */
const SCENE_QUERY = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

export function SpineProgress({ beats }: { beats: BeatRef[] }) {
  // Starts false so the server render and the first client render agree, and
  // flips on the first effect. A visitor who resizes across 1024, or turns
  // the motion setting on mid visit, hands the spine over cleanly rather
  // than ending up with two observers or none.
  const [sceneOwns, setSceneOwns] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(SCENE_QUERY);
    const sync = () => setSceneOwns(mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    // The desktop scene emits its own stop events and drives its own clock.
    if (sceneOwns) return;
    const seen = new Set<number>();
    const stopsSeen = new Set<number>();
    const byElement = new Map<Element, BeatRef>();

    for (const beat of beats) {
      const el = document.getElementById(beat.id);
      if (el) byElement.set(el, beat);
    }
    if (byElement.size === 0) return;

    // The beat whose top has most recently crossed the middle of the
    // viewport is the one being read. Tracking the largest intersection
    // ratio instead flickers between two tall cards at a boundary.
    let current: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const beat = byElement.get(entry.target);
          if (!beat) continue;
          if (!entry.isIntersecting) continue;
          if (current !== beat.n) {
            current = beat.n;
            announce(beat.clock);
          }
          if (!seen.has(beat.n)) {
            seen.add(beat.n);
            trackBeat(beat.n, beat.id);
          }
          if (!stopsSeen.has(beat.stop)) {
            stopsSeen.add(beat.stop);
            trackStop(beat.stop, `stop-${beat.stop}`);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const el of byElement.keys()) observer.observe(el);

    // When the whole spine leaves the viewport the bar drops the clock: a
    // time left on screen beside the pricing section is a clock telling the
    // wrong story.
    const section = document.getElementById("tuesday");
    let edge: IntersectionObserver | null = null;
    if (section) {
      edge = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) {
              current = null;
              announce(null);
            }
          }
        },
        { threshold: 0 },
      );
      edge.observe(section);
    }

    return () => {
      observer.disconnect();
      edge?.disconnect();
      announce(null);
    };
  }, [beats, sceneOwns]);

  return null;
}
