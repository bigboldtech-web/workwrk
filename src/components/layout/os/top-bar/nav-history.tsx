"use client";

// navStack (spec-shell 1.5, 2.1): the in-app history the bar's back and
// forward buttons read. The browser exposes no way to look at its own
// history entries, so the shell keeps its own mirror in sessionStorage: a
// list of visited paths and a cursor. On every pathname change the cursor
// moves back or forward when the new path is the neighbouring entry, and a
// fresh path truncates the forward stack and is pushed. Reloads survive
// because the mirror is per tab.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "workwrk:shell:nav-stack";
const MAX = 100;

type NavStack = { stack: string[]; idx: number };

const listeners = new Set<() => void>();
let memo: NavStack | null = null;
let memoRaw: string | null = null;

function read(): NavStack {
  if (typeof window === "undefined") return { stack: [], idx: -1 };
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === memoRaw && memo) return memo;
    memoRaw = raw;
    const parsed = raw ? (JSON.parse(raw) as NavStack) : null;
    memo = parsed && Array.isArray(parsed.stack) && typeof parsed.idx === "number" ? parsed : { stack: [], idx: -1 };
    return memo;
  } catch {
    return { stack: [], idx: -1 };
  }
}

function write(next: NavStack) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  memoRaw = null;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const SERVER: NavStack = { stack: [], idx: -1 };
function serverSnapshot() { return SERVER; }

/** Records the current path into the stack; mount once in the frame. */
export function useNavHistoryRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    const cur = read();
    const here = `${pathname}${window.location.search}`;
    if (cur.stack[cur.idx] === here) return;
    if (cur.idx > 0 && cur.stack[cur.idx - 1] === here) {
      write({ stack: cur.stack, idx: cur.idx - 1 });
      return;
    }
    if (cur.idx < cur.stack.length - 1 && cur.stack[cur.idx + 1] === here) {
      write({ stack: cur.stack, idx: cur.idx + 1 });
      return;
    }
    const stack = [...cur.stack.slice(0, cur.idx + 1), here].slice(-MAX);
    write({ stack, idx: stack.length - 1 });
  }, [pathname]);
}

/** What the two bar buttons need: whether each direction has an entry. */
export function useNavHistory() {
  const router = useRouter();
  const snap = useSyncExternalStore(subscribe, read, serverSnapshot);
  const canBack = snap.idx > 0;
  const canForward = snap.idx >= 0 && snap.idx < snap.stack.length - 1;
  const back = useCallback(() => { if (canBack) router.back(); }, [canBack, router]);
  const forward = useCallback(() => { if (canForward) router.forward(); }, [canForward, router]);
  return { canBack, canForward, back, forward };
}

/** True when the in-app stack has somewhere to go back to (BackButton reads this). */
export function navStackHasBack(): boolean {
  return read().idx > 0;
}
