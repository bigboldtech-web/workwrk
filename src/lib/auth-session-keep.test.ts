// Nobody is logged out by accident (2026-10-22, the founder: "Dont Logout
// Anyone"). Two of the four causes live in the jwt callback and the signOut
// event of src/lib/auth.ts:
//
//   a failed database read logged people out: next-auth clears the cookie
//   whenever the jwt callback throws, so a read that throws now keeps the
//   token as it was, unchecked, and never throws;
//
//   a plain log out logged out every device: it bumped tokenVersion, so it
//   now lists the token's session id instead, and only that session (and any
//   copy of its cookie) ends.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./oauth/oauth-test-db")).testDb.prisma }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));

import { legacyLevelRow } from "./access/test-fixtures";
import { authOptions, endedHintOf } from "./auth";
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
let errors: MockInstance;

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
  sid: SID_A,
  ...o,
});

beforeEach(() => {
  db.reset();
  seed(db, "organization", { id: "org-a", name: "Acme", status: "ACTIVE", settings: {} });
  seed(db, "organization", { id: "org-b", name: "Beta", status: "ACTIVE", settings: {} });
  seed(db, "user", { id: "u1", email: "max@acme.test", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 3, organization: { status: "ACTIVE", name: "Acme" } });
  seed(db, "organizationMembership", { id: "m1", userId: "u1", organizationId: "org-b", role: "EMPLOYEE" });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  db.failing.clear();
  vi.restoreAllMocks();
});

describe("a database read that fails never logs anyone out", () => {
  it("the five-minute check: the account read throws, so the token is kept as it was and checked again next time", async () => {
    await jwt({ token: token() }); // a check that succeeds: nothing is failing yet
    db.failing.add("user");
    const before = token({ revoked: false });
    const out = await jwt({ token: { ...before } });
    expect(out.revoked).toBe(false);
    expect(out.checkedAt).toBe(0);
    expect(out.tokenVersion).toBe(3);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
    // Still failing on the next request: still kept, and logged once only.
    const again = await jwt({ token: out });
    expect(again.revoked).toBe(false);
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("session_check_failed"))).toHaveLength(1);
    // Back: the very next request checks, and a definite answer still ends it.
    db.failing.clear();
    account().deletedAt = new Date();
    const after = await jwt({ token: again });
    expect(after.revoked).toBe(true);
    expect((await sessionOf(after)).user).toBeUndefined();
  });

  it("the membership read throws for a token acting in another workspace: kept as it was", async () => {
    db.failing.add("organizationMembership");
    const out = await jwt({ token: token({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("COMPANY_ADMIN") }) });
    expect(out).toMatchObject({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("COMPANY_ADMIN"), checkedAt: 0 });
    expect(out.revoked).not.toBe(true);
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1", organizationId: "org-b" });
  });

  it("the holds read throws: a two step hold stays on and the windows stay as they were", async () => {
    db.failing.add("organization");
    const out = await jwt({ token: token({ mfaHold: true, idleMin: 60, maxDays: 7 }) });
    expect(out).toMatchObject({ mfaHold: true, idleMin: 60, maxDays: 7, checkedAt: 0 });
    expect(out.revoked).not.toBe(true);
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

  it("a log out from a cookie with no session id still bumps, as before", async () => {
    await logOut({ id: "u1", organizationId: "org-a" });
    expect(account().tokenVersion).toBe(4);
    expect(db.rows.endedSession ?? []).toEqual([]);
  });

  it("a log out whose row cannot be written falls back to the bump (the table not there yet)", async () => {
    db.failing.add("endedSession");
    await logOut(token());
    db.failing.clear();
    expect(account().tokenVersion).toBe(4);
  });

  it("a failed read of the list ends nothing, and the rest of the check still runs", async () => {
    db.failing.add("endedSession");
    db.rows.organization[0].name = "Acme Renamed";
    (account().organization as Tok).name = "Acme Renamed";
    const out = await jwt({ token: token() });
    expect(out.revoked).toBe(false);
    expect(out.policyEnded).not.toBe(true);
    expect(out.checkedAt).not.toBe(0);
    expect(out.organizationName).toBe("Acme Renamed");
    expect((await sessionOf(out)).user).toMatchObject({ id: "u1" });
  });
});

describe("session ids", () => {
  const signIn = () =>
    jwt({
      token: {},
      user: { id: "u1", ...legacyLevelRow("EMPLOYEE"), organizationId: "org-a", organizationName: "Acme", firstName: "Max", lastName: "M", avatar: null, tokenVersion: 3 },
    });

  it("every sign-in gets a new random one", async () => {
    const a = await signIn();
    const b = await signIn();
    expect(a.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.sid).not.toBe(b.sid);
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

describe("what an ended session says", () => {
  it("names every device only for a real revocation", async () => {
    account().tokenVersion = 4;
    const bumped = await jwt({ token: token() });
    expect((await sessionOf(bumped)).ended).toBe("revoked");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "signed_out" })).toBe("revoked");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "idle" })).toBe("expired");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "lifetime" })).toBe("expired");
    expect(endedHintOf({ policyEnded: true, policyEndedReason: "logged_out" })).toBeUndefined();
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
