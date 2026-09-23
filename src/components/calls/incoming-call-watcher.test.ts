// The incoming-call ring clock. The watcher itself is a component and this
// suite is node-only by design (vitest.config.ts), so what is tested here is
// the pair of pure functions the component's bookkeeping is built on. They
// carry the whole of the fix: a ring window that is measured from the call,
// not from the last render, and a first-sight store that a 15s poll cannot
// reset.

import { describe, expect, it } from "vitest";
import { keepFirstSeen, ringRemainingMs } from "./incoming-call-watcher";

const RING_MS = 45_000;
const T0 = Date.parse("2026-09-23T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("ringRemainingMs", () => {
  it("gives a call the full ring window the moment it starts", () => {
    expect(ringRemainingMs(iso(T0), T0, T0)).toBe(RING_MS);
  });

  it("keeps counting down across polls instead of restarting", () => {
    // Three backstop polls, 15s apart, first sight unchanged. This is the
    // regression: the old effect re-armed a fresh 45s timeout on every one of
    // these, so the ring never ended.
    expect(ringRemainingMs(iso(T0), T0, T0 + 15_000)).toBe(30_000);
    expect(ringRemainingMs(iso(T0), T0, T0 + 30_000)).toBe(15_000);
    expect(ringRemainingMs(iso(T0), T0, T0 + 45_000)).toBe(0);
  });

  it("stays rung out once the window is spent, however long the call lives", () => {
    // /api/calls/incoming keeps reporting a live call for two minutes, and
    // every roster change re-reads it. Nothing in that may put the card back.
    expect(ringRemainingMs(iso(T0), T0, T0 + 60_000)).toBe(0);
    expect(ringRemainingMs(iso(T0), T0, T0 + 119_000)).toBe(0);
  });

  it("does not ring a call that was already old when this tab first saw it", () => {
    const firstSeen = T0 + 60_000; // tab was hidden for the first minute
    expect(ringRemainingMs(iso(T0), firstSeen, firstSeen)).toBe(0);
  });

  it("falls back to first sight when the browser's clock disagrees", () => {
    const firstSeen = T0;
    // Clock minutes fast: believing it would expire every call on arrival and
    // the user would never hear a ring at all.
    expect(ringRemainingMs(iso(T0 - 600_000), firstSeen, firstSeen)).toBe(RING_MS);
    // Clock behind, so the call appears to start in the future.
    expect(ringRemainingMs(iso(T0 + 600_000), firstSeen, firstSeen)).toBe(RING_MS);
    // No timestamp at all, and a nonsense one.
    expect(ringRemainingMs(undefined, firstSeen, firstSeen + 15_000)).toBe(30_000);
    expect(ringRemainingMs("not a date", firstSeen, firstSeen + 15_000)).toBe(30_000);
  });
});

describe("keepFirstSeen", () => {
  it("remembers when each call was first seen and forgets the ones that ended", () => {
    const first = keepFirstSeen(new Map(), ["a"], T0);
    expect(first.get("a")).toBe(T0);

    // A second call arrives 30s in. "a" keeps its own clock: the timers are
    // not shared-fate any more, so "b" must not restart "a".
    const second = keepFirstSeen(first, ["a", "b"], T0 + 30_000);
    expect(second.get("a")).toBe(T0);
    expect(second.get("b")).toBe(T0 + 30_000);
    expect(ringRemainingMs(undefined, second.get("a")!, T0 + 30_000)).toBe(15_000);
    expect(ringRemainingMs(undefined, second.get("b")!, T0 + 30_000)).toBe(RING_MS);

    // "a" ends, so it is forgotten, and the same conversation calling back
    // later is a new call with a fresh window.
    const third = keepFirstSeen(second, ["b"], T0 + 60_000);
    expect(third.has("a")).toBe(false);
    const fourth = keepFirstSeen(third, ["a", "b"], T0 + 300_000);
    expect(fourth.get("a")).toBe(T0 + 300_000);
    expect(fourth.get("b")).toBe(T0 + 30_000);
  });
});
