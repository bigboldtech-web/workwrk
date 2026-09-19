import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CONTAINER_EVENTS,
  dispatchContainerEvent,
  treeChanged,
  accessChanged,
  itemChanged,
  subscribeContainerEvents,
} from "./container-events";

// The node environment has no `window`. That is the interesting case: every
// one of these is called from components that also render on the server, so a
// missing `window` must be a silent no-op rather than a crash inside a write
// that has already succeeded.
describe("without a window (the server)", () => {
  afterEach(() => {
    // @ts-expect-error deliberately removing the stub between cases
    delete globalThis.window;
  });

  it("dispatch is a no-op and never throws", () => {
    expect(() => dispatchContainerEvent(CONTAINER_EVENTS.tree, { kind: "space" })).not.toThrow();
    expect(() => treeChanged()).not.toThrow();
    expect(() => accessChanged({ kind: "list", id: "b1" })).not.toThrow();
    expect(() => itemChanged({ id: "i1" })).not.toThrow();
  });

  it("subscribe returns an unsubscriber that is safe to call", () => {
    const off = subscribeContainerEvents([CONTAINER_EVENTS.tree], () => {});
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
  });
});

describe("with a window", () => {
  function stubWindow() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    const win = {
      addEventListener: (name: string, fn: (e: unknown) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(fn);
        listeners.set(name, set);
      },
      removeEventListener: (name: string, fn: (e: unknown) => void) => {
        listeners.get(name)?.delete(fn);
      },
      dispatchEvent: (e: { type: string }) => {
        for (const fn of listeners.get(e.type) ?? []) fn(e);
        return true;
      },
    };
    // @ts-expect-error minimal window stub for the node environment
    globalThis.window = win;
    return listeners;
  }

  afterEach(() => {
    // @ts-expect-error removing the stub
    delete globalThis.window;
  });

  it("delivers each of the three names to its subscriber", () => {
    stubWindow();
    const seen: string[] = [];
    const off = subscribeContainerEvents(
      [CONTAINER_EVENTS.tree, CONTAINER_EVENTS.access, CONTAINER_EVENTS.item],
      () => seen.push("hit"),
    );
    treeChanged({ kind: "list", action: "created" });
    accessChanged({ kind: "space", id: "s1" });
    itemChanged({ id: "i1" });
    expect(seen).toHaveLength(3);
    off();
    treeChanged();
    expect(seen).toHaveLength(3);
  });

  it("also fires on window focus when asked, and unsubscribes it too", () => {
    stubWindow();
    const handler = vi.fn();
    const off = subscribeContainerEvents([CONTAINER_EVENTS.tree], handler, { onFocus: true });
    window.dispatchEvent(new (class { type = "focus"; })() as unknown as Event);
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new (class { type = "focus"; })() as unknown as Event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("one subscriber that throws does not stop the dispatch", () => {
    stubWindow();
    const good = vi.fn();
    const offBad = subscribeContainerEvents([CONTAINER_EVENTS.tree], () => { throw new Error("boom"); });
    const offGood = subscribeContainerEvents([CONTAINER_EVENTS.tree], good);
    expect(() => treeChanged()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it("names are the strings the rest of the product already listens for", () => {
    expect(CONTAINER_EVENTS.tree).toBe("workwrk:tree-changed");
    expect(CONTAINER_EVENTS.access).toBe("workwrk:access-changed");
    expect(CONTAINER_EVENTS.item).toBe("workwrk:item-changed");
  });
});
