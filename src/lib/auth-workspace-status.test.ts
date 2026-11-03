// Sign-in, Google sign-in and the session check read a person's seat in each
// workspace (docs/plans/workspace-status.md step 2, D7). A seat is the
// account row where the account is anchored and the membership everywhere
// else; a usable seat is live there, in a workspace that is neither suspended
// nor closed.
//
//   An account ended where it is anchored (an old row) that still holds a
//   usable seat elsewhere moves there and signs in, instead of being refused
//   or revoked; with nowhere usable it is refused, exactly as before.
//   The fallback out of a suspended or closed workspace picks a usable SEAT,
//   never a seat the open workspace ended.
//   A token acting in another workspace whose membership is ended goes home,
//   exactly as one whose membership row is gone.
//
// Run on an in-memory database whose relations follow the rows
// (access/seat-test-db.ts), through the real move between workspaces.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import bcrypt from "bcryptjs";
import { generateSecret, generateSync } from "otplib";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./access/seat-test-db")).seatDb.prisma }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));

import { legacyLevelOfRow, legacyLevelRow } from "./access/test-fixtures";
import { authOptions, resetSessionChecks } from "./auth";
import { seatDb as db } from "./access/seat-test-db";

type Tok = Record<string, unknown>;
const jwt = (args: Record<string, unknown>) => (authOptions.callbacks!.jwt as unknown as (a: Record<string, unknown>) => Promise<Tok>)(args);
const sessionOf = (token: Tok) =>
  (authOptions.callbacks!.session as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
    session: { user: { name: "Pat" }, expires: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    token,
  });
const authorize = (email: string, password: string, mfaCode?: string) =>
  (authOptions.providers[0] as unknown as { options: { authorize: (c: Record<string, string>, r: unknown) => Promise<Record<string, unknown>> } }).options.authorize(
    { email, password, ...(mfaCode ? { mfaCode } : {}) },
    { headers: {} },
  );
/** Due again in 30 seconds: checkedAt = now - five minutes + 30 seconds. */
const retriedSoon = (checkedAt: unknown) => {
  const due = Date.now() - 5 * 60_000 + 30_000;
  return typeof checkedAt === "number" && checkedAt > due - 1_000 && checkedAt <= due;
};
const googleSignIn = (email: string) =>
  (authOptions.callbacks!.signIn as unknown as (a: Record<string, unknown>) => Promise<boolean | string>)({ account: { provider: "google" }, profile: { email } });
const googleSession = (email: string) =>
  jwt({ token: { email, sub: "google-sub" }, user: { id: "google-sub", email }, account: { provider: "google", type: "oauth", providerAccountId: "google-sub" }, trigger: "signIn" });

const PASSWORD = "pw-for-test";
const HASH = bcrypt.hashSync(PASSWORD, 4);
const pat = () => db.row("user", "pat");
const seat = (organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === "pat" && m.organizationId === organizationId)!;
let created = 0;
function membership(organizationId: string, extra: Record<string, unknown> = {}) {
  created += 1;
  return db.seed("organizationMembership", { id: `m-${organizationId}`, userId: "pat", organizationId, role: "EMPLOYEE", createdAt: new Date(Date.UTC(2026, 0, created)), ...extra });
}
/** A token signed in a while ago, due its five-minute check. */
const token = (o: Tok = {}): Tok => ({ id: "pat", organizationId: "org-a", organizationName: "Acme", ...legacyLevelRow("EMPLOYEE"), tokenVersion: 0, authAt: Date.now() - 3_600_000, seenAt: Date.now() - 60_000, checkedAt: 0, lastGoodCheckAt: Date.now() - 3_600_000, ...o });
let errors: MockInstance;

beforeEach(() => {
  db.reset();
  resetSessionChecks();
  created = 0;
  delete process.env.ENFORCE_MFA_AT_LOGIN;
  for (const [id, name, status] of [
    ["org-a", "Acme", "ACTIVE"],
    ["org-b", "Beta", "ACTIVE"],
    ["org-c", "Cee", "TRIAL"],
    ["org-sus", "Sus Co", "SUSPENDED"],
  ]) db.seed("organization", { id, name, status });
  // Pat is anchored in Acme as an Employee; each test gives him seats elsewhere.
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "P", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), passwordHash: HASH, createdAt: new Date("2025-01-01") });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("a password sign-in", () => {
  it("ended where anchored (an old row) with a usable seat elsewhere: moves there and signs in, at that seat's level", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { role: "MANAGER" });
    const user = await authorize("pat@x.test", PASSWORD);
    // Before: "This account is no longer active."
    expect(user).toMatchObject({ id: "pat", organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("MANAGER") });
    // A seat ended in a healthy workspace says nothing (as endSeat's move, D3).
    expect(user.workspaceMove).toBeUndefined();
    expect(pat()).toMatchObject({ organizationId: "org-b", status: "ACTIVE", deletedAt: null });
    // Acme keeps the ended seat on its membership.
    expect(seat("org-a")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(db.raw).toContain("lock:pat");
  });

  it("removed where anchored with a usable seat elsewhere: moves there too, and the workspace that removed them keeps the removal", async () => {
    const removedAt = new Date("2026-10-30T10:00:00Z");
    Object.assign(pat(), { status: "INACTIVE", deletedAt: removedAt });
    membership("org-c");
    expect(await authorize("pat@x.test", PASSWORD)).toMatchObject({ organizationId: "org-c", organizationName: "Cee" });
    expect(seat("org-a")).toMatchObject({ status: "INACTIVE", removedAt });
    expect(pat()).toMatchObject({ organizationId: "org-c", deletedAt: null });
  });

  it("ended with nowhere usable (each other seat ended, or in a suspended workspace): refused as before, and nothing is written", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { status: "INACTIVE" });
    membership("org-c", { status: "ACTIVE", removedAt: new Date("2026-10-01") });
    membership("org-sus");
    await expect(authorize("pat@x.test", PASSWORD)).rejects.toThrow("This account is no longer active. Contact your workspace admin.");
    expect(db.writes).toEqual([]);
    expect(pat()).toMatchObject({ organizationId: "org-a", status: "INACTIVE" });
  });

  it("passes over a workspace where an account with the same email is anchored, to the next usable seat", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { isPrimary: true });
    membership("org-c");
    db.seed("user", { id: "twin", email: "pat@x.test", firstName: "Pat", lastName: "Twin", organizationId: "org-b", passwordHash: "not-a-bcrypt-hash" });
    expect(await authorize("pat@x.test", PASSWORD)).toMatchObject({ id: "pat", organizationId: "org-c" });
  });

  it("an account its own person erased never comes back, whatever seat it still holds", async () => {
    const at = new Date("2026-10-30T10:00:00Z");
    Object.assign(pat(), { status: "INACTIVE", deletedAt: at });
    db.seed("consentRecord", { id: "cr", userId: "pat", method: "erasure", withdrawnAt: at, createdAt: at });
    membership("org-b");
    await expect(authorize("pat@x.test", PASSWORD)).rejects.toThrow("This account is no longer active.");
    expect(db.writes).toEqual([]);
  });

  it("out of a suspended workspace: the fallback picks a usable seat, never one the open workspace ended, and says why", async () => {
    pat().organizationId = "org-sus";
    // Beta is open and first (primary, oldest), but Beta deactivated Pat.
    membership("org-b", { isPrimary: true, status: "INACTIVE" });
    membership("org-c", { role: "MANAGER" });
    const user = await authorize("pat@x.test", PASSWORD);
    // Before: the move into Beta was refused (WouldLandEnded) and the sign-in failed.
    expect(user).toMatchObject({ organizationId: "org-c", ...legacyLevelRow("MANAGER") });
    expect(user.workspaceMove).toMatchObject({ from: "Sus Co", status: "SUSPENDED", to: "Cee" });
    expect(seat("org-b")).toMatchObject({ status: "INACTIVE" });
    expect(pat()).toMatchObject({ organizationId: "org-c", status: "ACTIVE" });
  });

  it("out of a suspended workspace with no usable seat: refused with the workspace's reason, nothing written", async () => {
    pat().organizationId = "org-sus";
    membership("org-b", { status: "INACTIVE" });
    await expect(authorize("pat@x.test", PASSWORD)).rejects.toThrow("This workspace is suspended. Please contact WorkwrK support.");
    expect(db.writes).toEqual([]);
  });

  // The step 2 review L3: the second factor is the rule of the workspace they land in.
  it("asks for the second factor the workspace it moves into requires, and signs in there with it", async () => {
    const secret = generateSecret();
    Object.assign(pat(), { status: "INACTIVE", mfaEnabled: true, mfaSecret: secret });
    // Acme asks nobody; Beta asks its Admins, and Pat is one there.
    db.row("organization", "org-b").settings = { security: { mfaRequired: "admins" } };
    membership("org-b", { role: "COMPANY_ADMIN" });
    // Before: signed in to Beta with the password alone.
    await expect(authorize("pat@x.test", PASSWORD)).rejects.toThrow("MFA_REQUIRED");
    // Moved already, so the resubmit reads Beta's rule and takes the code.
    expect(pat()).toMatchObject({ organizationId: "org-b", status: "ACTIVE" });
    expect(await authorize("pat@x.test", PASSWORD, generateSync({ secret }))).toMatchObject({ organizationId: "org-b", ...legacyLevelRow("COMPANY_ADMIN") });
  });

  it("a live account in an open workspace signs in where it is, and nothing is written", async () => {
    membership("org-b");
    expect(await authorize("pat@x.test", PASSWORD)).toMatchObject({ organizationId: "org-a", organizationName: "Acme" });
    expect(db.writes).toEqual([]);
  });
});

describe("a Google sign-in", () => {
  it("ended where anchored with a usable seat elsewhere: admitted, moved there, and the session starts there", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { role: "MANAGER" });
    // Before: no account (googleAccountFor refused an INACTIVE anchor), so false.
    expect(await googleSignIn("Pat@X.test")).toBe(true);
    expect(pat()).toMatchObject({ organizationId: "org-b", status: "ACTIVE" });
    const t = await googleSession("pat@x.test");
    expect(t).toMatchObject({ id: "pat", organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("MANAGER") });
    expect(t.revoked).not.toBe(true);
    expect((await sessionOf(t)).user).toMatchObject({ id: "pat", organizationId: "org-b" });
  });

  it("removed where anchored with a usable seat elsewhere: admitted and moved, as the password sign-in", async () => {
    Object.assign(pat(), { status: "INACTIVE", deletedAt: new Date("2026-10-30") });
    membership("org-c");
    expect(await googleSignIn("pat@x.test")).toBe(true);
    expect(pat()).toMatchObject({ organizationId: "org-c", deletedAt: null });
  });

  it("ended with nowhere usable: refused, and nothing is written", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { status: "INACTIVE" });
    membership("org-sus");
    expect(await googleSignIn("pat@x.test")).toBe(false);
    expect(db.writes).toEqual([]);
    const t = await googleSession("pat@x.test");
    expect((await sessionOf(t)).user).toBeUndefined();
  });

  it("out of a suspended workspace: moved to a usable seat, passing over the one an open workspace ended", async () => {
    pat().organizationId = "org-sus";
    membership("org-b", { isPrimary: true, status: "INACTIVE" });
    membership("org-c");
    // Before: refused outright (no fallback at all for Google).
    expect(await googleSignIn("pat@x.test")).toBe(true);
    expect(pat()).toMatchObject({ organizationId: "org-c" });
    expect(seat("org-b")).toMatchObject({ status: "INACTIVE" });
  });

  it("passes over an account the repair could not move (its only usable seat is where a same-address account is anchored) to the next one that it can", async () => {
    pat().status = "INACTIVE";
    membership("org-b");
    // An ended twin with Pat's address in another case is anchored in Beta.
    db.seed("user", { id: "twin", email: "PAT@x.test", firstName: "Pat", lastName: "Twin", organizationId: "org-b", status: "INACTIVE", createdAt: new Date("2025-02-01") });
    // A second account of Pat's, newer, ended at home, with a live seat in Cee.
    db.seed("user", { id: "pat2", email: "pat@X.test", firstName: "Pat", lastName: "Two", organizationId: "org-a", status: "INACTIVE", createdAt: new Date("2025-03-01") });
    db.seed("organizationMembership", { id: "m2-c", userId: "pat2", organizationId: "org-c" });
    // Before: Pat was picked, could not be moved, and Google refused.
    expect(await googleSignIn("pat@x.test")).toBe(true);
    expect(db.row("user", "pat2")).toMatchObject({ organizationId: "org-c", status: "ACTIVE" });
    expect(pat()).toMatchObject({ organizationId: "org-a", status: "INACTIVE" });
  });

  it("a live account in an open workspace is admitted where it is, and nothing is written", async () => {
    membership("org-b");
    expect(await googleSignIn("pat@x.test")).toBe(true);
    expect(db.writes).toEqual([]);
    expect(pat()).toMatchObject({ organizationId: "org-a" });
  });
});

describe("the session check", () => {
  it("a token acting in another workspace whose membership is ended goes home to the anchor, at the anchor's level", async () => {
    for (const ended of [{ status: "INACTIVE" }, { status: "INACTIVE", removedAt: new Date("2026-10-01") }]) {
      db.tables.organizationMembership = [];
      membership("org-b", { role: "COMPANY_ADMIN", ...ended });
      const out = await jwt({ token: token({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("COMPANY_ADMIN") }) });
      // Before: still acting in Beta, as its Admin.
      expect(out, JSON.stringify(ended)).toMatchObject({ organizationId: "org-a", organizationName: "Acme" });
      expect(legacyLevelOfRow(out as never)).toBe("EMPLOYEE");
      expect(out.revoked).toBe(false);
      expect((await sessionOf(out)).user).toMatchObject({ organizationId: "org-a" });
    }
    expect(db.writes).toEqual([]);
  });

  it("a token acting in another workspace where the seat is live keeps acting there at its level there", async () => {
    membership("org-b", { role: "MANAGER", status: "PROBATION" });
    const out = await jwt({ token: token({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("MANAGER") }) });
    expect(out).toMatchObject({ organizationId: "org-b", ...legacyLevelRow("MANAGER") });
  });

  it("the anchored seat ended (an old row) while a usable seat exists elsewhere: moves there rather than revoke", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { role: "MANAGER" });
    const out = await jwt({ token: token() });
    // Before: revoked, signed out of Beta too, which nobody had ended.
    expect(out.revoked).toBe(false);
    expect(out).toMatchObject({ organizationId: "org-b", organizationName: "Beta", ...legacyLevelRow("MANAGER") });
    expect(pat()).toMatchObject({ organizationId: "org-b", status: "ACTIVE" });
    expect(seat("org-a")).toMatchObject({ status: "INACTIVE" });
    expect((await sessionOf(out)).user).toMatchObject({ id: "pat", organizationId: "org-b" });
  });

  it("the anchored seat ended with nowhere usable: revoked, as before, and nothing is written", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { status: "INACTIVE" });
    const out = await jwt({ token: token() });
    expect(out).toMatchObject({ revoked: true, revokedBy: "account" });
    expect(db.writes).toEqual([]);
  });

  it("a move that cannot be made now leaves the definite answer standing: revoked, as before, never kept by a failure", async () => {
    pat().status = "INACTIVE";
    membership("org-b");
    db.failing.add("organizationMembership");
    const out = await jwt({ token: token() });
    expect(out).toMatchObject({ revoked: true, revokedBy: "account" });
    expect(pat()).toMatchObject({ organizationId: "org-a", status: "INACTIVE" });
  });

  // The step 2 review L1.
  it("an ended account with nowhere to move costs one plain read: no lock, no transaction", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { status: "INACTIVE" });
    const out = await jwt({ token: token() });
    expect(out).toMatchObject({ revoked: true, revokedBy: "account" });
    // Before: a locked transaction on every due check of every ended account.
    expect(db.raw).toEqual([]);
    expect(db.log.filter((e) => e.startsWith("tx."))).toEqual([]);
  });

  it("a blip in the repair keeps the definite answer but tries again in 30 seconds, and the next check moves them and lifts it", async () => {
    pat().status = "INACTIVE";
    membership("org-b", { role: "MANAGER" });
    db.failing.add("organizationMembership");
    const out = await jwt({ token: token() });
    expect(out).toMatchObject({ revoked: true, revokedBy: "account" });
    // Before: checked again only five minutes on.
    expect(retriedSoon(out.checkedAt)).toBe(true);
    db.failing.clear();
    const later = await jwt({ token: { ...out, checkedAt: 0 } });
    expect(later).toMatchObject({ revoked: false, organizationId: "org-b" });
    expect((await sessionOf(later)).user).toMatchObject({ id: "pat", organizationId: "org-b" });
  });

  it("acting in a suspended anchored workspace: the fallback picks a usable seat, passing over one an open workspace ended", async () => {
    pat().organizationId = "org-sus";
    membership("org-b", { isPrimary: true, status: "INACTIVE" });
    membership("org-c", { role: "MANAGER" });
    const out = await jwt({ token: token({ organizationId: "org-sus", organizationName: "Sus Co" }) });
    // Before: Beta was picked, the move refused it, and the session was revoked.
    expect(out.revoked).toBe(false);
    expect(out).toMatchObject({ organizationId: "org-c", organizationName: "Cee", ...legacyLevelRow("MANAGER") });
    expect((await sessionOf(out)).workspaceMove).toMatchObject({ message: "Sus Co is suspended, so you are now in Cee. Contact Sus Co's Owner or WorkwrK support." });
  });

  it("acting in a suspended anchored workspace while the seats cannot be read (a blip): kept as it was, tried again in 30 seconds", async () => {
    pat().organizationId = "org-sus";
    membership("org-c");
    db.failing.add("organizationMembership");
    const out = await jwt({ token: token({ organizationId: "org-sus", organizationName: "Sus Co" }) });
    expect(out.revoked).not.toBe(true);
    expect(out).toMatchObject({ organizationId: "org-sus", organizationName: "Sus Co" });
    // Due again 30 seconds on (checkedAt = now - five minutes + 30 seconds).
    const due = Date.now() - 5 * 60_000 + 30_000;
    expect(out.checkedAt as number).toBeGreaterThan(due - 1_000);
    expect(out.checkedAt as number).toBeLessThanOrEqual(due);
    expect(pat()).toMatchObject({ organizationId: "org-sus" });
  });

  // The step 2 review L2: a transaction that cannot start in time (P2028) or a
  // deadlock Postgres broke (P2034) is a blip too, never a sign out.
  it("acting in a suspended anchored workspace while the move meets P2028 or P2034: kept as it was, tried again in 30 seconds", async () => {
    pat().organizationId = "org-sus";
    membership("org-c");
    for (const code of ["P2028", "P2034"]) {
      db.failing.add("organizationMembership");
      db.failWith = { code, message: code };
      const out = await jwt({ token: token({ organizationId: "org-sus", organizationName: "Sus Co" }) });
      // Before: revoked for now, the person signed out.
      expect(out.revoked, code).not.toBe(true);
      expect(out, code).toMatchObject({ organizationId: "org-sus" });
      expect(retriedSoon(out.checkedAt), code).toBe(true);
    }
  });

  it("acting in a suspended anchored workspace with no usable seat: revoked for now, nothing written", async () => {
    pat().organizationId = "org-sus";
    membership("org-b", { status: "INACTIVE" });
    const out = await jwt({ token: token({ organizationId: "org-sus", organizationName: "Sus Co" }) });
    expect(out).toMatchObject({ revoked: true, revokedBy: "workspace" });
    expect(db.writes).toEqual([]);
  });
});
