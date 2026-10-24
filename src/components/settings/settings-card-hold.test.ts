// The anchor hold (settings-card.tsx keepInView and landOnHash; settings
// clean-up Phase 2, its review's L1, L2 and L8): run for real against stub
// elements, a stub ResizeObserver and fake timers, since the suite has no
// DOM. Before, the hold was held only by its source's strings.
//
// What a stub page holds: <html><body><main overflow-y:auto><div column>
// [a card above, #rail, #ai-apps]. `report()` is the ResizeObserver telling
// the hold the content changed size; `fire()` is an event reaching a target.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEP_IN_VIEW_MS, KEEP_IN_VIEW_SCROLLER_STOPS, KEEP_IN_VIEW_STOPS, keepInView, landOnHash, reducedMotion } from "./settings-card";

type Fn = (e?: unknown) => void;

class Target {
  listeners: { type: string; fn: Fn; capture: boolean }[] = [];
  addEventListener(type: string, fn: Fn, opts?: boolean | AddEventListenerOptions) {
    this.listeners.push({ type, fn, capture: typeof opts === "boolean" ? opts : Boolean(opts?.capture) });
  }
  removeEventListener(type: string, fn: Fn, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === "boolean" ? opts : Boolean(opts?.capture);
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  fire(type: string) {
    for (const l of [...this.listeners]) if (l.type === type) l.fn({ type });
  }
  count(type?: string) {
    return this.listeners.filter((l) => !type || l.type === type).length;
  }
}

class El extends Target {
  children: El[] = [];
  parentElement: El | null = null;
  isConnected = true;
  attrs = new Map<string, string>();
  scrolls: ScrollIntoViewOptions[] = [];
  constructor(public tagName: string, public id = "", public overflowY = "visible") {
    super();
  }
  append(...kids: El[]) {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  closest(sel: string): El | null {
    if (this.tagName === sel) return this;
    return this.parentElement ? this.parentElement.closest(sel) : null;
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  scrollIntoView(o: ScrollIntoViewOptions) {
    this.scrolls.push(o);
  }
}

class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(private cb: () => void) {
    FakeResizeObserver.made.push(this);
  }
  observe(t: unknown) {
    this.observed.push(t);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The content changed size; a real observer reports nothing once disconnected. */
  report() {
    if (!this.disconnected) this.cb();
  }
}

let osReduce = false;

function stubPage(hash: string) {
  const win = Object.assign(new Target(), {
    location: { hash },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout> | undefined) => clearTimeout(t),
    getComputedStyle: (e: El) => ({ overflowY: e.overflowY }),
    matchMedia: (q: string) => ({ matches: osReduce && q === "(prefers-reduced-motion: reduce)" }),
  });
  const html = new El("html");
  const body = new El("body");
  const main = new El("main", "", "auto");
  const column = new El("div");
  const above = new El("section", "ai-google");
  const rail = new El("section", "rail");
  const apps = new El("section", "ai-apps");
  html.append(body.append(main.append(column.append(above, rail, apps))));
  const doc = {
    body,
    documentElement: html,
    scrollingElement: html,
    getElementById: (id: string) => [above, rail, apps].find((e) => e.id === id) ?? null,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return { win, html, main, column, rail, apps };
}

/** The window's listeners besides hashchange: the hold's stops. */
const stopsOn = (t: Target) => t.listeners.filter((l) => l.type !== "hashchange").length;

beforeEach(() => {
  vi.useFakeTimers();
  FakeResizeObserver.made = [];
  osReduce = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("keepInView: the card landed on stays at the top while the content above it loads", () => {
  it("watches the page's content and skips the first size report, so the landing's own scroll runs untouched", () => {
    const { rail, column } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    expect(ro.observed).toEqual([column]);
    ro.report();
    expect(rail.scrolls).toEqual([]);
  });

  it("puts the card back at the top at each later report, at once", () => {
    const { rail } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    ro.report();
    ro.report();
    ro.report();
    expect(rail.scrolls).toEqual([{ block: "start" }, { block: "start" }]);
  });

  it("listens for each stop on the window, in the capture phase, and on the scroller itself", () => {
    const { win, main, rail } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    expect(win.listeners.map((l) => [l.type, l.capture])).toEqual(KEEP_IN_VIEW_STOPS.map((e) => [e, true]));
    expect(main.listeners.map((l) => l.type)).toEqual([...KEEP_IN_VIEW_SCROLLER_STOPS]);
    expect(KEEP_IN_VIEW_SCROLLER_STOPS).toContain("pointerdown");
  });

  for (const stop of KEEP_IN_VIEW_STOPS) {
    it(`hands the scroll back at the person's first ${stop}: no more scrolling, every listener and the timer gone`, () => {
      const { win, main, rail } = stubPage("#rail");
      keepInView(rail as unknown as HTMLElement);
      const [ro] = FakeResizeObserver.made;
      ro.report();
      expect(vi.getTimerCount()).toBe(1);
      win.fire(stop);
      ro.report();
      expect(rail.scrolls).toEqual([]);
      expect(ro.disconnected).toBe(true);
      expect(win.count()).toBe(0);
      expect(main.count()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  // Review L1: a drag on the scrollbar is a press on the scroller, and hands the scroll back too.
  it("hands the scroll back at a press on the scroller, its scrollbar's drag", () => {
    const { win, main, rail } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    ro.report();
    main.fire("pointerdown");
    ro.report();
    expect(rail.scrolls).toEqual([]);
    expect(ro.disconnected).toBe(true);
    expect(win.count()).toBe(0);
    expect(main.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends by itself KEEP_IN_VIEW_MS after landing, taking its listeners with it", () => {
    const { win, main, rail } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    ro.report();
    vi.advanceTimersByTime(KEEP_IN_VIEW_MS - 1);
    ro.report();
    expect(rail.scrolls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    ro.report();
    expect(rail.scrolls).toHaveLength(1);
    expect(ro.disconnected).toBe(true);
    expect(win.count()).toBe(0);
    expect(main.count()).toBe(0);
  });

  // Review L1: the hold outlived its hash, so a link to another card was pulled back to this one.
  it("ends once the hash no longer names the card, and never scrolls back to it", () => {
    const { win, main, rail } = stubPage("#rail");
    keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    ro.report();
    win.location.hash = "#ai-apps";
    ro.report();
    expect(rail.scrolls).toEqual([]);
    expect(ro.disconnected).toBe(true);
    expect(win.count()).toBe(0);
    expect(main.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never scrolls a card no longer on the page, and its returned stop ends it at once", () => {
    const { win, rail } = stubPage("#rail");
    const stop = keepInView(rail as unknown as HTMLElement);
    const [ro] = FakeResizeObserver.made;
    ro.report();
    rail.isConnected = false;
    ro.report();
    expect(rail.scrolls).toEqual([]);
    stop();
    expect(ro.disconnected).toBe(true);
    expect(win.count()).toBe(0);
  });
});

describe("landOnHash: the effect SettingsCard runs for its id", () => {
  it("at its hash: scrolls the card in smoothly, pulses once for 150ms and starts the hold", () => {
    const { rail } = stubPage("#rail");
    const pulses: boolean[] = [];
    landOnHash("rail", (on) => pulses.push(on));
    expect(rail.scrolls).toEqual([{ block: "start", behavior: "smooth" }]);
    expect(FakeResizeObserver.made).toHaveLength(1);
    expect(pulses).toEqual([true]);
    vi.advanceTimersByTime(149);
    expect(pulses).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(pulses).toEqual([true, false]);
  });

  // Review L2: the landing ignored reduced motion.
  it("lands at once for anyone who turned on Reduced motion in My settings", () => {
    const { html, rail } = stubPage("#rail");
    html.attrs.set("data-reduced-motion", "reduce");
    expect(reducedMotion()).toBe(true);
    landOnHash("rail", () => {});
    expect(rail.scrolls).toEqual([{ block: "start", behavior: "auto" }]);
  });

  it("lands at once where the system asks for less motion", () => {
    const { rail } = stubPage("#rail");
    osReduce = true;
    expect(reducedMotion()).toBe(true);
    landOnHash("rail", () => {});
    expect(rail.scrolls).toEqual([{ block: "start", behavior: "auto" }]);
  });

  it("does nothing while the hash names another card, and lands when a hashchange names this one", () => {
    const { win, rail } = stubPage("#modules");
    const pulses: boolean[] = [];
    landOnHash("rail", (on) => pulses.push(on));
    expect(rail.scrolls).toEqual([]);
    expect(FakeResizeObserver.made).toHaveLength(0);
    expect(win.count("hashchange")).toBe(1);
    win.location.hash = "#rail";
    win.fire("hashchange");
    expect(rail.scrolls).toEqual([{ block: "start", behavior: "smooth" }]);
    expect(FakeResizeObserver.made).toHaveLength(1);
    expect(pulses).toEqual([true]);
  });

  // Review L1: on a link to another card, this card's hold stops, so only the new card is kept in view.
  it("ends the hold at a hashchange to another card, so later reports never pull the page back", () => {
    const { win, main, rail, apps } = stubPage("#rail");
    landOnHash("rail", () => {});
    landOnHash("ai-apps", () => {});
    const [railHold] = FakeResizeObserver.made;
    railHold.report();
    win.location.hash = "#ai-apps";
    win.fire("hashchange");
    expect(railHold.disconnected).toBe(true);
    railHold.report();
    expect(rail.scrolls).toEqual([{ block: "start", behavior: "smooth" }]);
    expect(apps.scrolls).toEqual([{ block: "start", behavior: "smooth" }]);
    // Only #ai-apps' hold is left: its window stops, its scroller press, and the two cards' hashchange listeners.
    const appsHold = FakeResizeObserver.made[1];
    expect(appsHold.disconnected).toBe(false);
    expect(stopsOn(win)).toBe(KEEP_IN_VIEW_STOPS.length);
    expect(main.count()).toBe(KEEP_IN_VIEW_SCROLLER_STOPS.length);
    expect(win.count("hashchange")).toBe(2);
  });

  it("at unmount ends the hold, the pulse's timer and the hashchange listener", () => {
    const { win, main } = stubPage("#rail");
    const pulses: boolean[] = [];
    const cleanup = landOnHash("rail", (on) => pulses.push(on));
    const [ro] = FakeResizeObserver.made;
    cleanup();
    expect(ro.disconnected).toBe(true);
    expect(win.count()).toBe(0);
    expect(main.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(KEEP_IN_VIEW_MS);
    expect(pulses).toEqual([true]);
  });
});
