// useConfirmedSignOut (2026-10-22, review of the longer-sessions fix, L5):
// a failed session read is not a log out. "gone" answers true, so the frame
// goes to /login; "live" asks next-auth to read the session again and never
// answers true; a check that fails is asked again with a wait that grows from
// 2 seconds to 30 and never past it, at once when the browser comes back
// online, and nothing asks again once the answer is settled.
//
// The suite runs in node with no DOM, so React's two hooks are stood in for
// by a minimal renderer: state kept by call order, an effect run when its
// dependencies change and cleaned up before it runs again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  values: [] as unknown[],
  effects: [] as Array<{ deps?: unknown[]; cleanup?: () => void }>,
  i: 0,
  e: 0,
}));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = h.i++;
    if (!(i in h.values)) h.values[i] = typeof init === "function" ? (init as () => unknown)() : init;
    return [h.values[i], (v: unknown) => { h.values[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(h.values[i]) : v; }];
  },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const i = h.e++;
    const prev = h.effects[i];
    if (prev && deps && prev.deps && deps.every((d, k) => Object.is(d, prev.deps![k]))) return;
    prev?.cleanup?.();
    const cleanup = fn();
    h.effects[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
  },
}));

const checks = vi.hoisted(() => ({ answers: [] as Array<{ state: string; reason?: null }>, calls: [] as number[] }));
vi.mock("@/lib/api-fetch", () => ({
  checkSession: async () => {
    checks.calls.push(Date.now());
    return checks.answers.shift() ?? { state: "unknown" };
  },
}));
const resync = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/session-expiry", () => ({ resyncSessionState: () => { resync.count += 1; } }));

// Called through a plain name: the stand-in renderer below plays React.
import { useConfirmedSignOut as confirmedSignOut, type SessionStatus } from "./use-confirmed-sign-out";

const render = (status: SessionStatus): boolean => {
  h.i = 0;
  h.e = 0;
  return confirmedSignOut(status);
};
const unmount = () => {
  for (const e of h.effects) e?.cleanup?.();
  h.effects = [];
};
/** Let the awaited check settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-22T09:00:00.000Z"));
  vi.stubGlobal("window", new EventTarget());
  h.values = [];
  h.effects = [];
  checks.answers = [];
  checks.calls = [];
  resync.count = 0;
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useConfirmedSignOut", () => {
  it("asks nothing while signed in", async () => {
    expect(render("authenticated")).toBe(false);
    await settle();
    expect(checks.calls).toHaveLength(0);
  });

  it("answers true once the session route says the session is gone, so the frame goes to /login", async () => {
    checks.answers = [{ state: "gone", reason: null }];
    expect(render("unauthenticated")).toBe(false);
    await settle();
    expect(render("unauthenticated")).toBe(true);
  });

  it("asks next-auth to read the session again when it is live, and never answers true", async () => {
    checks.answers = [{ state: "live" }, { state: "live" }];
    render("unauthenticated");
    await settle();
    expect(resync.count).toBe(1);
    expect(render("unauthenticated")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(resync.count).toBe(2);
    expect(render("unauthenticated")).toBe(false);
    // next-auth has the session again: nothing more is asked.
    render("authenticated");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checks.calls).toHaveLength(2);
  });

  it("asks again after a failed check with a wait from 2 seconds that doubles up to 30 and stays there", async () => {
    render("unauthenticated");
    await settle();
    await vi.advanceTimersByTimeAsync(200_000);
    const waits = checks.calls.slice(1).map((t, k) => t - checks.calls[k]);
    expect(waits.slice(0, 6)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    for (const w of waits) {
      expect(w).toBeGreaterThanOrEqual(2_000);
      expect(w).toBeLessThanOrEqual(30_000);
    }
  });

  it("asks at once when the browser comes back online, and starts the wait again from 2 seconds", async () => {
    render("unauthenticated");
    await settle();
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    const before = checks.calls.length;
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(checks.calls).toHaveLength(before + 1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(checks.calls).toHaveLength(before + 2);
  });

  it("stops once settled: no timer and no coming back online asks again", async () => {
    checks.answers = [{ state: "unknown" }, { state: "gone", reason: null }];
    render("unauthenticated");
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(render("unauthenticated")).toBe(true);
    const settled = checks.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(checks.calls).toHaveLength(settled);
  });
});
