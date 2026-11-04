// A person's status in each workspace, the step 3 review T2: the reporting
// lines and the handover gate, through PATCH and DELETE /api/users/[id] with
// the REAL line check (manager-candidate.ts staleLinesOf, lineStandingsElsewhere)
// and the REAL handover gate (handover.server.ts pendingHandover), on an
// in-memory database. seat.test.ts mocks both; this proves that bringing back
// someone who works here through a membership keeps the line their own
// company holds, and that the handover comes first for them as for anyone.
// Before step 3 every one of these was a 404.
//
// docs/plans/workspace-status-2.md step 4 (E1, E4): the lines a restore and a
// reactivation check, and clear, are THIS workspace's: the line the seat
// here holds (Pat's B membership's) and B's dotted rows. Pat's A line, on
// her account, is A's: B never reads or clears it.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/access/role-change-after", () => ({ afterRoleChanges: async () => undefined }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/access/workspace-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/workspace-admin")>()),
  freshWorkspaceActor: async () => ({ ok: true, admin: true, owner: true }),
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ getLatestScore: async () => null, getScoreHistory: async () => [] }));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/directory-list.server", () => ({ presenceFor: async () => new Map() }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { DELETE, PATCH } from "./route";

const req = (id: string, init: { method: string; body?: unknown; query?: string }) =>
  new NextRequest(`https://app.test/api/users/${id}${init.query ?? ""}`, { method: init.method, ...(init.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) });
const patch = (id: string, body: unknown) => PATCH(req(id, { method: "PATCH", body }), { params: Promise.resolve({ id }) });
const remove = (id: string) => DELETE(req(id, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const restore = (id: string) => DELETE(req(id, { method: "DELETE", query: "?restore=true" }), { params: Promise.resolve({ id }) });
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
let made = 0;
const person = (id: string, organizationId: string, level = "EMPLOYEE", extra: Record<string, unknown> = {}) => {
  made += 1;
  return db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId, ...legacyLevelRow(level), managerId: null, createdAt: new Date(Date.UTC(2026, 0, made)), ...extra });
};

beforeEach(() => {
  db.reset();
  made = 0;
  st.ctx = { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set(), writeChain: new Set(), viewer: {} };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  person("olga", "b", "SUPER_ADMIN");
  person("u-admin", "b", "COMPANY_ADMIN");
  // Pat is anchored in A, where she reports to Amy, A's manager; she works in B through a membership.
  person("amy", "a", "MANAGER");
  person("pat", "a", "EMPLOYEE", { managerId: "amy" });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bringing back someone who works here through a membership keeps their own company's line", () => {
  it("a restore and a reactivation keep the line to the manager A relies on, unnamed and uncleared here", async () => {
    expect((await remove("pat")).status).toBe(200);
    const back = await restore("pat");
    expect(back.status).toBe(200);
    // A relies on it (Pat works in A, Amy manages there): it stays, and B says nothing about it.
    expect(db.row("user", "pat").managerId).toBe("amy");
    const body = await back.json();
    expect(body).toMatchObject({ message: "pat Lee has been restored", linesCleared: [] });
    expect(JSON.stringify(body)).not.toContain("amy");
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    expect((await patch("pat", { status: "ACTIVE" })).status).toBe(200);
    expect(db.row("user", "pat").managerId).toBe("amy");
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
  });

  it("a restore in B never clears A's line, even one A could clear itself", async () => {
    // Amy has left A for good. Before step 4 B's restore read the account's
    // line (A's), found it stale and cleared it: a write of A's line by B.
    db.row("user", "amy").deletedAt = new Date("2026-09-01");
    db.row("user", "amy").status = "INACTIVE";
    expect((await remove("pat")).status).toBe(200);
    const back = await restore("pat");
    expect(back.status).toBe(200);
    expect(db.row("user", "pat").managerId).toBe("amy");
    const body = await back.json();
    expect(body).toMatchObject({ message: "pat Lee has been restored", linesCleared: [] });
  });

  it("a restore in B clears a stale B line on the membership, with B's dotted row, and leaves A's line and A's row", async () => {
    // In B, Pat reports to Rita, whom B removed while Pat was away, and has a
    // dotted line to Ada, an Agent in B. A's line (Amy) and A's dotted row to
    // Ada stay A's.
    person("rita", "b", "MANAGER", { deletedAt: new Date("2026-09-01"), status: "INACTIVE" });
    person("ada", "a", "MANAGER");
    db.seed("organizationMembership", { id: "m-ada-b", userId: "ada", organizationId: "b", role: "AGENT" });
    seatOf("pat", "b").managerId = "rita";
    db.seed("userDottedLine", { id: "d-b", userId: "pat", managerId: "ada", organizationId: "b" });
    db.seed("userDottedLine", { id: "d-a", userId: "pat", managerId: "ada", organizationId: "a" });
    expect((await remove("pat")).status).toBe(200);
    const back = await restore("pat");
    expect(back.status).toBe(200);
    const body = await back.json();
    expect(body.linesCleared).toEqual([{ managerId: "rita", kind: "manager", reason: "removed" }, { managerId: "ada", kind: "dotted", reason: "agent" }]);
    // Before: B's restore read the account's line (A's Amy, fine) and never
    // Pat's B line, so she came back under Rita; and it deleted the Ada pair
    // in every workspace.
    expect(seatOf("pat", "b").managerId).toBeNull();
    expect(db.row("user", "pat").managerId).toBe("amy");
    expect(db.tables.userDottedLine.map((d) => d.id)).toEqual(["d-a"]);
  });

  it("a reactivation in B clears a B line to a manager B deactivated, and never A's", async () => {
    // Rita is deactivated in B through her membership, live in A.
    person("rita", "a", "MANAGER");
    db.seed("organizationMembership", { id: "m-rita-b", userId: "rita", organizationId: "b", role: "MANAGER", status: "INACTIVE" });
    seatOf("pat", "b").managerId = "rita";
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    const back = await patch("pat", { status: "ACTIVE" });
    expect(back.status).toBe(200);
    expect((await back.json()).linesCleared).toEqual([{ managerId: "rita", kind: "manager", reason: "inactive" }]);
    expect(seatOf("pat", "b").managerId).toBeNull();
    expect(db.row("user", "pat").managerId).toBe("amy");
  });
});

describe("the handover comes first for someone who works here through a membership", () => {
  it("refuses their deactivation and removal while they own open work here, and never counts their work elsewhere", async () => {
    db.seed("item", { id: "t-b", organizationId: "b", ownerId: "pat", archivedAt: null, status: "In progress", itemType: "TASK" });
    const off = await patch("pat", { status: "INACTIVE" });
    expect(off.status).toBe(409);
    expect((await off.json()).code).toBe("handover_first");
    const out = await remove("pat");
    expect(out.status).toBe(409);
    expect((await out.json()).code).toBe("handover_first");
    expect(seatOf("pat", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    // Their open work in A is A's handover, never this one's.
    db.row("item", "t-b").organizationId = "a";
    expect((await patch("pat", { status: "INACTIVE" })).status).toBe(200);
    expect(seatOf("pat", "b").status).toBe("INACTIVE");
  });

  it("counts a report who works here under them, as for anyone", async () => {
    person("rob", "b", "EMPLOYEE", { managerId: "pat" });
    const off = await patch("pat", { status: "INACTIVE" });
    expect(off.status).toBe(409);
    expect(await off.json()).toMatchObject({ code: "handover_first", pending: { directReports: 1 } });
  });
});
