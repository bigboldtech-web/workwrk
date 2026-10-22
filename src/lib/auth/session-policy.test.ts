import { describe, expect, it } from "vitest";
import { NEXTAUTH_MAX_AGE_MIN, NEXTAUTH_MAX_AGE_S, sessionIdleUntil, sessionVerdict } from "./session-policy";

const H = 3_600_000;
describe("sessionVerdict", () => {
  it("keeps a 30 day idle ceiling when the org set nothing, so nobody is signed out overnight", () => {
    const now = 1000 * H;
    expect(NEXTAUTH_MAX_AGE_MIN).toBe(43_200);
    expect(NEXTAUTH_MAX_AGE_S).toBe(30 * 24 * 3600);
    expect(sessionVerdict({ seenAt: now - 13 * H }, now).ended).toBe(false);
    expect(sessionVerdict({ seenAt: now - 29 * 24 * H }, now).ended).toBe(false);
    expect(sessionVerdict({ seenAt: now - 31 * 24 * H }, now)).toEqual({ ended: true, reason: "idle" });
  });
  it("can only narrow the idle window", () => {
    const now = 1000 * H;
    expect(sessionVerdict({ seenAt: now - 31 * 60_000, idleMin: 30 }, now)).toEqual({ ended: true, reason: "idle" });
    expect(sessionVerdict({ seenAt: now - 13 * H, idleMin: 720 }, now)).toEqual({ ended: true, reason: "idle" });
    expect(sessionVerdict({ seenAt: now - 31 * 24 * H, idleMin: 99_999 }, now).ended).toBe(true);
  });
  it("ends a session at its absolute lifetime", () => {
    const now = 1000 * H;
    expect(sessionVerdict({ authAt: now - 31 * 24 * H, seenAt: now - 60_000, maxDays: 30 }, now)).toEqual({ ended: true, reason: "lifetime" });
  });
  it("starts the clock for a token that predates the rule", () => {
    const now = 1000 * H;
    const v = sessionVerdict({ seenAt: now - 60_000, maxDays: 30 }, now);
    expect(v).toEqual({ ended: false, authAt: now, seenAt: now });
  });
  it("names the boundary the idle warning arms on", () => {
    const now = 1000 * H;
    expect(sessionIdleUntil({ seenAt: now, idleMin: 30 }, now)).toBe(now + 30 * 60_000);
    expect(sessionIdleUntil({ seenAt: now, idleMin: 600, authAt: now - 30 * 24 * H + 60_000, maxDays: 30 }, now)).toBe(now + 60_000);
  });
  it("idle-times a token with no seenAt from its issue time, never from now", () => {
    const now = 100 * H;
    expect(sessionVerdict({ issuedAt: now - 13 * H, idleMin: 720 }, now)).toEqual({ ended: true, reason: "idle" });
    expect(sessionVerdict({ issuedAt: now - 60_000 }, now).ended).toBe(false);
    expect(sessionVerdict({ seenAt: now - 60_000, issuedAt: now - 13 * H }, now).ended).toBe(false);
    expect(sessionIdleUntil({ issuedAt: now - H, idleMin: 120 }, now)).toBe(now + H);
  });
});
