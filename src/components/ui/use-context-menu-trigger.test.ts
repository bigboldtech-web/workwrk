// The one right-click, long-press and keyboard trigger both view tab strips
// use (review #26). The hook itself needs a DOM; everything it decides is in
// the pure pieces below, so they are what this file pins: where a menu opens,
// when a finger has moved too far to be a press, and the long-press state
// machine with its one swallowed click.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LONG_PRESS_MS,
  menuPointFor,
  movedTooFar,
  createLongPress,
  type PressTimers,
} from "./use-context-menu-trigger";

const RECT = { left: 120, bottom: 64 };

describe("menuPointFor", () => {
  it("opens under the tab when the keyboard fired the contextmenu (Shift+F10 reports 0, 0)", () => {
    expect(menuPointFor({ clientX: 0, clientY: 0 }, RECT)).toEqual({ x: 120, y: 68 });
  });

  it("opens at the cursor for a real right-click", () => {
    expect(menuPointFor({ clientX: 300, clientY: 40 }, RECT)).toEqual({ x: 300, y: 40 });
  });

  it("falls back to the event point when there is no rect to anchor to", () => {
    expect(menuPointFor({ clientX: 0, clientY: 0 }, null)).toEqual({ x: 0, y: 0 });
  });

  it("treats a click at the very left edge but a real height as a cursor, not the keyboard", () => {
    expect(menuPointFor({ clientX: 0, clientY: 30 }, RECT)).toEqual({ x: 0, y: 30 });
  });

  it("keeps a browser long-press (a touch contextmenu) under the tab, where the press already put it", () => {
    expect(menuPointFor({ clientX: 140, clientY: 52, pointerType: "touch" }, RECT)).toEqual({ x: 120, y: 68 });
    expect(menuPointFor({ clientX: 140, clientY: 52, pointerType: "mouse" }, RECT)).toEqual({ x: 140, y: 52 });
  });
});

describe("movedTooFar", () => {
  it("allows a finger to wobble inside the 8px slop", () => {
    expect(movedTooFar({ x: 10, y: 10 }, { x: 18, y: 10 })).toBe(false);
    expect(movedTooFar({ x: 10, y: 10 }, { x: 15, y: 15 })).toBe(false);
  });

  it("calls anything past the slop a drag or a scroll", () => {
    expect(movedTooFar({ x: 10, y: 10 }, { x: 19, y: 10 })).toBe(true);
    expect(movedTooFar({ x: 10, y: 10 }, { x: 10, y: -2 })).toBe(true);
  });

  it("measures the straight-line distance, so a diagonal counts", () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true);
  });

  it("honours a custom slop", () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: 12, y: 0 }, 16)).toBe(false);
  });
});

describe("createLongPress", () => {
  let opened: Array<{ x: number; y: number }>;
  let timers: PressTimers;

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    timers = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const press = () => createLongPress((p) => opened.push(p), timers);

  it("waits 450ms", () => {
    expect(LONG_PRESS_MS).toBe(450);
  });

  it("opens under the tab after a touch held for LONG_PRESS_MS", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual([{ x: 120, y: 68 }]);
  });

  it("treats a pen like a finger", () => {
    const lp = press();
    lp.down({ pointerType: "pen", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(opened).toHaveLength(1);
  });

  it("never starts a press for a mouse, which has a real right button", () => {
    const lp = press();
    lp.down({ pointerType: "mouse", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(opened).toEqual([]);
    expect(lp.takeClick()).toBe(false);
  });

  it("swallows exactly the one click that ends a long-press, so lifting the finger does not follow the link", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    lp.end();
    expect(lp.takeClick()).toBe(true);
    expect(lp.takeClick()).toBe(false);
  });

  it("lets a short tap through as a normal click", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(200);
    lp.end();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(opened).toEqual([]);
    expect(lp.takeClick()).toBe(false);
  });

  it("cancels when the finger moves past the slop (a drag or a scroll wins)", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    lp.move({ x: 150, y: 50 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(opened).toEqual([]);
  });

  it("keeps the press alive through a wobble inside the slop", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    lp.move({ x: 134, y: 53 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(opened).toHaveLength(1);
  });

  it("forgets a consumed press when the next press starts, so no later click is eaten", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    lp.end();
    // The browser fired no click for that press (Android does not), so the
    // flag is still set; the next press has to clear it.
    lp.down({ pointerType: "mouse", clientX: 130, clientY: 50 }, RECT);
    lp.end();
    expect(lp.takeClick()).toBe(false);
  });

  it("stops a pending press on dispose (unmount)", () => {
    const lp = press();
    lp.down({ pointerType: "touch", clientX: 130, clientY: 50 }, RECT);
    lp.dispose();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(opened).toEqual([]);
  });
});
