"use client";

// useContextMenuTrigger: the one way a view tab (List tabs and Space tabs)
// opens its menu. Right-click was the only door, which left three people out
// (review #26):
//
//   * a keyboard user. Shift+F10 and the Menu key fire `contextmenu` on the
//     focused tab, but with clientX and clientY 0, so a menu placed at the
//     event point opened in the top-left corner of the page, nowhere near the
//     tab it belongs to. menuPointFor() opens it under the tab instead;
//   * a phone or tablet user. There is no right button, and iOS Safari never
//     fires `contextmenu` for a long-press on a link (it shows its own link
//     callout, and the tabs are links, ui/view-tabs.tsx). A held finger opens
//     the menu after LONG_PRESS_MS, and the callout is switched off on the
//     trigger so it cannot race the menu;
//   * the same phone user one step later. Lifting the finger that opened the
//     menu ends in a click on the tab link, which navigated away from the menu
//     that had just opened. The one click that ends a consumed press is
//     swallowed, and only that one.
//
// A finger that moves more than the slop is a drag (the tabs reorder by drag)
// or a scroll, and wins: the press is cancelled.
//
// The decisions live in pure functions (menuPointFor, movedTooFar,
// createLongPress) so the unit tests can pin them in node; the hook only
// wires them to React events and state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long a finger has to stay down before the menu opens. */
export const LONG_PRESS_MS = 450;

export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * Where a menu opened by a `contextmenu` event goes. The keyboard reports the
 * page corner (0, 0), which is never where the person is looking, so it opens
 * just under the trigger; a real right-click opens at the cursor.
 *
 * A browser that answers a long-press with `contextmenu` of its own (Chrome
 * on Android, with `pointerType` "touch") also opens under the trigger: the
 * long-press timer usually got there first and put the menu there, and a
 * menu that then jumped under the thumb would be hidden by it.
 */
export function menuPointFor(
  e: { clientX: number; clientY: number; pointerType?: string },
  rect: { left: number; bottom: number } | null,
): MenuPoint {
  if (!rect) return { x: e.clientX, y: e.clientY };
  const keyboard = e.clientX === 0 && e.clientY === 0;
  const finger = e.pointerType === "touch" || e.pointerType === "pen";
  if (keyboard || finger) return { x: rect.left, y: rect.bottom + 4 };
  return { x: e.clientX, y: e.clientY };
}

/** Has a pointer travelled far enough from where it went down to be a drag or a scroll? */
export function movedTooFar(start: MenuPoint, now: MenuPoint, slop = 8): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > slop;
}

/** The timer pair the press runs on; injectable so tests drive a fake clock. */
export interface PressTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: PressTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LongPress {
  /** A pointer went down on the trigger. Only touch and pen start a press. */
  down(e: { pointerType: string; clientX: number; clientY: number }, rect: { left: number; bottom: number }): void;
  /** The pointer moved; past the slop the press is cancelled. */
  move(p: MenuPoint): void;
  /** The pointer went up or was cancelled: a press that has not fired never will. */
  end(): void;
  /** True exactly once after a press that opened the menu: swallow this click. */
  takeClick(): boolean;
  /** Unmount: drop any pending press. */
  dispose(): void;
}

/**
 * The long-press state machine. `onLongPress` gets the point under the
 * trigger (a finger covers the spot it pressed, so the menu opens below the
 * tab, not under the thumb).
 */
export function createLongPress(
  onLongPress: (p: MenuPoint) => void,
  timers: PressTimers = browserTimers,
  delay: number = LONG_PRESS_MS,
): LongPress {
  let handle: unknown = null;
  let start: MenuPoint | null = null;
  let consumed = false;

  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    start = null;
  };

  return {
    down(e, rect) {
      // Every press starts clean. A press that opened the menu and was then
      // lifted without a click (Android sends none) must not eat the click of
      // the NEXT press, whatever pointer that one comes from.
      consumed = false;
      stop();
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      start = { x: e.clientX, y: e.clientY };
      const at = { x: rect.left, y: rect.bottom + 4 };
      handle = timers.set(() => {
        handle = null;
        start = null;
        consumed = true;
        onLongPress(at);
      }, delay);
    },
    move(p) {
      if (handle === null || !start) return;
      if (movedTooFar(start, p)) stop();
    },
    end() {
      stop();
    },
    takeClick() {
      if (!consumed) return false;
      consumed = false;
      return true;
    },
    dispose() {
      stop();
    },
  };
}

export interface ContextMenuBind {
  onContextMenu(e: React.MouseEvent<HTMLElement>): void;
  onPointerDown(e: React.PointerEvent<HTMLElement>): void;
  onPointerMove(e: React.PointerEvent<HTMLElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onClickCapture(e: React.MouseEvent<HTMLElement>): void;
  /**
   * `-webkit-touch-callout: none` stops iOS Safari showing its link preview in
   * place of the menu; `select-none` stops a held finger selecting the label.
   */
  className: string;
}

export interface ContextMenuTrigger {
  /** Where the menu is open, or null when it is closed. */
  point: MenuPoint | null;
  openAt(p: MenuPoint): void;
  close(): void;
  /** Spread onto the element that wraps the trigger. */
  bind: ContextMenuBind;
}

export function useContextMenuTrigger(): ContextMenuTrigger {
  const [point, setPoint] = useState<MenuPoint | null>(null);
  const pressRef = useRef<LongPress | null>(null);
  if (pressRef.current === null) pressRef.current = createLongPress((p) => setPoint(p));
  // The timer must not outlive the trigger: a press pending when the tab
  // unmounts (a refresh reorders the strip) would set state on nothing.
  useEffect(() => {
    const press = pressRef.current;
    return () => press?.dispose();
  }, []);

  const openAt = useCallback((p: MenuPoint) => setPoint(p), []);
  const close = useCallback(() => setPoint(null), []);

  const bind = useMemo<ContextMenuBind>(
    () => ({
      onContextMenu(e) {
        e.preventDefault();
        // A long-press on Android fires `contextmenu` too; it replaces the
        // pending press rather than opening the menu twice.
        pressRef.current?.end();
        const rect = e.currentTarget.getBoundingClientRect();
        // React's synthetic mouse event does not carry pointerType; the
        // native one does wherever `contextmenu` is a PointerEvent.
        const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType;
        setPoint(menuPointFor({ clientX: e.clientX, clientY: e.clientY, pointerType }, rect));
      },
      onPointerDown(e) {
        pressRef.current?.down(e, e.currentTarget.getBoundingClientRect());
      },
      onPointerMove(e) {
        pressRef.current?.move({ x: e.clientX, y: e.clientY });
      },
      onPointerUp() {
        pressRef.current?.end();
      },
      onPointerCancel() {
        pressRef.current?.end();
      },
      onClickCapture(e) {
        if (!pressRef.current?.takeClick()) return;
        e.preventDefault();
        e.stopPropagation();
      },
      className: "[-webkit-touch-callout:none] select-none",
    }),
    [],
  );

  return { point, openAt, close, bind };
}
