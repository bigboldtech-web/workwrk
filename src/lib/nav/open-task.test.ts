import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TASK_DRAWER_INTENT_KEY,
  armTaskDrawer,
  clearTaskDrawer,
  openTask,
  readTaskDrawer,
} from "./open-task";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

function withWindow(over: Partial<{ sessionStorage: unknown; location: unknown }> = {}) {
  (globalThis as { window?: unknown }).window = {
    sessionStorage: fakeStorage(),
    location: { pathname: "/boards/tasks", search: "?view=list" },
    ...over,
  };
}

beforeEach(() => withWindow());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("armTaskDrawer / readTaskDrawer", () => {
  it("reads back the task it armed, with the host URL", () => {
    armTaskDrawer("t1", "/boards/tasks?view=list");
    expect(readTaskDrawer("t1")).toEqual({ itemId: "t1", from: "/boards/tasks?view=list" });
  });

  // The whole point: an intent for another task must not open this one.
  it("answers null for a different task", () => {
    armTaskDrawer("t1", "/boards/tasks");
    expect(readTaskDrawer("t2")).toBeNull();
  });

  it("answers null when nothing is armed, which is the hard-load case", () => {
    expect(readTaskDrawer("t1")).toBeNull();
  });

  it("is cleared by clearTaskDrawer", () => {
    armTaskDrawer("t1", "/boards/tasks");
    clearTaskDrawer();
    expect(readTaskDrawer("t1")).toBeNull();
  });

  it("refuses an off-site `from` and falls back to a real page", () => {
    (globalThis as { window: { sessionStorage: Storage } }).window.sessionStorage.setItem(
      TASK_DRAWER_INTENT_KEY,
      JSON.stringify({ itemId: "t1", from: "//evil.test/steal" }),
    );
    expect(readTaskDrawer("t1")?.from).toBe("/everything");
  });

  it("survives a corrupt entry rather than throwing at a row click", () => {
    (globalThis as { window: { sessionStorage: Storage } }).window.sessionStorage.setItem(TASK_DRAWER_INTENT_KEY, "{not json");
    expect(readTaskDrawer("t1")).toBeNull();
  });

  it("degrades to the page when storage is unavailable, and never throws", () => {
    withWindow({
      sessionStorage: new Proxy({}, { get() { throw new Error("blocked"); } }),
    });
    expect(() => armTaskDrawer("t1", "/x")).not.toThrow();
    expect(readTaskDrawer("t1")).toBeNull();
    expect(() => clearTaskDrawer()).not.toThrow();
  });

  it("does nothing on the server, where there is no window at all", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => armTaskDrawer("t1", "/x")).not.toThrow();
    expect(readTaskDrawer("t1")).toBeNull();
  });
});

describe("openTask", () => {
  it("arms the intent from the current URL and then pushes the task", () => {
    const push = vi.fn();
    openTask({ push }, "t9");
    expect(readTaskDrawer("t9")).toEqual({ itemId: "t9", from: "/boards/tasks?view=list" });
    expect(push).toHaveBeenCalledWith("/item/t9");
  });

  it("pushes even when the intent could not be stored", () => {
    withWindow({ sessionStorage: new Proxy({}, { get() { throw new Error("blocked"); } }) });
    const push = vi.fn();
    expect(() => openTask({ push }, "t9")).not.toThrow();
    expect(push).toHaveBeenCalledWith("/item/t9");
  });

  // Phase 5b: a row shown in a List through a link opens the task IN that
  // List's context, so its drawer shows that List's own fields.
  it("pushes exactly today's URL for the two-argument call", () => {
    const push = vi.fn();
    openTask({ push }, "t9");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]).toEqual(["/item/t9"]);
  });

  it("adds ?list= when a list context is given", () => {
    const push = vi.fn();
    openTask({ push }, "t9", { listId: "listB" });
    expect(push).toHaveBeenCalledWith("/item/t9?list=listB");
  });

  it("adds nothing for a null or empty list context", () => {
    const push = vi.fn();
    openTask({ push }, "t9", { listId: null });
    openTask({ push }, "t9", { listId: "" });
    openTask({ push }, "t9", {});
    expect(push.mock.calls).toEqual([["/item/t9"], ["/item/t9"], ["/item/t9"]]);
  });

  it("encodes the list id", () => {
    const push = vi.fn();
    openTask({ push }, "t9", { listId: "a b" });
    expect(push).toHaveBeenCalledWith("/item/t9?list=a%20b");
  });
});
