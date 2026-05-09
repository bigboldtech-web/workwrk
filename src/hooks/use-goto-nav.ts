"use client";

// "Go to X" two-key navigation: press `g`, then a letter, to jump to a
// known module. Mirrors GitHub / Linear / Vim. Listens globally; ignores
// while the user is typing in an input / textarea / contenteditable, so
// `g` doesn't get intercepted in a search box.
//
// Active for ~1.5s after `g` is pressed; if the user doesn't follow up
// with a registered letter, the prefix expires silently.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PREFIX_TIMEOUT_MS = 1500;

const map: Record<string, string> = {
  d: "/dashboard",
  i: "/inbox",
  p: "/people",
  t: "/tasks",
  o: "/okrs",
  k: "/kra-kpi",
  s: "/settings",
  m: "/meetings",
  r: "/reviews",
  a: "/analytics",
  n: "/announcements",
  c: "/clock",
  // Note: avoid binding `b`, `f`, `g`, `h`, `j`, `k`, `l` (used by lists),
  // and any letter the user might want for native browser shortcuts.
};

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useGoToNav() {
  const router = useRouter();

  useEffect(() => {
    let prefixActive = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clear() {
      prefixActive = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (!prefixActive) {
        if (e.key === "g") {
          prefixActive = true;
          timer = setTimeout(clear, PREFIX_TIMEOUT_MS);
        }
        return;
      }

      // Inside the 1.5s window — second key.
      const dest = map[e.key.toLowerCase()];
      clear();
      if (dest) {
        e.preventDefault();
        router.push(dest);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);
}
