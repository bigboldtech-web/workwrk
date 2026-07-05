"use client";

// useAnchorPos — position a cell popover with `position: fixed` anchored just
// below its trigger. Using fixed (not absolute) lets the dropdown escape the
// table's horizontal-scroll container, which would otherwise clip it. The popup
// stays a DOM child of the picker, so existing click-outside logic still works.
//
// Returns null while closed (so the caller renders nothing) and {top,left} once
// open. Re-measures on scroll/resize so it tracks the trigger.

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

// Layout effect on the client (measure before paint, no flash), plain effect on
// the server (useLayoutEffect is a no-op there and would warn). Chosen once at
// module load; hook order is identical either way, so hydration is unaffected.
const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

export function useAnchorPos(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  width = 240,
): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useIsoLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Keep the menu on-screen: flip left if it would run past the right edge.
      let left = r.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - 8 - width);
      }
      setPos({ top: Math.round(r.bottom + 4), left: Math.round(left) });
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
