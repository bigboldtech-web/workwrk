import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { apiLimits, clientAddress, createLimiter, keyOk, PRUNE_MS } from "./auth.mjs";
import { sha256 } from "./config.mjs";

const KEY = "a-key-the-app-holds-0123456789abcdef";
const OTHER = "the-next-key-for-a-rotation-9876543210";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("keyOk", () => {
  it("takes the right key", () => {
    expect(keyOk(KEY, [sha256(KEY)])).toBe(true);
  });

  it("refuses a wrong key of any length, a missing one and an empty one, comparing both hashes every time", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    const hashes = [sha256(KEY), sha256(OTHER)];
    const wrong = ["", "x", KEY.slice(0, -1), `${KEY}x`, "y".repeat(5000), KEY.toUpperCase()];
    for (const w of wrong) expect(keyOk(w, hashes)).toBe(false);
    expect(keyOk(undefined, hashes)).toBe(false);
    expect(spy).toHaveBeenCalledTimes((wrong.length + 1) * 2);
  });

  it("compares both hashes even when the first matches", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(keyOk(KEY, [sha256(KEY), sha256(OTHER)])).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("takes either key of a rotation", () => {
    const hashes = [sha256(KEY), sha256(OTHER)];
    expect(keyOk(KEY, hashes)).toBe(true);
    expect(keyOk(OTHER, hashes)).toBe(true);
    expect(keyOk(OTHER, [sha256(KEY)])).toBe(false);
  });
});

describe("the auth failure limit", () => {
  it("blocks an address for 10 minutes after 10 failures in a minute, and no other address", () => {
    let now = 0;
    const l = apiLimits(() => now);
    for (let i = 0; i < 9; i += 1) l.authFailures.hit("203.0.113.9");
    expect(l.authFailures.blocked("203.0.113.9")).toBe(0);
    l.authFailures.hit("203.0.113.9");
    expect(l.authFailures.blocked("203.0.113.9")).toBe(600);
    expect(l.authFailures.blocked("198.51.100.4")).toBe(0);
    now += 9 * 60_000;
    expect(l.authFailures.blocked("203.0.113.9")).toBe(60);
    now += 60_000;
    expect(l.authFailures.blocked("203.0.113.9")).toBe(0);
  });

  it("forgets failures spread over more than a minute", () => {
    let now = 0;
    const l = apiLimits(() => now);
    for (let i = 0; i < 20; i += 1) {
      l.authFailures.hit("203.0.113.9");
      now += 10_000;
    }
    expect(l.authFailures.blocked("203.0.113.9")).toBe(0);
  });
});

describe("a rate limit", () => {
  it("answers the seconds until its window frees", () => {
    let now = 0;
    const l = createLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    expect([l.hit("all"), l.hit("all"), l.hit("all")]).toEqual([0, 0, 0]);
    now = 15_000;
    expect(l.hit("all")).toBe(45);
    now = 60_000;
    expect(l.hit("all")).toBe(0);
  });

  it("has the API's numbers: 120 requests and 30 creates a minute", () => {
    const l = apiLimits(() => 0);
    for (let i = 0; i < 120; i += 1) expect(l.requests.hit("all")).toBe(0);
    expect(l.requests.hit("all")).toBeGreaterThan(0);
    for (let i = 0; i < 30; i += 1) expect(l.creates.hit("all")).toBe(0);
    expect(l.creates.hit("all")).toBeGreaterThan(0);
  });
});

describe("an address is kept for its window only, by a timer too (the privacy page's memory alone)", () => {
  it("is forgotten once its window has passed, with no later hit to prune it", () => {
    vi.useFakeTimers();
    let now = 0;
    const l = createLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    l.hit("203.0.113.9");
    l.hit("198.51.100.4");
    expect(l.size()).toBe(2);
    // Still inside the window: kept, for the limit.
    now = 30_000;
    vi.advanceTimersByTime(30_000);
    expect(l.size()).toBe(2);
    now = 60_000;
    vi.advanceTimersByTime(PRUNE_MS);
    expect(l.size()).toBe(0);
    l.stop();
  });

  it("keeps a blocked address until its block ends, then forgets it", () => {
    vi.useFakeTimers();
    let now = 0;
    const l = apiLimits(() => now);
    for (let i = 0; i < 10; i += 1) l.authFailures.hit("203.0.113.9");
    expect(l.authFailures.blocked("203.0.113.9")).toBe(600);
    now = 5 * 60_000;
    vi.advanceTimersByTime(5 * 60_000);
    expect(l.authFailures.size()).toBe(1);
    now = 10 * 60_000;
    vi.advanceTimersByTime(PRUNE_MS);
    expect(l.authFailures.size()).toBe(0);
    l.stop();
  });

  it("prunes no later than PRUNE_MS past the window, even just after a hit pruned", () => {
    vi.useFakeTimers({ now: 0 });
    const l = createLimiter({ limit: 3, windowMs: 60_000, now: () => Date.now() });
    l.hit("203.0.113.9");
    vi.advanceTimersByTime(60_000);
    // This hit prunes the first address, at its window's end.
    l.hit("198.51.100.4");
    expect(l.size()).toBe(1);
    vi.advanceTimersByTime(1000);
    l.hit("192.0.2.7");
    // Both windows have passed, the later one by less than PRUNE_MS: both forgotten.
    vi.advanceTimersByTime(60_000 + PRUNE_MS - 1000);
    expect(l.size()).toBe(0);
    l.stop();
  });

  it("its timer never keeps the process alive, and stop clears it and forgets every address", () => {
    const set = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const l = createLimiter({ limit: 3, windowMs: 60_000, now: () => 0 });
    expect(set).toHaveBeenCalledTimes(1);
    const handle = set.mock.results[0].value as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
    l.hit("203.0.113.9");
    l.stop();
    expect(clear).toHaveBeenCalledWith(handle);
    expect(l.size()).toBe(0);
  });

  it("the API's three limits stop together", () => {
    const set = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval");
    const l = apiLimits(() => 0);
    const handles = set.mock.results.map((r) => r.value);
    expect(handles).toHaveLength(3);
    l.stop();
    for (const h of handles) expect(clear).toHaveBeenCalledWith(h);
  });
});

describe("clientAddress", () => {
  const req = (remoteAddress: string, xff?: string) => ({ socket: { remoteAddress }, headers: xff ? { "x-forwarded-for": xff } : {} });

  it("reads X-Forwarded-For only from 127.0.0.1 (Caddy)", () => {
    expect(clientAddress(req("127.0.0.1", "203.0.113.9"))).toBe("203.0.113.9");
    expect(clientAddress(req("::ffff:127.0.0.1", "203.0.113.9"))).toBe("203.0.113.9");
    expect(clientAddress(req("10.0.0.5", "203.0.113.9"))).toBe("10.0.0.5");
    expect(clientAddress(req("198.51.100.4", "127.0.0.1"))).toBe("198.51.100.4");
  });

  it("takes the nearest proxy's entry, and the peer without one", () => {
    expect(clientAddress(req("127.0.0.1", "1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientAddress(req("127.0.0.1"))).toBe("127.0.0.1");
  });
});
