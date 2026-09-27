"use client";

// useElementWidth: the rendered width of one element, kept current through a
// ResizeObserver. 0 until the first measurement (the first paint), so a
// caller that hides things under a width shows everything for that one
// frame rather than hiding by guess. Used by TableCard for its column
// priority rule (spec-tools-misc section 1 "Mobile and narrow"): a column
// that hides is hidden for the CARD's width, not the window's, so the same
// rule holds when the filter panel narrows the card.

import { useLayoutEffect, useState, type RefObject } from "react";

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
