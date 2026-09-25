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
import { navPop, navPreviousIs, navPush, navReplace, type NavStack } from "@/lib/nav/nav-stack";

const KEY = "workwrk:shell:nav-stack";
const MAX = 100;

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

// ── Same-path entries ───────────────────────────────────────────────
//
// The recorder above runs on PATHNAME changes only, so an entry a page pushes
// for itself with the native history API (Bird's eye's focus mode, which
// keeps /spaces/<slug> and changes only the query) never reached the mirror,
// and BackButton, goBackOr and the bar's buttons then disagreed with the
// browser about what Back does. A page that pushes such entries goes through
// these four instead. Next copies its router state into the state object
// handed in (app-router.js, copyNextJsInternalHistoryState), so the entries
// stay traversable by the router (docs 01-app/01-getting-started/
// 04-linking-and-navigating.md, "Native History API").

function hereUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Push a same-path entry, keeping the mirror true. */
export function pushSamePath(url: string, state?: Record<string, unknown> | null): void {
  if (typeof window === "undefined") return;
  // A search-only Link navigation (clicking a view tab) never reached the
  // mirror, so its current entry first learns where the tab really is.
  const synced = navReplace(read(), hereUrl());
  write(navPush(synced, url, MAX));
  window.history.pushState(state ?? null, "", url);
}

/** Rewrite the current entry, in the browser and in the mirror. */
export function replaceSamePath(url: string, state?: Record<string, unknown> | null): void {
  if (typeof window === "undefined") return;
  write(navReplace(read(), url));
  window.history.replaceState(state ?? null, "", url);
}

/**
 * Step back to `expectedUrl` when it is exactly the entry behind this one,
 * and say whether it did. A caller that gets false knows Back would leave for
 * somewhere else (a shared link opened straight into the state) and replaces
 * the entry instead of stranding the person.
 */
export function backToSamePath(expectedUrl: string): boolean {
  if (typeof window === "undefined") return false;
  const cur = read();
  if (!navPreviousIs(cur, expectedUrl)) return false;
  write({ stack: cur.stack, idx: cur.idx - 1 });
  window.history.back();
  return true;
}

/** For a popstate listener on a page that pushed same-path entries. */
export function recordSamePathPop(): void {
  if (typeof window === "undefined") return;
  write(navPop(read(), hereUrl()));
}
