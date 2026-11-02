// A name and sign-in address shared with another workspace are never
// written by this workspace's identity provider (docs/plans/workspace-status.md,
// the final review, security H1; src/lib/access/shared-identity.ts), every
// account write SCIM makes is guarded by this workspace (integrity L2), and
// POST matches the address in any case (integrity L3). Run through the real
// routes on the in-memory database, with the real forgot-password route.
//
// The case: Pat works for agency A and for client C; A ended her contract, so
// her account moved to B (D3), where she now works, live, with her C seat
// live. Before, B's identity provider (or anyone holding B's SCIM token) set
// her userName to an address it owns, mailed itself a reset link and was Pat
// in A's history, in B and in C.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ mails: [] as Array<{ to: string }> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/scim-auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/scim-auth")>()),
  authenticateScim: async () => ({ ok: true, organizationId: "b", workspaceInactive: false }),
}));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "staff" }));
vi.mock("@/lib/skills/store", () => ({ skillsBackFor: async () => undefined }));
vi.mock("@/lib/agents/leaver-hooks", () => ({ endTeammateAccessFor: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined, logAuditEvent: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string }) => void st.mails.push(m) }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST } from "./route";
import { PATCH, PUT } from "./[id]/route";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, ops: unknown[]) => PATCH(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method: "PATCH", body: JSON.stringify({ Operations: ops }) }), params(id));
const put = (id: string, body: unknown) => PUT(new NextRequest(`https://app.test/api/scim/v2/Users/${id}`, { method: "PUT", body: JSON.stringify(body) }), params(id));
const post = (body: unknown) => POST(new NextRequest("https://app.test/api/scim/v2/Users", { method: "POST", body: JSON.stringify(body) }));
let ip = 0;
const forgot = (email: string) =>
  forgotPassword(new Request("http://localhost/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.77.0.${++ip}` }, body: JSON.stringify({ email }) }));
const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@agency.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ray", organizationId, ...legacyLevelRow("EMPLOYEE"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...extra });
const seat = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", createdAt: new Date("2026-02-01"), ...extra });

beforeEach(() => {
  db.reset();
  st.mails = [];
  db.onQueryRaw = () => [{ n: 0 }];
  for (const id of ["a", "b", "c"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", plan: "STARTER", settings: {}, domain: null });
  person("owner", "b", { ...legacyLevelRow("SUPER_ADMIN") });
  // Pat: anchored in B now (A removed her, D3), live in C, removed in A.
  person("pat", "b");
  seat("pat", "a", { status: "INACTIVE", removedAt: new Date("2026-10-30") });
  seat("pat", "c");
});

describe("an account shared with another workspace keeps its address and names (security H1)", () => {
  it("PATCH of userName and names writes nothing of them, and answers success with the stored values", async () => {
    const res = await patch("pat", [
      { op: "replace", path: "userName", value: "pat.x@b-owned.test" },
      { op: "replace", path: "name.givenName", value: "Mallory" },
    ]);
    // Before: 200, and the account's address was B's identity provider's.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "pat", userName: "pat@agency.test", active: true });
    expect(db.row("user", "pat")).toMatchObject({ email: "pat@agency.test", firstName: "Pat", lastName: "Ray" });
  });

  it("PUT of the whole resource writes nothing of them either", async () => {
    const res = await put("pat", { userName: "pat.x@b-owned.test", emails: [{ value: "pat.x@b-owned.test", primary: true }], name: { givenName: "Mallory", familyName: "Evil" }, active: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userName: "pat@agency.test" });
    expect(db.row("user", "pat")).toMatchObject({ email: "pat@agency.test", firstName: "Pat", lastName: "Ray" });
  });

  it("a membership elsewhere in any state counts, a removed one included", async () => {
    db.tables.organizationMembership = db.tables.organizationMembership.filter((m) => m.organizationId === "a");
    await patch("pat", [{ op: "replace", path: "userName", value: "pat.x@b-owned.test" }]);
    expect(db.row("user", "pat").email).toBe("pat@agency.test");
  });

  it("forgot-password still mails the original address, and nothing to the address B's identity provider pushed", async () => {
    await patch("pat", [{ op: "replace", path: "userName", value: "pat.x@b-owned.test" }]);
    await forgot("pat.x@b-owned.test");
    expect(st.mails).toEqual([]);
    await forgot("pat@agency.test");
    expect(st.mails.map((m) => m.to)).toEqual(["pat@agency.test"]);
  });

  it("the POST revive for an address in another case writes nothing of the identity, and makes no second account (L3)", async () => {
    // Dana: anchored in A, stored with capitals, her seat here deactivated.
    person("dana", "a", { email: "Dana.Ray@Agency.test" });
    seat("dana", "b", { status: "INACTIVE" });
    const res = await post({ userName: "dana.ray@agency.test", name: { givenName: "Mallory", familyName: "Evil" }, active: true });
    // Before: 201 with a second account for dana.ray@agency.test, anchored here.
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "dana", active: true });
    expect(db.tables.user.filter((u) => String(u.email).toLowerCase() === "dana.ray@agency.test")).toHaveLength(1);
    expect(db.row("user", "dana")).toMatchObject({ email: "Dana.Ray@Agency.test", firstName: "Dana", lastName: "Ray" });
    expect(db.row("organizationMembership", "m-dana-b").status).toBe("ACTIVE");
  });

  it("POST answers the 409 for someone anchored here stored in another case (L3)", async () => {
    person("lee", "b", { email: "Lee@Agency.test" });
    const res = await post({ userName: "lee@agency.test", name: { givenName: "Lee", familyName: "Ray" }, active: true });
    // Before: 201, a second account for the same mailbox here.
    expect(res.status).toBe(409);
    expect(db.tables.user.filter((u) => String(u.email).toLowerCase() === "lee@agency.test")).toHaveLength(1);
  });

  it("someone anchored here with no membership anywhere else is renamed as before", async () => {
    person("ivy", "b");
    const res = await patch("ivy", [{ op: "replace", path: "userName", value: "ivy.new@agency.test" }, { op: "replace", path: "name.familyName", value: "Moss" }]);
    expect(res.status).toBe(200);
    expect(db.row("user", "ivy")).toMatchObject({ email: "ivy.new@agency.test", lastName: "Moss", emailVerifiedAt: null });
  });
});

describe("every account write SCIM makes is guarded by this workspace (integrity L2)", () => {
  it("a person who left this workspace between the route's read and the write takes none of the push, and is answered as gone from here", async () => {
    person("ivy", "b");
    // Another admin's change lands right after the route read Ivy as anchored
    // here (a state with no membership left behind, so only the guard can
    // stop the write).
    let seen = false;
    db.onCall = (entry) => {
      if (seen) {
        db.onCall = null;
        db.row("user", "ivy").organizationId = "c";
        return;
      }
      if (entry === "user.findFirst") seen = true;
    };
    const res = await patch("ivy", [{ op: "replace", path: "name.familyName", value: "Moss" }]);
    // Before: the name written onto an account no longer anchored here.
    expect(db.row("user", "ivy").lastName).toBe("Ray");
    expect(res.status).toBe(404);
  });
});
