"use client";

// useAnchorPos — position a cell popover with `position: fixed` anchored to
// its trigger. Using fixed (not absolute) lets the dropdown escape the
// table's horizontal-scroll container, which would otherwise clip it. The popup
// stays a DOM child of the picker, so existing click-outside logic still works.
//
// VIEWPORT-AWARE both axes (2026-08-27 — panels near the bottom of the
// screen ran off it with their overflow unreachable):
//   - horizontally it slides left so the panel never passes the right edge;
//   - vertically it opens BELOW when there's room, otherwise ABOVE
//     (bottom-anchored so the panel grows upward), and always returns a
//     fitted maxHeight so tall content (the Repeat tab, long option
//     lists) scrolls INSIDE the panel instead of past the screen edge.
//
// Returns null while closed. Once open: { left, maxHeight } plus EITHER
// `top` (opened below) or `bottom` (opened above) — spread the result into
// the panel's fixed style and give the panel `overflow-y: auto` (or an
// inner scroller) so maxHeight can do its job.

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

// Layout effect on the client (measure before paint, no flash), plain effect on
// the server (useLayoutEffect is a no-op there and would warn). Chosen once at
// module load; hook order is identical either way, so hydration is unaffected.
const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

const EDGE = 8;       // minimum gap to every viewport edge
const GAP = 4;        // gap between trigger and panel
const MIN_BELOW = 220; // open below only if at least this much fits there

export type AnchorPos = {
  left: number;
  /** Set when the panel opens BELOW the trigger. */
  top?: number;
  /** Set when the panel opens ABOVE the trigger (grows upward). */
  bottom?: number;
  /** Space actually available on the chosen side — cap the panel with it. */
  maxHeight: number;
};

export function useAnchorPos(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  width = 240,
): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);

  useIsoLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Anchor is momentarily hidden (e.g. a card's date chip is display:none
      // while the card isn't hovered, but the popover is open) — a zero rect
      // would fling the popover to the corner, so keep the last good position.
      if (r.width === 0 && r.height === 0) return;

      // Keep the menu on-screen: slide left if it would run past the right edge.
      let left = r.left;
      if (left + width > window.innerWidth - EDGE) {
        left = Math.max(EDGE, window.innerWidth - EDGE - width);
      }

      const spaceBelow = window.innerHeight - r.bottom - GAP - EDGE;
      const spaceAbove = r.top - GAP - EDGE;
      // Below when it reasonably fits, or when below is simply the bigger
      // side; otherwise flip above, bottom-anchored so growth is upward.
      if (spaceBelow >= MIN_BELOW || spaceBelow >= spaceAbove) {
        setPos({
          left: Math.round(left),
          top: Math.round(r.bottom + GAP),
          maxHeight: Math.max(120, Math.floor(spaceBelow)),
        });
      } else {
        setPos({
          left: Math.round(left),
          bottom: Math.round(window.innerHeight - r.top + GAP),
          maxHeight: Math.max(120, Math.floor(spaceAbove)),
        });
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, ref, width]);

  return pos;
}
