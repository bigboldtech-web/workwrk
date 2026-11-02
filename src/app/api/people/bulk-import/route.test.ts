// Import people (POST /api/people/bulk-import) and a person's status in each
// workspace (docs/plans/workspace-status.md D13, step 3): a person this
// workspace ended through their membership (deactivated or removed here) is
// someone to invite back, not "Already a member", as alreadyInOrg answers for
// every invitation path; only an Admin, read fresh, brings them back. Run on
// an in-memory database whose relations follow the rows.
//
// Before: any membership row was "Already a member", whatever its status, so
// an Admin could not bring back by file someone the workspace had ended,
// while the invite dialog could.

import { NextRequest } from "next/server";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/people/person-access.server", () => ({ peopleCtx: async () => st.ctx }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/email-templates", () => ({ invitationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async () => undefined,
  seatsFor: async () => ({ ok: true, use: { limit: 100, members: 0, pending: 0 } }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST } from "./route";

const dryRun = async (rows: Array<Record<string, string>>) => {
  const res = await POST(new NextRequest("https://app.test/api/people/bulk-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows, dryRun: true }) }));
  return { status: res.status, body: await res.json() };
};
const row = (email: string, extra: Record<string, string> = {}) => ({ firstName: "Some", lastName: "One", email, ...extra });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {}, domain: null });
  db.seed("user", { id: "u-admin", email: "admin@x.test", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN") });
  // Anchored in A; in B: Lia live, Rex deactivated, Ron removed.
  for (const id of ["lia", "rex", "ron"]) db.seed("user", { id, email: `${id}@x.test`, organizationId: "a", ...legacyLevelRow("EMPLOYEE") });
  db.seed("organizationMembership", { id: "m-lia", userId: "lia", organizationId: "b", role: "MANAGER" });
  db.seed("organizationMembership", { id: "m-rex", userId: "rex", organizationId: "b", role: "MANAGER", status: "INACTIVE" });
  db.seed("organizationMembership", { id: "m-ron", userId: "ron", organizationId: "b", role: "MANAGER", status: "INACTIVE", removedAt: new Date("2026-10-01") });
  st.ctx = { userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), isAdmin: true };
});

describe("an ended membership is someone to invite back (D13)", () => {
  it("a live membership is a member; one deactivated or removed here is ready to invite, for an Admin", async () => {
    const { status, body } = await dryRun([row("lia@x.test"), row("REX@x.test"), row("ron@x.test")]);
    expect(status).toBe(200);
    expect(body.rows).toEqual([
      { row: 1, email: "lia@x.test", status: "member", message: "Already a member" },
      // Before: both "Already a member".
      { row: 2, email: "rex@x.test", status: "ready" },
      { row: 3, email: "ron@x.test", status: "ready" },
    ]);
  });

  it("only an Admin, read fresh, brings an ended seat back: with a lower level now, the row says who can", async () => {
    st.ctx = { ...st.ctx, ...legacyLevelRow("MANAGER") };
    const { body } = await dryRun([row("rex@x.test")]);
    expect(body.rows).toEqual([{ row: 1, email: "rex@x.test", status: "error", field: "email", message: "They were deactivated or removed here. An Admin can bring them back." }]);
  });

  it("a membership seat here counts whatever the account's state at home, as alreadyInOrg reads it", async () => {
    // Lia's account is removed in A; her seat in B is live: still a member here.
    db.row("user", "lia").deletedAt = new Date("2026-10-01");
    expect((await dryRun([row("lia@x.test")])).body.rows[0]).toMatchObject({ status: "member" });
  });

  it("Reports to may name someone who works here through a membership not removed, never a removed one", async () => {
    const { body } = await dryRun([row("new1@x.test", { reportsTo: "lia@x.test" }), row("new2@x.test", { reportsTo: "ron@x.test" })]);
    expect(body.rows[0]).toEqual({ row: 1, email: "new1@x.test", status: "ready" });
    expect(body.rows[1]).toMatchObject({ status: "error", field: "reportsTo" });
  });
});
