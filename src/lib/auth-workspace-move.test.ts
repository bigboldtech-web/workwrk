import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import bcrypt from "bcryptjs";
import { legacyLevelOfRow, legacyLevelRow } from "./access/test-fixtures";

// The workspace-move notice (Phase 9 walk, group 3 finding 1). When a person
// is moved out of a suspended or closed company into another workspace they
// belong to, the token carries a one-shot marker that reaches the session as
// a sentence, and only an ack for THAT marker clears it. The ack must never
// touch revocation: session.update() cannot revive anything through it.
//
// Since the final review of docs/plans/workspace-status.md (product M1) a
// token sent home because the workspace it acted in ended the person's seat
// gets the same notice: "You no longer have access to B, so you are now in A."
//
// Run on the in-memory database (access/seat-test-db.ts), whose reads honour
// every condition they are given and throw on one they do not know (the
// final review, integrity T1: the old fake answered the same rows whatever
// it was asked, so a wrong seat pick could never fail here).

vi.mock("./prisma", async () => ({ prisma: (await import("./access/seat-test-db")).seatDb.prisma }));
vi.mock("./activity", () => ({ logActivity: vi.fn() }));

import { authOptions, resetSessionChecks } from "./auth";
import { seatDb as db } from "./access/seat-test-db";

type Tok = Record<string, unknown>;
const jwt = (args: Record<string, unknown>) =>
  (authOptions.callbacks!.jwt as unknown as (a: Record<string, unknown>) => Promise<Tok>)(args);
const sessionOf = (token: Tok) =>
  (authOptions.callbacks!.session as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
    session: { user: { name: "x" }, expires: "2099-01-01" },
    token,
  });
const authorize = (email: string, password: string) =>
  (authOptions.providers[0] as unknown as { options: { authorize: (c: Record<string, string>, r: unknown) => Promise<Record<string, unknown>> } }).options.authorize(
    { email, password },
    { headers: {} },
  );

const SUS = { id: "org-sus", name: "Sus Co", status: "SUSPENDED" };
const HOME = { id: "org-home", name: "Home Co", status: "TRIAL" };
const CLOSED = { id: "org-closed", name: "Closed Co", status: "CANCELLED" };
const ACME = { id: "org-acme", name: "Acme", status: "ACTIVE" };
const EVIL = { id: "org-evil", name: "Evil Side", status: "ACTIVE" };
const PASSWORD = "pw-for-test";
const HASH = bcrypt.hashSync(PASSWORD, 4);

const me = () => db.row("user", "u1");
const seatIn = (organizationId: string) => db.tables.organizationMembership?.find((m) => m.userId === "u1" && m.organizationId === organizationId);
let made = 0;
/** u1's membership in that workspace, made in order (the oldest first). */
function membership(organizationId: string, role = "COMPANY_ADMIN", extra: Record<string, unknown> = {}) {
  made += 1;
  return db.seed("organizationMembership", { id: `m-${organizationId}`, userId: "u1", organizationId, role, createdAt: new Date(Date.UTC(2026, 0, made)), ...extra });
}
/** u1 anchored in `org` at `level`. */
function anchoredIn(org: { id: string }, level = "COMPANY_ADMIN", extra: Record<string, unknown> = {}) {
  db.seed("user", { id: "u1", email: "a@b.c", firstName: "A", lastName: "B", organizationId: org.id, ...legacyLevelRow(level as never), passwordHash: HASH, createdAt: new Date("2025-01-01"), ...extra });
}
/** A token due its check, acting in `org`. */
const tokenIn = (org: { id: string; name: string }, o: Tok = {}): Tok => ({ id: "u1", organizationId: org.id, organizationName: org.name, tokenVersion: 0, ...o });
let errors: MockInstance;

beforeEach(() => {
  db.reset();
  resetSessionChecks();
  made = 0;
  delete process.env.ENFORCE_MFA_AT_LOGIN;
  for (const o of [SUS, HOME, CLOSED, ACME, EVIL]) db.seed("organization", { ...o, settings: {} });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("workspace move notice", () => {
  it("stamps the move out of a suspended anchored company and says it in the session", async () => {
    anchoredIn(SUS);
    membership(HOME.id);
    const token = await jwt({ token: tokenIn(SUS) });
    expect(token.organizationId).toBe(HOME.id);
    expect(token.revoked).toBe(false);
    expect(me().organizationId).toBe(HOME.id);
    const s = await sessionOf(token);
    const move = s.workspaceMove as { at: number; message: string } | undefined;
    expect(move?.message).toBe(
      "Sus Co is suspended, so you are now in Home Co. Contact Sus Co's Owner or WorkwrK support.",
    );
    expect(typeof move?.at).toBe("number");
  });

  it("stamps the return from a stale closed workspace to the healthy anchored one", async () => {
    anchoredIn(HOME);
    membership(CLOSED.id);
    const token = await jwt({ token: tokenIn(CLOSED) });
    expect(token.organizationId).toBe(HOME.id);
    const s = await sessionOf(token);
    expect((s.workspaceMove as { message: string }).message).toBe(
      "Closed Co is closed, so you are now in Home Co. Contact Closed Co's Owner or WorkwrK support.",
    );
  });

  it("says nothing when the workspace is healthy", async () => {
    anchoredIn(HOME);
    const token = await jwt({ token: tokenIn(HOME) });
    expect((await sessionOf(token)).workspaceMove).toBeUndefined();
  });

  it("clears only on an ack for the same move, and the ack never revives a revoked token", async () => {
    anchoredIn(HOME);
    const marker = { from: "Sus Co", status: "SUSPENDED", to: "Home Co", at: 1234 };
    const base = { ...tokenIn(HOME), checkedAt: Date.now() };

    const wrong = await jwt({ token: { ...base, workspaceMove: marker }, trigger: "update", session: { workspaceMoveAck: 999 } });
    expect(wrong.workspaceMove).toEqual(marker);

    const right = await jwt({ token: { ...base, workspaceMove: marker }, trigger: "update", session: { workspaceMoveAck: 1234 } });
    expect(right.workspaceMove).toBeUndefined();
    expect((await sessionOf(right)).workspaceMove).toBeUndefined();

    const revoked = await jwt({
      token: { ...base, revoked: true, workspaceMove: marker },
      trigger: "update",
      session: { workspaceMoveAck: 1234 },
    });
    expect(revoked.revoked).toBe(true);
    expect((await sessionOf(revoked)).user).toBeUndefined();
  });

  it("stamps the move at sign-in when the anchored company is suspended", async () => {
    anchoredIn(SUS);
    membership(HOME.id);
    const user = await authorize("a@b.c", PASSWORD);
    expect(user.organizationId).toBe(HOME.id);
    const token = await jwt({ token: {}, user });
    expect((await sessionOf(token)).workspaceMove).toMatchObject({
      message: "Sus Co is suspended, so you are now in Home Co. Contact Sus Co's Owner or WorkwrK support.",
    });
  });

  // The final review, integrity T1: the fallback picks a USABLE seat, primary
  // first, then oldest, never the first row it happens to read.
  it("moves to the primary usable seat, passing over an older one the workspace ended and one in a closed workspace", async () => {
    anchoredIn(SUS);
    membership(ACME.id, "EMPLOYEE", { status: "INACTIVE" });
    membership(CLOSED.id);
    membership(EVIL.id, "MANAGER");
    membership(HOME.id, "TEAM_LEAD", { isPrimary: true });
    const token = await jwt({ token: tokenIn(SUS) });
    expect(token.organizationId).toBe(HOME.id);
    expect(legacyLevelOfRow(me())).toBe("TEAM_LEAD");
    expect(seatIn(ACME.id)).toMatchObject({ status: "INACTIVE" });
  });

  // Step 1 review H1 (docs/plans/workspace-status.md): the fallbacks picked a
  // membership by its workspace's status only, so they could move someone
  // into a seat that workspace had ended, and the swap then ended the account
  // in every workspace. Since step 2 they pick usable seats only, so an ended
  // seat is never a home to fall back to, and nothing is written.
  it("never lands a live account in a seat its workspace ended: the session is revoked for now, and nothing is written", async () => {
    anchoredIn(SUS);
    membership(HOME.id, "COMPANY_ADMIN", { status: "INACTIVE" });
    const token = await jwt({ token: tokenIn(SUS) });
    expect(token.revoked).toBe(true);
    expect(token.organizationId).toBe(SUS.id);
    expect(db.writes).toEqual([]);
  });

  it("never signs in a live account into a seat its workspace removed, and writes nothing", async () => {
    anchoredIn(SUS);
    membership(HOME.id, "COMPANY_ADMIN", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
    await expect(authorize("a@b.c", PASSWORD)).rejects.toThrow("This workspace is suspended. Please contact WorkwrK support.");
    expect(db.writes.filter((w) => w.startsWith("user.") || w.startsWith("organizationMembership."))).toEqual([]);
    expect(me().organizationId).toBe(SUS.id);
  });

  // The final review, product M1: B ended the seat of a token acting there
  // (D3 moved the account home, or D5 ended the membership). Before, the
  // token went home silently: the next page was simply another company's.
  it("a token sent home because the workspace it acted in ended the seat says so", async () => {
    anchoredIn(ACME, "EMPLOYEE");
    membership(EVIL.id, "MANAGER", { status: "INACTIVE" });
    const token = await jwt({ token: tokenIn(EVIL) });
    expect(token).toMatchObject({ organizationId: ACME.id, revoked: false });
    expect((await sessionOf(token)).workspaceMove).toMatchObject({ message: "You no longer have access to Evil Side, so you are now in Acme." });
    // A removal, and a membership row gone, say the same.
    db.row("organizationMembership", `m-${EVIL.id}`).removedAt = new Date("2026-10-01");
    expect((await sessionOf(await jwt({ token: tokenIn(EVIL) }))).workspaceMove).toMatchObject({ message: "You no longer have access to Evil Side, so you are now in Acme." });
    db.tables.organizationMembership.length = 0;
    expect((await sessionOf(await jwt({ token: tokenIn(EVIL) }))).workspaceMove).toMatchObject({ message: "You no longer have access to Evil Side, so you are now in Acme." });
  });

  // The level a token acts with is the level held in the workspace it acts
  // in (Stage B review, the HIGH finding): after a join, switch or create on
  // another device the anchored workspace differs from this token's, and
  // the anchored level must never be copied in.
  describe("the level follows the workspace the token acts in", () => {
    it("an Employee of Acme invited to Evil as Admin stays an Employee in Acme on another device", async () => {
      anchoredIn(EVIL, "COMPANY_ADMIN");
      membership(ACME.id, "EMPLOYEE");
      const token = await jwt({ token: tokenIn(ACME, { ...legacyLevelRow("EMPLOYEE") }) });
      expect(token.organizationId).toBe(ACME.id);
      expect(legacyLevelOfRow(token)).toBe("EMPLOYEE");
      expect(token.revoked).toBe(false);
    });

    it("an Owner who joined elsewhere as a Member keeps their level at home on another device", async () => {
      anchoredIn(EVIL, "EMPLOYEE");
      membership(ACME.id, "COMPANY_ADMIN");
      const token = await jwt({ token: tokenIn(ACME, { ...legacyLevelRow("COMPANY_ADMIN") }) });
      expect(token.organizationId).toBe(ACME.id);
      expect(legacyLevelOfRow(token)).toBe("COMPANY_ADMIN");
    });

    it("a token acting in a healthy workspace with no membership left comes home at the home level", async () => {
      anchoredIn(EVIL, "EMPLOYEE");
      const token = await jwt({ token: tokenIn(ACME, { ...legacyLevelRow("COMPANY_ADMIN") }) });
      expect(token.organizationId).toBe(EVIL.id);
      expect(legacyLevelOfRow(token)).toBe("EMPLOYEE");
    });

    it("the anchored workspace still reads the anchored level, so promotions land, and never reads its own stale row", async () => {
      anchoredIn(ACME, "COMPANY_ADMIN");
      // A stale row of the anchored workspace, at an older level: never the level.
      membership(ACME.id, "EMPLOYEE");
      const token = await jwt({ token: tokenIn(ACME, { ...legacyLevelRow("EMPLOYEE") }) });
      expect(legacyLevelOfRow(token)).toBe("COMPANY_ADMIN");
      expect(db.log.filter((e) => e.startsWith("organizationMembership.findUnique"))).toEqual([]);
    });
  });
});
