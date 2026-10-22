// Ended sessions (2026-10-22): the id format, how long a row is kept, and
// the nightly sweep.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../oauth/oauth-test-db")).testDb.prisma }));

import { seed, testDb as db } from "../oauth/oauth-test-db";
import { endedSessionExpiry, isSessionEnded, isSessionId, legacySessionId, newSessionId, recordEndedSession, sweepEndedSessions } from "./ended-sessions";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T09:00:00.000Z");

beforeEach(() => db.reset());

describe("session ids", () => {
  it("are 128 random bits in base64url, a new one every time", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(isSessionId(a)).toBe(true);
    expect(isSessionId("short")).toBe(false);
    expect(isSessionId(undefined)).toBe(false);
  });

  it("derive the same id for every copy of a cookie from before session ids", () => {
    const at = NOW - 3 * DAY;
    expect(legacySessionId("u1", at)).toBe(legacySessionId("u1", at));
    expect(isSessionId(legacySessionId("u1", at))).toBe(true);
    expect(legacySessionId("u1", at)).not.toBe(legacySessionId("u1", at + 1));
    expect(legacySessionId("u1", at)).not.toBe(legacySessionId("u2", at));
    // No sign-in time to agree on: a random one.
    expect(legacySessionId("u1", undefined)).not.toBe(legacySessionId("u1", undefined));
  });
});

describe("how long a row is kept", () => {
  it("is the sign-in time plus the session's lifetime", () => {
    expect(endedSessionExpiry(NOW - DAY, 90, NOW).getTime()).toBe(NOW - DAY + 90 * DAY);
  });
  it("takes the 90 day default when the token carries no lifetime", () => {
    expect(endedSessionExpiry(NOW - DAY, undefined, NOW).getTime()).toBe(NOW - DAY + 90 * DAY);
  });
  it("outlives the cookie's own 30 days from now, so a copy nobody renews dies first", () => {
    expect(endedSessionExpiry(NOW - 29 * DAY, 30, NOW).getTime()).toBe(NOW + 31 * DAY);
  });
  it("is capped at 365 days from now", () => {
    expect(endedSessionExpiry(NOW, 365, NOW).getTime()).toBe(NOW + 365 * DAY);
    expect(endedSessionExpiry(NOW + 10 * DAY, 365, NOW).getTime()).toBe(NOW + 365 * DAY);
  });
});

describe("the list", () => {
  it("records a session once and finds it by its id", async () => {
    const sid = newSessionId();
    await recordEndedSession({ sid, userId: "u1", authAt: NOW - DAY, maxDays: 90, now: new Date(NOW) });
    await recordEndedSession({ sid, userId: "u1", authAt: NOW - DAY, maxDays: 90, now: new Date(NOW + 60_000) });
    expect(db.rows.endedSession).toHaveLength(1);
    expect(db.rows.endedSession[0]).toMatchObject({ sid, userId: "u1", endedAt: new Date(NOW), expiresAt: new Date(NOW - DAY + 90 * DAY) });
    expect(await isSessionEnded(sid)).toBe(true);
    expect(await isSessionEnded(newSessionId())).toBe(false);
  });

  it("takes a log out of the same session racing it (a double click) as written, and throws on anything else", async () => {
    const model = (db.prisma as unknown as { endedSession: { upsert: (...a: unknown[]) => Promise<unknown> } }).endedSession;
    const race = vi.spyOn(model, "upsert").mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    await expect(recordEndedSession({ sid: newSessionId(), userId: "u1" })).resolves.toBeUndefined();
    race.mockRejectedValueOnce(new Error('relation "EndedSession" does not exist'));
    await expect(recordEndedSession({ sid: newSessionId(), userId: "u1" })).rejects.toThrow();
    race.mockRestore();
  });

  it("is swept past expiresAt, a batch at a time, and keeps the live rows", async () => {
    for (let i = 0; i < 5; i++) seed(db, "endedSession", { sid: `old-${i}`, userId: "u1", endedAt: new Date(NOW - 100 * DAY), expiresAt: new Date(NOW - DAY) });
    seed(db, "endedSession", { sid: "live", userId: "u1", endedAt: new Date(NOW), expiresAt: new Date(NOW + DAY) });
    expect(await sweepEndedSessions(new Date(NOW), 2)).toBe(5);
    expect(db.rows.endedSession.map((r) => r.sid)).toEqual(["live"]);
  });
});
