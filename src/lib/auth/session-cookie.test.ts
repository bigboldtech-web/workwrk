// The shared helper behind consent and the privileged writes
// (src/lib/auth/session-cookie.ts, review of the longer-sessions fix, L2):
// the id a raw cookie goes by, and what a cookie it cannot read decides.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ raw: null as null | Record<string, unknown>, jarThrows: false }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../oauth/oauth-test-db")).testDb.prisma }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => st.raw }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (st.jarThrows) throw new Error("cookies was called outside a request scope");
    return { getAll: () => [] };
  },
}));

import { legacySessionId } from "./ended-sessions";
import { readSessionCookie, sessionEndedNow, sessionIdOfToken } from "./session-cookie";
import { seed, testDb as db } from "../oauth/oauth-test-db";

const SID = "AAAAAAAAAAAAAAAAAAAAAA";
const AUTH_AT = Date.parse("2026-10-20T09:00:00.000Z");

beforeEach(() => {
  db.reset();
  st.raw = { id: "u1", authAt: AUTH_AT, sid: SID };
  st.jarThrows = false;
});

describe("the session cookie, read raw", () => {
  it("names the id a raw token goes by: its own, else the derived one, else none", () => {
    expect(sessionIdOfToken({ sid: SID, id: "u", authAt: 1 })).toBe(SID);
    expect(sessionIdOfToken({ id: "u1", authAt: AUTH_AT })).toBe(legacySessionId("u1", AUTH_AT));
    expect(sessionIdOfToken({ id: "u1" })).toBeNull();
    expect(sessionIdOfToken({})).toBeNull();
  });

  it("reads the account, the sign-in time, the id and whether the cookie says it ended", async () => {
    st.raw = { id: "u1", authAt: AUTH_AT, sid: SID, revoked: true };
    expect(await readSessionCookie()).toEqual({ id: "u1", authAt: AUTH_AT, ended: true, sid: SID });
  });

  it("decides nothing when there is no cookie, or no request to read one from", async () => {
    seed(db, "endedSession", { sid: SID, userId: "u1", endedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await sessionEndedNow("u1")).toBe(true);
    st.raw = null;
    expect(await sessionEndedNow("u1")).toBe(false);
    st.raw = { id: "u1", authAt: AUTH_AT, sid: SID };
    st.jarThrows = true;
    expect(await readSessionCookie()).toBeNull();
    expect(await sessionEndedNow("u1")).toBe(false);
  });
});
