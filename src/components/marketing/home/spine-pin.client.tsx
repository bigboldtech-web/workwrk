"use client";

// PIN 2: Tuesday, six stops (marketing-concept.md 4 and 6.1, scroll 160 to
// 660vh). The desktop signature.
//
// The stops are ALREADY IN THE PAGE before this file runs. They are the same
// server rendered `<ol>` of sections the phone reads as eight beats, grouped
// into their six storyboard stops, with the same headings, the same
// narration under the same truth gates and the same marketing lite surfaces.
// Nothing is rendered twice and nothing is rendered only for a scroller.
//
// What this island adds, and only on a wide screen with motion allowed:
//
//   * the pin. The stop list becomes one stage that holds still for five
//     viewports while the stops cross fade through it.
//   * the beat inside a stop. Two of the six stops hold two beats (9:02 then
//     9:03, 10:30 then 11:15), and the second half of the stop's scroll
//     brings the second beat forward.
//   * the clock, which is the story's narrator. It is driven by scroll
//     position through the CURRENT BEAT's own minutes, so it can never read
//     a time for a picture that has not arrived.
//   * the beat rail: six real buttons, keyboard reachable, each scrolling to
//     its stop, with `aria-current` on the one being read.
//   * the "you are here" map: the eight blocks as a strip, with the blocks
//     this beat uses lit.
//   * one `stop_reached` event per stop and one `beat_reached` per beat,
//     each once, for the per stop drop off the concept's measurement section
//     asks for. Both carry the live H1 variant, which is what makes the
//     launch A/B readable as a funnel rather than as two totals.
//
// The card does not need a shared element transition to travel. It sits in
// the same slot of every stop panel, so the panels cross fade around it and
// it stays where it is while its trail grows one line at a time. That is the
// effect a Flip produces, arrived at by not moving the element.
//
// WHAT THIS FILE NEVER DOES is touch a transform, a layout class or the DOM
// the server rendered. It sets two attributes, `data-current` on the panel
// being read and `data-lit` on a map item, and writes the clock's text. Every
// transition is the stylesheet's. So the resting frame, the pre-hydration
// frame and the reduced-motion frame are one frame: the first stop, drawn.
//
// SKIP. The pin makes five viewports of scroll land on one screen, which is
// hostile to anyone who wants past it. The skip link is server rendered
// above the scene, so it is the first thing a keyboard reaches.

import { useEffect, useRef } from "react";

import { trackBeat, trackStop } from "../instrumentation";
import { SPINE_CLOCK_EVENT } from "./spine-progress.client";
import {
  beatWithinStop,
  clockWithin,
  formatClock,
  stopIndex,
  stopOffset,
  stopProgress,
  trackProgress,
  type ClockMark,
} from "./scroll-scene";

const SCENE_QUERY = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

export interface BeatRef {
  n: number;
  /** The element id of the beat section inside its stop panel. */
  id: string;
  /** The minutes this beat opens and closes on. */
  mark: ClockMark;
  /** The blocks this beat uses, for the "you are here" map. */
  hubs: string[];
}

export interface StopRef {
  n: number;
  /** The element id of the stop panel, which is also the anchor the rail scrolls to. */
  id: string;
  /** The label on the beat rail: the stop's clock range. */
  clockRange: string;
  title: string;
  /** The one or two beats this stop is made of, in order. */
  beats: BeatRef[];
}

export function SpinePin({ stops }: { stops: StopRef[] }) {
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (stops.length === 0 || typeof window.matchMedia !== "function") return;
    const track = document.querySelector<HTMLElement>('[data-pin="spine"]');
    const stage = document.querySelector<HTMLElement>(".mk-spine-stage");
    if (!track || !stage) return;

    // The scrub's denominator, measured off the sticky child rather than
    // assumed to be the viewport. The spine's child is the viewport minus
    // the nav, so the old arithmetic was 56px out at every width; the Snap's
    // is capped and was 268px out. Same fix, same reason, both measured.
    const sticky = track.querySelector<HTMLElement>(".mk-pin-sticky");
    const pinBox = () => {
      const fallback = window.innerHeight || document.documentElement.clientHeight;
      if (!sticky) return { height: fallback, top: 0 };
      const rect = sticky.getBoundingClientRect();
      const offset = Number.parseFloat(window.getComputedStyle(sticky).top);
      return {
        height: rect.height > 0 ? rect.height : fallback,
        top: Number.isFinite(offset) ? offset : 0,
      };
    };

    const clockEl = stage.querySelector<HTMLElement>(".mk-spine-clock__time");
    const statusEl = stage.querySelector<HTMLElement>(".mk-spine-status");
    const panels = stops.map((s) => document.getElementById(s.id));
    const mq = window.matchMedia(SCENE_QUERY);

    let frame = 0;
    let currentStop = -1;
    let currentBeat = -1;
    let currentClock = "";
    const stopsSeen = new Set<number>();
    const beatsSeen = new Set<number>();

    const announce = (clock: string | null) => {
      try {
        document.dispatchEvent(new CustomEvent(SPINE_CLOCK_EVENT, { detail: { clock } }));
      } catch {
        // The sticky bar's clock is a garnish, never a dependency.
      }
    };

    /** Which stop panel is on the stage. */
    const paintStop = (index: number) => {
      panels.forEach((el, i) => {
        if (!el) return;
        if (i === index) el.setAttribute("data-current", "true");
        else {
          el.removeAttribute("data-current");
          // Clear the beat inside it too. A stop left on its SECOND beat
          // keeps that flag while it is hidden, and the next paint of this
          // stop sets the first beat's flag before the old one is cleared:
          // two beats current at once, cross fading through each other.
          for (const section of el.querySelectorAll<HTMLElement>(".mk-beat")) {
            section.removeAttribute("data-current");
          }
        }
      });

      const stop = stops[index];
      if (!stop) return;

      const rail = railRef.current;
      if (rail) {
        for (const button of rail.querySelectorAll<HTMLButtonElement>("button[data-stop]")) {
          const isCurrent = Number(button.dataset.stop) === stop.n;
          if (isCurrent) button.setAttribute("aria-current", "step");
          else button.removeAttribute("aria-current");
        }
      }

      if (!stopsSeen.has(stop.n)) {
        stopsSeen.add(stop.n);
        trackStop(stop.n, stop.id);
      }
    };

    /** Which beat of that stop is forward, which blocks the map lights, what the narration says. */
    const paintBeat = (stop: StopRef, beatIndex: number) => {
      const panel = panels[stops.indexOf(stop)];
      if (panel) {
        const sections = panel.querySelectorAll<HTMLElement>(".mk-beat");
        sections.forEach((el, i) => {
          if (i === beatIndex) el.setAttribute("data-current", "true");
          else el.removeAttribute("data-current");
        });
      }

      const beat = stop.beats[beatIndex];
      if (!beat) return;

      const lit = new Set(beat.hubs);
      for (const item of stage.querySelectorAll<HTMLElement>(".mk-map__item")) {
        const hub = item.dataset.hub ?? "";
        if (lit.has(hub)) item.setAttribute("data-lit", "true");
        else item.removeAttribute("data-lit");
      }

      if (statusEl) statusEl.textContent = `Stop ${stop.n} of ${stops.length}, ${stop.clockRange}. ${stop.title}.`;

      if (!beatsSeen.has(beat.n)) {
        beatsSeen.add(beat.n);
        trackBeat(beat.n, beat.id);
      }
    };

    const write = () => {
      frame = 0;
      const rect = track.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      const onScreen = rect.bottom > 0 && rect.top < viewport;
      if (!onScreen) {
        if (currentClock !== "") {
          currentClock = "";
          announce(null);
        }
        return;
      }

      const box = pinBox();
      const p = trackProgress(rect.top, rect.height, box.height, box.top);
      const index = stopIndex(p, stops.length);
      const stop = stops[index];
      if (!stop) return;

      const within = stopProgress(p, stops.length);
      const beatIndex = beatWithinStop(within, stop.beats.length);

      if (index !== currentStop) {
        currentStop = index;
        currentBeat = -1;
        paintStop(index);
      }
      if (beatIndex !== currentBeat) {
        currentBeat = beatIndex;
        paintBeat(stop, beatIndex);
      }

      // The clock reads the BEAT's own minutes, over the beat's own slice of
      // the stop. A stop that spans 10:30 to 11:15 across two beats therefore
      // reads 10:30 while the 10:30 blocks are up and 11:15 when they change,
      // instead of interpolating to 10:52 under a picture of 11:15.
      const beat = stop.beats[beatIndex];
      if (beat) {
        const clock = formatClock(clockWithin(beat.mark, stopProgress(within, stop.beats.length)));
        if (clock !== currentClock) {
          currentClock = clock;
          if (clockEl) clockEl.textContent = clock;
          announce(clock);
        }
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(write);
    };

    const attach = () => {
      // BOTH, and that is the point. The stop stacking is gated on the
      // stage's `data-scene`, which only this file sets; the track's height
      // and its sticky child used to be gated on the media query alone. A
      // run where this island never attaches, script blocked or a chunk
      // 404 after a deploy, then kept a 620vh track and a sticky box with
      // six stops flowing inside it: the centrepiece frozen and overlapping
      // itself for five viewports. One attribute governs both halves now.
      track.setAttribute("data-scene", "on");
      stage.setAttribute("data-scene", "on");
      write();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
    };

    const detach = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      track.removeAttribute("data-scene");
      stage.removeAttribute("data-scene");
      for (const el of panels) {
        el?.removeAttribute("data-current");
        for (const section of el?.querySelectorAll<HTMLElement>(".mk-beat") ?? []) {
          section.removeAttribute("data-current");
        }
      }
      for (const item of stage.querySelectorAll<HTMLElement>(".mk-map__item")) item.removeAttribute("data-lit");
      currentStop = -1;
      currentBeat = -1;
      if (currentClock !== "") {
        currentClock = "";
        announce(null);
      }
    };

    const onQuery = () => {
      detach();
      if (mq.matches) attach();
    };

    if (mq.matches) attach();
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onQuery);
    else mq.addListener(onQuery);

    return () => {
      detach();
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onQuery);
      else mq.removeListener(onQuery);
    };
  }, [stops]);

  const goTo = (index: number) => {
    const track = document.querySelector<HTMLElement>('[data-pin="spine"]');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const sticky = track.querySelector<HTMLElement>(".mk-pin-sticky");
    const fallback = window.innerHeight || document.documentElement.clientHeight;
    const stickyRect = sticky?.getBoundingClientRect();
    const stickyHeight = stickyRect && stickyRect.height > 0 ? stickyRect.height : fallback;
    const stickyTop = sticky ? Number.parseFloat(window.getComputedStyle(sticky).top) : 0;
    const top = rect.top + window.scrollY - (Number.isFinite(stickyTop) ? stickyTop : 0);
    // The same box the scrub divides by, so clicking stop 4 on the rail
    // lands on the scroll position the scrub calls stop 4.
    const target = stopOffset(top, rect.height, stickyHeight, index, stops.length);
    // Honour the setting here too: a visitor with reduced motion on gets the
    // jump, not a half second of animated scrolling they did not ask for.
    const smooth =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    window.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <nav className="mk-beatrail" aria-label="Tuesday, by the clock" ref={railRef}>
      <ol>
        {stops.map((stop, i) => (
          <li key={stop.n}>
            <button type="button" data-stop={stop.n} onClick={() => goTo(i)}>
              <span className="mk-beatrail__tick" aria-hidden />
              <span className="mk-beatrail__time mk-figures">{stop.clockRange}</span>
              <span className="mk-beatrail__title">{stop.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
