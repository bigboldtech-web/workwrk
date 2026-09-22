"use client";

// The page's entire motion budget, in one component.
//
// A section fades and rises 24px as it arrives, once, and then never moves
// again. Nothing loops, nothing scrubs to the scroll position, nothing is
// pinned. That is the whole of it, and it replaces four scroll scenes, two
// pinned stages and a scrubbed scale stack.
//
// THE RULE THAT SHAPES THE CODE: a visitor must never be shown less than
// the finished page. The composition this replaces hid the product frame's
// contents until a scroll scrub passed a threshold, so the first paint, the
// link preview and every visit without a scroll got an empty rectangle.
//
// So this island only ever hides a block that is ALREADY BELOW THE FOLD at
// the moment it mounts:
//
//   * Server render: no state attribute, so every section is visible. A
//     crawler, a reader with JavaScript off and a printed page get the
//     finished document.
//   * First paint: identical to the server render.
//   * After paint: a block still below the fold is marked hidden, which
//     nobody can see, and revealed when it arrives. A block already on
//     screen is left alone, so there is no flash and the hero never moves.
//
// `useEffect` rather than `useLayoutEffect` for the same reason: the only
// blocks it touches are off screen, so running after paint costs nothing
// and avoids the server render warning.
//
// Reduced motion is honoured by not arming at all, which is stronger than
// a CSS override: with the setting on there is no transition to interrupt
// and no state to get stuck in.

import { useEffect, useRef, type ReactNode } from "react";

import { useReducedMotion } from "../shell/reduced-motion";

/**
 * `className` exists so the eight pages on the iconic sheet can share this
 * island rather than copy it. The home page owns `chain-reveal` in
 * home/chain.css and the rest own `ic-reveal` in iconic/iconic.css; the
 * behaviour, which is the part worth having once, is this file.
 */
export function Reveal({ children, className = "chain-reveal" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // THE SETTING CAN ARRIVE AFTER THE FIRST EFFECT, and it does.
    //
    // `useReducedMotion` reports false on the server and on the first
    // render, by design, so that hydration matches; it flips on the first
    // effect. This effect therefore runs once with `reduced` false, arms a
    // block, and runs again with `reduced` true. Returning early on that
    // second run would leave `data-state="hidden"` written, and the only
    // thing keeping the page readable would be the reduced-motion override
    // in the stylesheet. A visitor with the setting on would be one CSS
    // edit away from a blank page. So the state is CLEARED rather than
    // left, and the stylesheet's override is a belt, not the braces.
    if (reduced) {
      delete el.dataset.state;
      return;
    }
    if (typeof IntersectionObserver !== "function") return;

    // Already on screen, or close enough that hiding it would be a flash.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.dataset.state = "hidden";

    // A threshold cannot be used here: a section with a product frame in it
    // is taller than the viewport, so its intersection ratio never reaches
    // a quarter and the block would stay hidden for ever. The bottom inset
    // fires the move when the block's top has risen through the last fifth
    // of the window, which is the same moment a threshold was reaching for.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.dataset.state = "in";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
