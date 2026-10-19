import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { apiLimits, clientAddress, createLimiter, keyOk } from "./auth.mjs";
import { sha256 } from "./config.mjs";

const KEY = "a-key-the-app-holds-0123456789abcdef";
const OTHER = "the-next-key-for-a-rotation-9876543210";

afterEach(() => vi.restoreAllMocks());

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
