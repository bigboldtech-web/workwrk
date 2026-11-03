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
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => st.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "hash" } }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/email-templates", () => ({ welcomeTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/auth/send-verification", () => ({ appBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/rate-limit-memory", () => ({ ipFromRequest: () => "ip", rateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined }));
vi.mock("@/lib/access/grants", () => ({ recordSpaceInviteAccepted: async () => null }));
vi.mock("@/lib/access/membership", () => ({ lockOrgRoles: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async (_org: string, ids: string[]) => void st.skillsBack.push(ids) }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async () => undefined,
  personFitsOnAccept: async () => (st.fits ? { ok: true } : { ok: false, message: "Every seat in Here Co is taken." }),
}));
vi.mock("@/lib/auth/invite-facts.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/invite-facts.server")>()),
  inviteSender: async () => ({ inviterId: null, inviterName: "Ida", message: null }),
  invitePlacement: async () => ({ departmentName: null, managerName: null, space: null }),
  managerOnAccept: async () => null,
  // placementOnAccept is the real one (D18): this workspace's own rows only.
}));

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
