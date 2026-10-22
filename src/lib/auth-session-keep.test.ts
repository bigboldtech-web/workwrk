// Nobody is logged out by accident (2026-10-22, the founder: "Dont Logout
// Anyone"). Two of the four causes live in the jwt callback and the signOut
// event of src/lib/auth.ts:
//
//   a failed database read logged people out: next-auth clears the cookie
//   whenever the jwt callback throws, so a read that throws now keeps what it
//   could not read as it was, never throws, and is tried again in 30
//   seconds; what it could read still applies (the review's M1: a check that
//   keeps failing no longer hides revocations forever or asks on every
//   request, and checks that fail for 24 hours on end end the session);
//
//   a plain log out logged out every device: it bumped tokenVersion, so it
//   now lists the token's session id instead, and only that session (and any
//   copy of its cookie) ends.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth/oauth-test-db")).testDb.prisma }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));

import { legacyLevelRow } from "./access/test-fixtures";
import { CHECK_RETRY_MS, UNCHECKED_LIMIT_MS, authOptions, endedHintOf, resetSessionChecks } from "./auth";
import { legacySessionId, newSessionId } from "./auth/ended-sessions";
import { seed, testDb as db } from "./oauth/oauth-test-db";

type Tok = Record<string, unknown>;
const jwt = (args: Record<string, unknown>) => (authOptions.callbacks!.jwt as unknown as (a: Record<string, unknown>) => Promise<Tok>)(args);
const sessionOf = (token: Tok) =>
  (authOptions.callbacks!.session as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
    session: { user: { name: "Max" }, expires: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    token,
  });
const logOut = (token: Tok) => authOptions.events!.signOut!({ token, session: null } as never);

const H = 3_600_000;
const DAY = 24 * H;
const REVALIDATE = 5 * 60_000;
const T0 = Date.parse("2026-10-22T09:00:00.000Z");
/** A check with a failed read is tried again 30 seconds on. */
const RETRY_AT = (t: number) => t - REVALIDATE + CHECK_RETRY_MS;
let errors: MockInstance;

type Model = { findUnique: (a: { select?: Record<string, unknown> }) => Promise<unknown> };
const model = (name: string) => (db.prisma as unknown as Record<string, Model>)[name];
const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { code });
/** Schema drift: the full account read names a column the database lacks; the four columns still answer. */
const drift = () => {
  const users = model("user");
  const real = users.findUnique.bind(users);
  return vi.spyOn(users, "findUnique").mockImplementation(async (a) => {
    if (a.select && "mfaEnabled" in a.select) throw prismaError("P2022");
    return real(a);
  });
};
const failedLines = (needle: string) => errors.mock.calls.filter((c) => String(c[0]).includes(needle));

const account = () => db.rows.user.find((u) => u.id === "u1")!;
const SID_A = newSessionId();
const SID_B = newSessionId();
/** A signed-in token, due its five-minute check. */
const token = (o: Tok = {}): Tok => ({
  id: "u1",
  organizationId: "org-a",
  organizationName: "Acme",
  ...legacyLevelRow("EMPLOYEE"),
  tokenVersion: 3,
  authAt: Date.now() - H,
  seenAt: Date.now() - 60_000,
  checkedAt: 0,
  lastGoodCheckAt: Date.now() - H,
  sid: SID_A,
  ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  resetSessionChecks();
  db.reset();
  seed(db, "organization", { id: "org-a", name: "Acme", status: "ACTIVE", settings: {} });
  seed(db, "organization", { id: "org-b", name: "Beta", status: "ACTIVE", settings: {} });
  seed(db, "user", { id: "u1", email: "max@acme.test", firstName: "Max", lastName: "M", avatar: null, organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 3, organization: { status: "ACTIVE", name: "Acme", settings: {} } });
  seed(db, "organizationMembership", { id: "m1", userId: "u1", organizationId: "org-b", role: "EMPLOYEE" });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  db.failing.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a database read that fails never logs anyone out", () => {
  it("the five-minute check: the account read throws, so the token is kept as it was and checked again in 30 seconds", async () => {
    await jwt({ token: token() }); // a check that succeeds: nothing is failing yet
    db.failing.add("user");
    const before = token({ revoked: false });
    const out = await jwt({ token: { ...before } });
    expect(out.revoked).toBe(false);
    expect(out.checkedAt).toBe(RETRY_AT(T0));
    expect(out.tokenVersion).toBe(3);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
    // Still failing ten seconds on: not asked, still kept, and logged once.
    vi.setSystemTime(T0 + 10_000);
    const again = await jwt({ token: out });
    expect(again.revoked).toBe(false);
    expect(failedLines("session_check_failed")).toHaveLength(1);
    // Back, and the retry due: checked, and a definite answer still ends it.
    db.failing.clear();
    account().deletedAt = new Date();
    vi.setSystemTime(T0 + CHECK_RETRY_MS + 1_000);
    const after = await jwt({ token: again });
    expect(after.revoked).toBe(true);
    expect((await sessionOf(after)).user).toBeUndefined();
  });

  it("is not asked again on every request for a cookie nobody re-issues: once in 30 seconds, in this process", async () => {
    db.failing.add("user");
    const reads = vi.spyOn(model("user"), "findUnique");
    // A route handler reads the cookie and cannot re-issue it, so each request brings the same stale token.
    const stale = token();
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(T0 + i * 5_000);
      const out = await jwt({ token: { ...stale } });
      expect(out.revoked, `request ${i}`).not.toBe(true);
    }
    const first = reads.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(2); // the full read and the four columns, once
    vi.setSystemTime(T0 + CHECK_RETRY_MS + 1_000);
    await jwt({ token: { ...stale } });
    expect(reads.mock.calls.length).toBeGreaterThan(first);
  });

  it("the membership read throws for a token acting in another workspace: kept as it was, retried in 30 seconds", async () => {
    db.failing.add("organizationMembership");
    const out = await jwt({ token: token({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("COMPANY_ADMIN") }) });
    expect(out).toMatchObject({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("COMPANY_ADMIN"), checkedAt: RETRY_AT(T0) });
    expect(out.revoked).not.toBe(true);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1", organizationId: "org-b" });
  });

  it("the holds read throws: a two step hold stays on and the windows stay as they were", async () => {
    db.failing.add("organization");
    const out = await jwt({ token: token({ mfaHold: true, idleMin: 60, maxDays: 7 }) });
    expect(out).toMatchObject({ mfaHold: true, idleMin: 60, maxDays: 7, checkedAt: RETRY_AT(T0) });
    expect(out.revoked).not.toBe(true);
    // The account and the list answered: the session was checked for revocation.
    expect(out.lastGoodCheckAt).toBe(T0);
  });

  it("session.update(): the account read throws, so nothing is revoked and nothing is thrown", async () => {
    db.failing.add("user");
    const out = await jwt({ token: token({ checkedAt: Date.now() }), trigger: "update", session: {} });
    expect(out.revoked).not.toBe(true);
    expect(out.tokenVersion).toBe(3);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
  });

  it("definite answers still end it: no row, removed, deactivated, or a tokenVersion moved past", async () => {
    account().tokenVersion = 4;
    expect((await jwt({ token: token() })).revoked).toBe(true);
    account().tokenVersion = 3;
    account().status = "INACTIVE";
    expect((await jwt({ token: token() })).revoked).toBe(true);
    account().status = "ACTIVE";
    account().deletedAt = new Date();
    expect((await jwt({ token: token() })).revoked).toBe(true);
    db.rows.user = [];
    expect((await jwt({ token: token() })).revoked).toBe(true);
  });
});

describe("schema drift: the full account read fails, and the columns that must exist still answer", () => {
  it("removed, deactivated or a tokenVersion moved past still ends it", async () => {
    drift();
    account().deletedAt = new Date();
    expect(await jwt({ token: token() })).toMatchObject({ revoked: true, revokedBy: "account" });
    account().deletedAt = null;
    account().status = "INACTIVE";
    expect(await jwt({ token: token() })).toMatchObject({ revoked: true, revokedBy: "account" });
    account().status = "ACTIVE";
    account().tokenVersion = 4;
    expect(await jwt({ token: token() })).toMatchObject({ revoked: true, revokedBy: "version" });
  });

  it("a plain log out still ends it", async () => {
    drift();
    seed(db, "endedSession", { sid: SID_A, userId: "u1", endedAt: new Date(), expiresAt: new Date(Date.now() + DAY) });
    expect(await jwt({ token: token() })).toMatchObject({ policyEnded: true, policyEndedReason: "logged_out" });
  });

  it("a live account keeps the rest as it was, counts as checked for revocation, and is tried again in 30 seconds", async () => {
    drift();
    const out = await jwt({ token: token({ mfaHold: true, idleMin: 60, organizationId: "org-b", organizationName: "Beta" }) });
    expect(out).toMatchObject({ mfaHold: true, idleMin: 60, organizationId: "org-b", organizationName: "Beta", checkedAt: RETRY_AT(T0), lastGoodCheckAt: T0 });
    expect(out.revoked).not.toBe(true);
    expect(out.uncheckedSince).toBeUndefined();
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
  });

  it("a database that cannot be reached is not asked a second time", async () => {
    const reads = vi.spyOn(model("user"), "findUnique").mockRejectedValue(prismaError("P1001"));
    const out = await jwt({ token: token() });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(out.revoked).not.toBe(true);
    expect(out.checkedAt).toBe(RETRY_AT(T0));
  });
});

describe("checks that fail for 24 hours on end end the session", () => {
  it("ends it as unchecked, and the dialog says nothing about devices", async () => {
    db.failing.add("user");
    let t = token();
    t = await jwt({ token: t });
    expect(t).toMatchObject({ uncheckedSince: T0, lastGoodCheckAt: T0 - H });
    vi.setSystemTime(T0 + 12 * H);
    t = await jwt({ token: t });
    expect(t.policyEnded).not.toBe(true);
    vi.setSystemTime(T0 + UNCHECKED_LIMIT_MS + 60_000);
    t = await jwt({ token: t });
    expect(t).toMatchObject({ policyEnded: true, policyEndedReason: "unchecked" });
    const s = await sessionOf(t);
    expect(s.user).toBeUndefined();
    expect(s.ended).toBeUndefined();
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "unchecked" })).toBeUndefined();
    // Ended stays ended, whatever the database says next.
    db.failing.clear();
    vi.setSystemTime(T0 + UNCHECKED_LIMIT_MS + 2 * REVALIDATE);
    expect((await jwt({ token: t })).policyEnded).toBe(true);
  });

  it("a good check in between starts the count again", async () => {
    db.failing.add("user");
    let t = await jwt({ token: token() });
    vi.setSystemTime(T0 + 20 * H);
    db.failing.clear();
    t = await jwt({ token: t });
    expect(t.lastGoodCheckAt).toBe(T0 + 20 * H);
    expect(t.uncheckedSince).toBeUndefined();
    db.failing.add("user");
    vi.setSystemTime(T0 + 30 * H);
    t = await jwt({ token: t });
    expect(t.policyEnded).not.toBe(true);
    expect(t.uncheckedSince).toBe(T0 + 30 * H);
  });

  it("a session left idle for days whose first check meets a blip is kept: the 24 hours count from the first failed check", async () => {
    db.failing.add("user");
    const out = await jwt({ token: token({ lastGoodCheckAt: T0 - 3 * DAY, checkedAt: T0 - 3 * DAY, seenAt: T0 - 3 * DAY, authAt: T0 - 4 * DAY }) });
    expect(out.policyEnded).not.toBe(true);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
    expect(out).toMatchObject({ lastGoodCheckAt: T0 - 3 * DAY, uncheckedSince: T0 });
  });

  it("a token from before starts its clock at its first check, even one that fails, so the rollout ends nobody", async () => {
    db.failing.add("user");
    const out = await jwt({ token: token({ lastGoodCheckAt: undefined, authAt: T0 - 20 * DAY }) });
    expect(out.policyEnded).not.toBe(true);
    expect(out).toMatchObject({ lastGoodCheckAt: T0, uncheckedSince: T0 });
  });

  it("a cookie nobody re-issues is bounded too, while this process runs", async () => {
    db.failing.add("user");
    const stale = token();
    expect((await jwt({ token: { ...stale } })).policyEnded).not.toBe(true);
    vi.setSystemTime(T0 + UNCHECKED_LIMIT_MS + 60_000);
    expect(await jwt({ token: { ...stale } })).toMatchObject({ policyEnded: true, policyEndedReason: "unchecked" });
  });
});

describe("the log of failed checks", () => {
  it("writes at most one line a minute per process, with how many failed since the last line", async () => {
    vi.spyOn(model("user"), "findUnique").mockRejectedValue(prismaError("P1001"));
    for (const at of [0, 10_000, 20_000, 30_000]) {
      vi.setSystemTime(T0 + at);
      await jwt({ token: token({ sid: newSessionId() }) });
    }
    expect(failedLines("[auth]")).toHaveLength(1);
    vi.setSystemTime(T0 + 61_000);
    await jwt({ token: token({ sid: newSessionId() }) });
    const lines = failedLines("[auth]");
    expect(lines).toHaveLength(2);
    expect(String(lines[1][0])).toContain("4 session reads failed since the last line");
    expect(String(lines[1][0])).toContain("P1001");
  });
});

describe("a plain log out ends only that browser's session", () => {
  it("lists the session and leaves the account's tokenVersion, and its AI apps, alone", async () => {
    const authAt = Date.now() - DAY;
    seed(db, "oAuthGrant", { id: "g1", clientId: "c", organizationId: "org-a", userId: "u1", tokenVersion: 3, revokedAt: null, endsBy: new Date(Date.now() + 30 * DAY) });
    await logOut(token({ authAt, maxDays: 90 }));
    expect(account().tokenVersion).toBe(3);
    expect(db.rows.oAuthGrant[0]).toMatchObject({ tokenVersion: 3, revokedAt: null });
    expect(db.rows.endedSession).toHaveLength(1);
    expect(db.rows.endedSession[0]).toMatchObject({ sid: SID_A, userId: "u1" });
    expect((db.rows.endedSession[0].expiresAt as Date).getTime()).toBe(authAt + 90 * DAY);
  });

  it("another session of the same person stays signed in after its next check", async () => {
    await logOut(token());
    const other = await jwt({ token: token({ sid: SID_B }) });
    expect(other.revoked).toBe(false);
    expect(other.policyEnded).not.toBe(true);
    expect((await sessionOf(other)).user).toMatchObject({ id: "u1" });
  });

  it("the logged-out session, and a copy of its cookie, end at their next check and stay ended", async () => {
    const cookie = token();
    await logOut(cookie);
    const copy = await jwt({ token: { ...cookie } });
    expect(copy).toMatchObject({ policyEnded: true, policyEndedReason: "logged_out" });
    expect((await sessionOf(copy)).user).toBeUndefined();
    // Swept, or not: once its cookie carries the end, it never comes back.
    db.rows.endedSession = [];
    const later = await jwt({ token: { ...copy, checkedAt: 0 } });
    expect(later.policyEnded).toBe(true);
    expect((await sessionOf(later)).user).toBeUndefined();
  });

  it("a log out from a cookie with no session id still bumps, as before, its AI apps moving with the account", async () => {
    seed(db, "oAuthGrant", { id: "g1", clientId: "c", organizationId: "org-a", userId: "u1", tokenVersion: 3, revokedAt: null, endsBy: new Date(Date.now() + 30 * DAY) });
    await logOut({ id: "u1", organizationId: "org-a" });
    expect(account().tokenVersion).toBe(4);
    expect(db.rows.oAuthGrant[0].tokenVersion).toBe(4);
    expect(db.rows.endedSession ?? []).toEqual([]);
  });

  it("a log out whose row cannot be written falls back to the ordinary log out's bump (the table not there yet): its AI apps move with the account", async () => {
    // signOutBump, not the plain bump: only it carries the grant along.
    seed(db, "oAuthGrant", { id: "g1", clientId: "c", organizationId: "org-a", userId: "u1", tokenVersion: 3, revokedAt: null, endsBy: new Date(Date.now() + 30 * DAY) });
    db.failing.add("endedSession");
    await logOut(token());
    db.failing.clear();
    expect(account().tokenVersion).toBe(4);
    expect(db.rows.oAuthGrant[0].tokenVersion).toBe(4);
  });

  it("and when that bump cannot run either, the plain bump still ends every session, leaving the grant behind", async () => {
    seed(db, "oAuthGrant", { id: "g1", clientId: "c", organizationId: "org-a", userId: "u1", tokenVersion: 3, revokedAt: null, endsBy: new Date(Date.now() + 30 * DAY) });
    db.failing.add("endedSession");
    db.failing.add("oAuthGrant");
    await logOut(token());
    db.failing.clear();
    expect(account().tokenVersion).toBe(4);
    expect(db.rows.oAuthGrant[0].tokenVersion).toBe(3);
  });

  it("a failed read of the list ends nothing, and the rest of the check still runs, but it is no good check: retried in 30 seconds", async () => {
    db.failing.add("endedSession");
    db.rows.organization[0].name = "Acme Renamed";
    (account().organization as Tok).name = "Acme Renamed";
    const out = await jwt({ token: token() });
    expect(out.revoked).toBe(false);
    expect(out.policyEnded).not.toBe(true);
    expect(out.checkedAt).toBe(RETRY_AT(T0));
    expect(out).toMatchObject({ lastGoodCheckAt: T0 - H, uncheckedSince: T0 });
    expect(out.organizationName).toBe("Acme Renamed");
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
  });

  it("a list that is not there yet (P2021) lists nobody, and the check counts as good", async () => {
    vi.spyOn(model("endedSession"), "findUnique").mockRejectedValue(prismaError("P2021"));
    const out = await jwt({ token: token() });
    expect(out.policyEnded).not.toBe(true);
    expect(out).toMatchObject({ checkedAt: T0, lastGoodCheckAt: T0 });
    expect(out.uncheckedSince).toBeUndefined();
  });
});

describe("session ids", () => {
  const signIn = () =>
    jwt({
      token: {},
      user: { id: "u1", ...legacyLevelRow("EMPLOYEE"), organizationId: "org-a", organizationName: "Acme", firstName: "Max", lastName: "M", avatar: null, tokenVersion: 3 },
    });

  it("every sign-in gets a new random one, and its first good check is the sign-in", async () => {
    const a = await signIn();
    const b = await signIn();
    expect(a.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.sid).not.toBe(b.sid);
    expect(a.lastGoodCheckAt).toBe(T0);
  });

  it("a token from before them gets one on its next run, the same for every copy of its cookie", async () => {
    const authAt = Date.now() - 2 * H;
    const old = { id: "u1", organizationId: "org-a", tokenVersion: 3, authAt, seenAt: Date.now() - 60_000, checkedAt: Date.now() };
    const first = await jwt({ token: { ...old } });
    const copy = await jwt({ token: { ...old } });
    expect(first.sid).toBe(legacySessionId("u1", authAt));
    expect(copy.sid).toBe(first.sid);
  });

  it("a copy taken before then ends too, once the browser has saved its id and logged out", async () => {
    const authAt = Date.now() - 2 * H;
    const old = { id: "u1", organizationId: "org-a", organizationName: "Acme", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 3, authAt, seenAt: Date.now() - 60_000, checkedAt: 0 };
    const saved = await jwt({ token: { ...old } });
    await logOut(saved);
    expect(account().tokenVersion).toBe(3);
    const copy = await jwt({ token: { ...old } });
    expect(copy).toMatchObject({ policyEnded: true, policyEndedReason: "logged_out" });
  });
});

describe("a Google sign-in", () => {
  // With no adapter, `user` is the Google profile, whose id is Google's own
  // subject; the token took it as the WorkwrK id and the first check revoked
  // the session (not live: production offers the password sign-in only).
  const google = (email: string) =>
    jwt({
      token: { name: "Max", email, sub: "google-sub-123" },
      user: { id: "google-sub-123", name: "Max", email },
      account: { provider: "google", type: "oauth", providerAccountId: "google-sub-123" },
      trigger: "signIn",
    });

  it("is the WorkwrK account with that email, and its first check keeps it", async () => {
    const t = await google("Max@Acme.test");
    expect(t).toMatchObject({ id: "u1", organizationId: "org-a", organizationName: "Acme", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 3, lastGoodCheckAt: T0 });
    expect(t.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t.revoked).not.toBe(true);
    expect((await sessionOf(t)).user).toMatchObject({ id: "u1", organizationId: "org-a" });
    vi.setSystemTime(T0 + REVALIDATE + 1_000);
    const later = await jwt({ token: t });
    expect(later.revoked).toBe(false);
    expect((await sessionOf(later)).user).toMatchObject({ id: "u1" });
  });

  it("gives no identity to an account gone since signIn admitted it", async () => {
    const t = await google("nobody@acme.test");
    expect(t.id).toBeUndefined();
    expect((await sessionOf(t)).user).toBeUndefined();
  });
});

describe("what an ended session says", () => {
  it("names every device only for a real revocation", async () => {
    account().tokenVersion = 4;
    const bumped = await jwt({ token: token() });
    expect((await sessionOf(bumped)).ended).toBe("revoked");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "signed_out" })).toBe("revoked");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "idle" })).toBe("expired");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "lifetime" })).toBe("expired");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "logged_out" })).toBeUndefined();
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "unchecked" })).toBeUndefined();
    expect(endedHintOf({ revoked: true, revokedBy: "account" })).toBeUndefined();
  });

  it("a session logged out in another browser says nothing about devices", async () => {
    const cookie = token();
    await logOut(cookie);
    const copy = await jwt({ token: { ...cookie } });
    const s = await sessionOf(copy);
    expect(s.user).toBeUndefined();
    expect(s.ended).toBeUndefined();
  });
});
