// /api/auth/accept-invite and a seat this workspace ended (docs/plans/
// workspace-status.md step 2, D13 and D7). Someone deactivated or removed
// here through their membership is not "already in": /join shows the join
// card, the seat check runs, and accepting brings that membership back (live,
// removedAt cleared, at the invitation's level, its copied mark cleared)
// under the person's row lock before it is written. A signed-in person whose
// own seat is ended where they are anchored (an old row) is moved to their
// usable seat first, as their session check would. Signed out, someone whose
// account can still sign in is sent to log in, and someone whose account can
// work nowhere joins as a new person, the old seat's copied mark cleared.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  fits: true,
  skillsBack: [] as string[][],
  /** The invitation's manager as the real reads answer it (workspace-status-2 E10), else none. */
  realManager: false,
  /** The workspaces whose role lock was taken. */
  roleLocks: [] as string[],
  /** The audit rows the join wrote after it (logAuditEvent). */
  audits: [] as Array<Record<string, unknown>>,
  /** followReportingLine's calls (review-cycle.server.ts). */
  followed: [] as Array<{ ids: string[]; actor: string }>,
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "hash" } }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/email-templates", () => ({ welcomeTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/auth/send-verification", () => ({ appBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/rate-limit-memory", () => ({ ipFromRequest: () => "ip", rateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async (row: Record<string, unknown>) => { st.audits.push(row); } }));
// Open reviews following a cleared line is review-cycle's own (tested there).
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async (_org: string, ids: string[], actor: string) => { st.followed.push({ ids, actor }); return 0; } }));
vi.mock("@/lib/access/grants", () => ({ recordSpaceInviteAccepted: async () => null }));
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async (_tx: unknown, org: string) => { st.roleLocks.push(org); },
  liveOwnerIds: async () => ["olive"],
}));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async (_org: string, ids: string[]) => void st.skillsBack.push(ids) }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async () => undefined,
  personFitsOnAccept: async () => (st.fits ? { ok: true } : { ok: false, message: "Every seat in Here Co is taken." }),
}));
vi.mock("@/lib/auth/invite-facts.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/invite-facts.server")>();
  return {
    ...real,
    inviteSender: async () => ({ inviterId: null, inviterName: "Ida", message: null }),
    // The real ones when a test says so (workspace-status-2 E10, step 4).
    invitePlacement: async (inv: Parameters<typeof real.invitePlacement>[0]) => (st.realManager ? real.invitePlacement(inv) : { departmentName: null, managerName: null, space: null }),
    managerOnAccept: async (inv: Parameters<typeof real.managerOnAccept>[0], db?: Parameters<typeof real.managerOnAccept>[1]) => (st.realManager ? real.managerOnAccept(inv, db) : null),
    // placementOnAccept is the real one (D18): this workspace's own rows only.
  };
});

import { GET, POST } from "./route";
import { seatDb as db } from "@/lib/access/seat-test-db";
import { endSeat } from "@/lib/access/workspace-status";

const TOKEN = "tok-123";
const pat = () => db.row("user", "pat");
const seatIn = (organizationId: string, userId = "pat") => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId);
const preview = async () => {
  const res = await GET(new NextRequest(`https://app.test/api/auth/accept-invite?token=${TOKEN}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const accept = async (body: Record<string, unknown> = {}) => {
  const res = await POST(new NextRequest("https://app.test/api/auth/accept-invite", { method: "POST", body: JSON.stringify({ token: TOKEN, ...body }), headers: { "content-type": "application/json" } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const signedIn = () => {
  st.session = { user: { id: "pat", email: "pat@x.test" } };
};

beforeEach(() => {
  db.reset();
  st.session = null;
  st.fits = true;
  st.skillsBack = [];
  st.realManager = false;
  st.roleLocks = [];
  st.audits = [];
  st.followed = [];
  db.seed("organization", { id: "here", name: "Here Co", status: "ACTIVE", settings: {} });
  db.seed("organization", { id: "home", name: "Home Co", status: "ACTIVE", settings: {} });
  db.seed("organization", { id: "other", name: "Other Co", status: "TRIAL", settings: {} });
  // Pat works at Home Co; Here Co invites him as a Manager.
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "P", organizationId: "home", ...legacyLevelRow("EMPLOYEE"), createdAt: new Date("2025-01-01") });
  db.seed("invitation", {
    id: "inv",
    token: TOKEN,
    email: "pat@x.test",
    ...legacyLevelRow("MANAGER"),
    accepted: false,
    expiresAt: new Date(Date.now() + 86_400_000),
    organizationId: "here",
    departmentId: null,
    roleId: null,
    managerId: null,
    officeId: null,
    firstName: null,
    lastName: null,
    phone: null,
    kraIds: [],
    sopIds: [],
    spaceId: null,
    spaceRole: null,
  });
});

describe("GET: what /join shows", () => {
  it("someone whose membership here was ended sees the join card, not 'already in'", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE", removedAt: new Date("2026-10-01") });
    const { status, body } = await preview();
    expect(status).toBe(200);
    // Before: alreadyInThisOrg true, the "You are already in Here Co" screen.
    expect(body).toMatchObject({ alreadyInThisOrg: false, alreadyInThisOrgInactive: false, accountExists: true, organizationName: "Here Co" });
  });

  it("and the seat check runs for them, as for anyone joining", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE" });
    st.fits = false;
    const { status, body } = await preview();
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "full" });
  });

  it("a live membership here is still already in", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "ON_LEAVE" });
    expect((await preview()).body).toMatchObject({ alreadyInThisOrg: true, alreadyInThisOrgInactive: false });
  });
});

describe("POST signed in: the seat comes back", () => {
  it("revives the ended membership (live, removal cleared, the invitation's level, the copied mark cleared, no Admin scopes), under the person's lock, then moves them here", async () => {
    db.seed("organizationMembership", {
      id: "m-here",
      userId: "pat",
      organizationId: "here",
      role: "COMPANY_ADMIN",
      adminScopes: ["billing"],
      status: "INACTIVE",
      removedAt: new Date("2026-10-01"),
      endedWithAccount: true,
    });
    signedIn();
    const { status, body } = await accept();
    // Before: 409 "You are already in Here Co."
    expect(status).toBe(201);
    expect(body).toMatchObject({ ok: true, refreshSession: true });
    expect(seatIn("here")).toMatchObject({ status: "ACTIVE", removedAt: null, endedWithAccount: false, role: "MANAGER", adminScopes: [] });
    // Anchored here now, live, at the invitation's level; Home Co keeps a live seat.
    expect(pat()).toMatchObject({ organizationId: "here", ...legacyLevelRow("MANAGER"), status: "ACTIVE", deletedAt: null });
    expect(seatIn("home")).toMatchObject({ status: "ACTIVE", removedAt: null, role: "EMPLOYEE" });
    // The person's row lock comes before the seat is written, in the join's own transaction.
    const lock = db.log.indexOf("tx.lock:pat");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(db.log.indexOf("tx.organizationMembership.upsert"));
    expect(db.row("invitation", "inv").accepted).toBe(true);
    expect(st.skillsBack).toEqual([["pat"]]);
  });

  it("a deactivated (not removed) membership comes back the same way", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE" });
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(seatIn("here")).toMatchObject({ status: "ACTIVE", removedAt: null, role: "MANAGER" });
    expect(pat()).toMatchObject({ organizationId: "here", status: "ACTIVE" });
  });

  it("a live membership here is still already in, and nothing is written", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here" });
    signedIn();
    expect(await accept()).toMatchObject({ status: 409, body: { code: "member" } });
    expect(db.writes).toEqual([]);
  });

  it("ended where they are anchored (an old row) with a usable seat elsewhere: moved there first, as the session check would, then joined", async () => {
    pat().status = "INACTIVE";
    db.seed("organizationMembership", { id: "m-other", userId: "pat", organizationId: "other" });
    signedIn();
    const { status } = await accept();
    // Before: 404, "This invitation link is not valid."
    expect(status).toBe(201);
    expect(pat()).toMatchObject({ organizationId: "here", status: "ACTIVE", ...legacyLevelRow("MANAGER") });
    // Home Co keeps the seat it ended; Other Co keeps its live one.
    expect(seatIn("home")).toMatchObject({ status: "INACTIVE" });
    expect(seatIn("other")).toMatchObject({ status: "ACTIVE" });
  });

  it("ended with nowhere usable: refused as before, and nothing is written", async () => {
    pat().status = "INACTIVE";
    db.seed("organizationMembership", { id: "m-other", userId: "pat", organizationId: "other", status: "INACTIVE" });
    signedIn();
    expect(await accept()).toMatchObject({ status: 404, body: { code: "invalid" } });
    expect(db.writes).toEqual([]);
  });
});

// The step 2 review H1: an invitation that was open when the seat ended.
describe("an invitation sent before the seat ended", () => {
  it("cannot bring it back: the end expired it, so accepting answers expired and nothing is written", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here" });
    // Here Co removed Pat a moment ago (step 3's route calls endSeat); his invitation here was still open.
    const aMomentAgo = new Date(Date.now() - 1_000);
    await (db.prisma as unknown as { $transaction: (fn: (tx: never) => Promise<unknown>) => Promise<unknown> }).$transaction((tx) =>
      endSeat(tx, { userId: "pat", organizationId: "here", kind: "removed", now: aMomentAgo }),
    );
    expect(db.row("invitation", "inv").expiresAt).toEqual(aMomentAgo);
    db.writes.length = 0;
    signedIn();
    const { status, body } = await accept();
    // Before: 201, the removal undone by the person it was about.
    expect(status).toBe(410);
    expect(body).toMatchObject({ code: "expired" });
    expect(seatIn("here")).toMatchObject({ status: "INACTIVE" });
    expect(db.writes).toEqual([]);
  });
});

describe("POST signed in: other accounts with the address", () => {
  it("clears the copied mark on another same-address account's seat here, so restoring it at home never brings a second Pat here", async () => {
    // Pat's old account, ended with its account by the one-time step, its seat here marked.
    db.seed("user", { id: "old-pat", email: "PAT@x.test", firstName: "Pat", lastName: "Old", organizationId: "other", status: "INACTIVE", createdAt: new Date("2024-01-01") });
    db.seed("organizationMembership", { id: "m-old", userId: "old-pat", organizationId: "here", status: "INACTIVE", endedWithAccount: true });
    signedIn();
    expect((await accept()).status).toBe(201);
    // Before: still marked, so restoring old-pat at Other Co brought it back here beside Pat.
    expect(db.row("organizationMembership", "m-old")).toMatchObject({ status: "INACTIVE", endedWithAccount: false });
  });
});

describe("POST signed out", () => {
  it("an ended seat here, with an account that can still sign in: log in first (account_exists), and nothing is written", async () => {
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE" });
    const { status, body } = await accept({ firstName: "Pat", lastName: "P", password: "Long-enough-1!" });
    // Before: 409 member, "You are already in Here Co."
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "account_exists" });
    expect(db.writes).toEqual([]);
  });

  it("an account that can work nowhere, whose seat here the one-time step ended: joins as a new person, and that old seat's mark is cleared", async () => {
    pat().status = "INACTIVE";
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE", endedWithAccount: true });
    const { status } = await accept({ firstName: "Pat", lastName: "P", password: "Long-enough-1!" });
    // Before: 409 member, so nobody could ever invite this address back.
    expect(status).toBe(201);
    const fresh = db.tables.user.find((u) => u.id !== "pat" && u.organizationId === "here");
    expect(fresh).toMatchObject({ email: "pat@x.test", ...legacyLevelRow("MANAGER") });
    // Restoring the old account at Home Co never brings a second Pat back here.
    expect(seatIn("here")).toMatchObject({ status: "INACTIVE", endedWithAccount: false });
  });
});

// docs/plans/workspace-status.md D18 (the step 3 review H2): the department,
// job role and office an invitation names are the person's profile in the
// workspace that sent it. A signed-in join writes them onto the membership
// (this workspace's own only), and the move hands them to the account; the
// workspace they came from keeps its own on the membership it leaves.
describe("POST signed in: the invitation's placement is their profile here (D18)", () => {
  beforeEach(() => {
    db.seed("department", { id: "dep-here", name: "Design", organizationId: "here" });
    db.seed("role", { id: "role-here", title: "Designer", organizationId: "here" });
    db.seed("department", { id: "dep-home", name: "Finance", organizationId: "home" });
    pat().departmentId = "dep-home";
    pat().roleId = null;
    pat().officeId = null;
  });

  it("writes it onto the membership, which the move hands to the account; Home Co keeps its own", async () => {
    const inv = db.row("invitation", "inv");
    inv.departmentId = "dep-here";
    inv.roleId = "role-here";
    signedIn();
    expect((await accept()).status).toBe(201);
    // Before: the account kept Home Co's Finance here, and the invitation's placement was dropped.
    expect(seatIn("here")).toMatchObject({ departmentId: "dep-here", roleId: "role-here" });
    expect(pat()).toMatchObject({ organizationId: "here", departmentId: "dep-here", roleId: "role-here" });
    expect(seatIn("home")).toMatchObject({ departmentId: "dep-home" });
  });

  it("never writes another workspace's department named on an old invitation", async () => {
    db.row("invitation", "inv").departmentId = "dep-home";
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(seatIn("here")?.departmentId ?? null).toBeNull();
    expect(pat().departmentId ?? null).toBeNull();
  });
});

// docs/plans/workspace-status-2.md E10 (step 4): the invitation's Reports to is
// their line here on a signed-in join too, read under the role lock
// (managerOnAccept) and written onto the membership with the placement,
// before the move, so the swap (E3) hands it to the account and the
// workspace they came from keeps its own line on the membership it leaves.
// Before, this path wrote no manager: Pat, imported into Here Co under Dana,
// joined with her existing account and had no manager here.
describe("POST signed in: the invitation's Reports to is their line here (E10)", () => {
  beforeEach(() => {
    st.realManager = true;
    db.seed("user", { id: "dana", email: "dana@x.test", firstName: "Dana", lastName: "Lee", organizationId: "here", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.seed("user", { id: "max", email: "max@x.test", firstName: "Max", lastName: "Ray", organizationId: "home", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    // Pat reports to Max at Home Co.
    pat().managerId = "max";
    db.row("invitation", "inv").managerId = "dana";
  });

  it("writes Dana onto the membership under the role lock, the move hands it to the account, and Home Co keeps Max", async () => {
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(st.roleLocks).toEqual(["here"]);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: "dana" });
    // The membership Pat left is Home Co's, with Home Co's line.
    expect(seatIn("home")).toMatchObject({ managerId: "max" });
  });

  it("names Dana on /join to someone who already has an account", async () => {
    // Before: null, since that path wrote no manager.
    expect((await preview()).body).toMatchObject({ accountExists: true, managerName: "Dana Lee" });
  });

  for (const [why, make] of [
    ["an Agent here", () => { Object.assign(db.row("user", "dana"), legacyLevelRow("AGENT")); }],
    ["someone deactivated here", () => { db.row("user", "dana").status = "INACTIVE"; }],
  ] as const) {
    it(`writes no line under a manager who can't manage here: ${why}`, async () => {
      make();
      signedIn();
      expect((await accept()).status).toBe(201);
      // Read under the role lock, so a role change waits for it or is seen by it.
      expect(st.roleLocks).toEqual(["here"]);
      expect(pat()).toMatchObject({ organizationId: "here", managerId: null });
      expect(seatIn("home")).toMatchObject({ managerId: "max" });
    });
  }

  it("writes no line that would close a loop here, for someone coming back to a seat here", async () => {
    // Pat once worked here, and Dana's line here still names her.
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", role: "EMPLOYEE", status: "INACTIVE", managerId: null });
    db.row("user", "dana").managerId = "pat";
    signedIn();
    expect((await accept()).status).toBe(201);
    // The loop is checked under the role lock (E5), and no line is written.
    expect(st.roleLocks).toEqual(["here"]);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: null });
  });

  it("a seat here that comes back takes the invitation's manager, and keeps its own line when the invitation names none", async () => {
    db.seed("user", { id: "bo", email: "bo@x.test", firstName: "Bo", lastName: "Bo", organizationId: "here", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", role: "EMPLOYEE", status: "INACTIVE", managerId: "bo" });
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: "dana" });
  });

  // The step 4 review L2: the second half of the title above, which it never checked.
  it("a seat here that comes back keeps its own line when the invitation names none, and it still holds", async () => {
    db.seed("user", { id: "bo", email: "bo@x.test", firstName: "Bo", lastName: "Bo", organizationId: "here", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", role: "EMPLOYEE", status: "INACTIVE", managerId: "bo" });
    db.row("invitation", "inv").managerId = null;
    signedIn();
    const { status, body } = await accept();
    expect(status).toBe(201);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: "bo" });
    expect(seatIn("home")).toMatchObject({ managerId: "max" });
    // Checked under the role lock, and nothing cleared or dropped.
    expect(st.roleLocks).toEqual(["here"]);
    expect(db.tables.activityLog ?? []).toEqual([]);
    expect(body).not.toHaveProperty("managerDropped");
  });

  // The step 4 review L3: a manager the join drops is never dropped in silence.
  it("says in the answer and the Audit log when the invitation's manager can't be written", async () => {
    Object.assign(db.row("user", "dana"), legacyLevelRow("AGENT"));
    signedIn();
    const { status, body } = await accept();
    expect(status).toBe(201);
    expect(body).toMatchObject({ ok: true, managerDropped: true });
    expect(st.audits[0]).toMatchObject({
      type: "user.joined",
      description: "Joined from an invitation with an existing WorkwrK account, with no manager here: the manager the invitation named can't manage them here",
      metadata: { managerDropped: "dana" },
    });
  });

  it("/join never names a manager the join would drop: the person themselves, or one who would close a loop here", async () => {
    // Dana's line here names Pat (Pat once worked here): Pat under Dana is a loop.
    db.row("user", "dana").managerId = "pat";
    expect((await preview()).body).toMatchObject({ accountExists: true, managerName: null });
    db.row("user", "dana").managerId = null;
    expect((await preview()).body).toMatchObject({ managerName: "Dana Lee" });
    // An invitation naming the person themselves (Pat holds no seat here, so
    // managerOnAccept already refuses her; the self check stands on its own).
    db.row("invitation", "inv").managerId = "pat";
    expect((await preview()).body).toMatchObject({ managerName: null });
  });
});

// The step 4 review M1: a seat that comes back by invitation (D13) keeps only
// the lines here that still hold, as a restore or a reactivation keeps them
// (manager-candidate.ts staleLinesOf). Before, its old line came back
// unchecked when the invitation named no manager that passed, and the swap
// handed it to the account.
describe("POST signed in: a seat that comes back keeps only the lines that still hold (M1)", () => {
  beforeEach(() => {
    st.realManager = true;
    db.seed("user", { id: "dana", email: "dana@x.test", firstName: "Dana", lastName: "Lee", organizationId: "here", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.seed("user", { id: "max", email: "max@x.test", firstName: "Max", lastName: "Ray", organizationId: "home", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.seed("user", { id: "ada", email: "ada@x.test", firstName: "Ada", lastName: "Bot", organizationId: "here", ...legacyLevelRow("AGENT"), createdAt: new Date("2025-02-01") });
    pat().managerId = "max";
    // B (Here Co) removed Pat in March while she reported to Dana here, with
    // a dotted line here to Ada (an Agent since) and one at home to Max.
    db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", role: "EMPLOYEE", status: "INACTIVE", removedAt: new Date("2026-03-01"), managerId: "dana" });
    db.seed("userDottedLine", { id: "d-here", userId: "pat", managerId: "ada", organizationId: "here" });
    db.seed("userDottedLine", { id: "d-home", userId: "pat", managerId: "max", organizationId: "home" });
    // B's HR re-invites her with no Reports to.
    db.row("invitation", "inv").managerId = null;
  });
  const lineRows = () => (db.tables.activityLog ?? []).filter((r) => r.type === "reporting_line_changed");

  it("B removed Dana since: Pat comes back with no line to her, each clear logged, under the role lock", async () => {
    Object.assign(db.row("user", "dana"), { status: "INACTIVE", deletedAt: new Date("2026-06-01") });
    signedIn();
    const { status } = await accept();
    expect(status).toBe(201);
    // Before: Pat came back under Dana (the swap handed her old B line to the account).
    expect(pat()).toMatchObject({ organizationId: "here", managerId: null });
    expect(st.roleLocks).toEqual(["here"]);
    // B's stale dotted row goes; her home row and her home line stay.
    expect(db.tables.userDottedLine.map((d) => d.id)).toEqual(["d-home"]);
    expect(seatIn("home")).toMatchObject({ managerId: "max" });
    expect(lineRows().map((r) => [r.organizationId, r.description, r.oldValue, r.metadata])).toEqual([
      ["here", "Restored Pat P with no manager: Dana Lee is no longer in the workspace", { managerId: "dana" }, { onJoin: true, reason: "removed" }],
      ["here", "Restored Pat P without their dotted line to Ada Bot: Ada Bot is on the Agent tier, and an Agent can't be anyone's manager", { dottedManagerId: "ada" }, { onJoin: true, reason: "agent" }],
    ]);
    // Her open reviews here follow the cleared line, to the first Owner.
    expect(st.followed).toEqual([{ ids: ["pat"], actor: "olive" }]);
  });

  it("B deactivated Dana since: the same, and Pat never comes back reporting to a deactivated person", async () => {
    db.row("user", "dana").status = "INACTIVE";
    // Pat's own seat here was deactivated, not removed.
    Object.assign(db.row("organizationMembership", "m-here"), { removedAt: null });
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: null });
    expect(lineRows()[0]).toMatchObject({ description: "Reactivated Pat P with no manager: Dana Lee is deactivated", metadata: { onJoin: true, reason: "inactive" } });
    expect(db.tables.userDottedLine.map((d) => d.id)).toEqual(["d-home"]);
  });

  it("a manager the invitation names that passes replaces the old line, and the stale dotted row still goes", async () => {
    Object.assign(db.row("user", "dana"), { status: "INACTIVE", deletedAt: new Date("2026-06-01") });
    db.seed("user", { id: "bo", email: "bo@x.test", firstName: "Bo", lastName: "Bo", organizationId: "here", ...legacyLevelRow("MANAGER"), createdAt: new Date("2025-02-01") });
    db.row("invitation", "inv").managerId = "bo";
    signedIn();
    expect((await accept()).status).toBe(201);
    expect(pat()).toMatchObject({ organizationId: "here", managerId: "bo" });
    expect(lineRows().map((r) => r.metadata)).toEqual([{ onJoin: true, reason: "agent" }]);
    expect(st.followed).toEqual([]);
  });
});
