// The in-memory limiter (src/lib/rate-limit-memory.ts), shared with login
// throttling's neighbours (password reset, sign-up, MFA): its limits read
// exactly as before, and review round 1 of AI teammates Phase 3's pruning
// walks a full store at most once an interval and never drops a bucket whose
// window is still running.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Limiter = typeof import("./rate-limit-memory");

let limiter: Limiter;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T09:00:00Z"));
  // A fresh store for every test: the map lives in the module.
  vi.resetModules();
  limiter = await import("./rate-limit-memory");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Past the store's cap of 50,000 keys, each in a window of a minute. */
function fillPastTheCap(): void {
  for (let i = 0; i <= 50_001; i++) limiter.rateLimit(`fill:${i}`, { max: 5, windowMs: 60_000 });
}

describe("rateLimit", () => {
  it("allows max hits in the window, refuses the next with the seconds left, and allows again once the window is past", () => {
    const opts = { max: 3, windowMs: 60_000 };
    expect([1, 2, 3].map(() => limiter.rateLimit("login-ish:1.2.3.4", opts))).toEqual([
      { ok: true, retryAfter: 0 },
      { ok: true, retryAfter: 0 },
      { ok: true, retryAfter: 0 },
    ]);
    expect(limiter.rateLimit("login-ish:1.2.3.4", opts)).toEqual({ ok: false, retryAfter: 60 });
    vi.advanceTimersByTime(30_000);
    expect(limiter.rateLimit("login-ish:1.2.3.4", opts)).toEqual({ ok: false, retryAfter: 30 });
    // Another key is its own bucket.
    expect(limiter.rateLimit("login-ish:5.6.7.8", opts)).toEqual({ ok: true, retryAfter: 0 });
    vi.advanceTimersByTime(30_001);
    expect(limiter.rateLimit("login-ish:1.2.3.4", opts)).toEqual({ ok: true, retryAfter: 0 });
  });

  it("refuses every hit past max, never fewer, for the five-a-quarter-hour limits", () => {
    const opts = { max: 5, windowMs: 15 * 60 * 1000 };
    const answers = Array.from({ length: 12 }, () => limiter.rateLimit("forgot:email:max@x.test", opts).ok);
    expect(answers).toEqual([true, true, true, true, true, false, false, false, false, false, false, false]);
  });

  // Before: past the cap, a sweep dropped every bucket older than an hour, so
  // a day-long limit (one resend per invitation a day) was open again an hour
  // after its first hit.
  it("keeps a day-long limit closed through a sweep of a store past its cap", () => {
    const day = { max: 1, windowMs: 24 * 60 * 60 * 1000 };
    expect(limiter.rateLimit("invite-resend:inv:1", day).ok).toBe(true);
    expect(limiter.rateLimit("invite-resend:inv:1", day).ok).toBe(false);
    fillPastTheCap();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    // This call sweeps: the minute-long buckets go, the day-long one stays.
    limiter.rateLimit("trigger", { max: 5, windowMs: 60_000 });
    expect(limiter.rateLimit("invite-resend:inv:1", day)).toEqual({ ok: false, retryAfter: 22 * 60 * 60 });
  });

  // Before: past the cap, every call by every feature walked the whole map.
  it("walks a store past its cap at most once an interval", () => {
    fillPastTheCap();
    vi.advanceTimersByTime(1_000);
    const walk = vi.spyOn(Map.prototype, Symbol.iterator);
    for (let i = 0; i < 1_000; i++) limiter.rateLimit(`google-tools:u-${i % 50}`, { max: 30, windowMs: 60_000 });
    expect(walk.mock.calls.length).toBeLessThanOrEqual(1);
    vi.advanceTimersByTime(10_000);
    const before = walk.mock.calls.length;
    limiter.rateLimit("google-tools:u-1", { max: 30, windowMs: 60_000 });
    expect(walk.mock.calls.length).toBe(before + 1);
  });

  it("still limits the same while the store is past its cap", () => {
    fillPastTheCap();
    const opts = { max: 2, windowMs: 60_000 };
    expect([1, 2, 3].map(() => limiter.rateLimit("register:9.9.9.9", opts).ok)).toEqual([true, true, false]);
  });
});
