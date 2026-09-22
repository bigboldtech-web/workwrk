"use client";

// The one reduced-motion check on the public site.
//
// The CSS block at the bottom of marketing-shell.css switches off CSS
// animations and transitions. It cannot reach an animation driven from
// JavaScript, because that writes inline transforms and no media query sees
// those. So every client island that moves something reads this hook and
// renders the RESTING frame when the answer is no.
//
// Resting frame, not a fast forward to the last frame: the composition each
// island is designed around is what a visitor with the setting on should
// see, at full quality, immediately.
//
// Two details that matter more than they look:
//
//   * The first render must match the server's. `useSyncExternalStore` with
//     a server snapshot of `false` does that: the server renders the motion
//     variant's markup, hydration agrees, and the value flips on the first
//     effect if the visitor asked for less motion. Reading matchMedia during
//     render instead produced a hydration mismatch on exactly the machines
//     that had the setting on.
//   * It re-reads on change. A visitor who turns the setting on mid visit,
//     which macOS and Windows both allow without a reload, stops seeing
//     motion on the next frame.

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia(QUERY);
  // Safari below 14 has addListener and not addEventListener.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** True when the visitor has asked for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
