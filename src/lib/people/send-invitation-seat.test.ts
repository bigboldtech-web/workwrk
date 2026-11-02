// An invitation for someone this workspace deactivated or removed through
// their membership (docs/plans/workspace-status.md step 2, the review M1).
// Such a seat is not "already here" (D13): accepting the invitation brings it
// back. Only an Admin, read fresh, may decide that, as only the gated People
// routes bring back someone anchored here; a Manager or Team Lead (who may
// invite) is refused with a plain sentence, and so is Ask AI acting for one.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/webhooks", () => ({ broadcastWebhook: () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined, logActivity: async () => undefined }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }), seatsForAddress: async () => false }));
vi.mock("@/lib/api-helpers", async (importOriginal) => ({ ...(await importOriginal<object>()), hasPermission: async () => true }));

import { sendInvitation } from "./send-invitation.server";
import { TOOLS } from "@/lib/agents/tools";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { seatDb as db } from "@/lib/access/seat-test-db";

const REFUSAL = "They were deactivated or removed here. An Admin can bring them back.";
const invite = (level: string) =>
  sendInvitation({ organizationId: "here", actor: { id: "boss", level, email: "boss@x.test" }, email: "Pat@x.test", requestedLevel: "EMPLOYEE" });

beforeEach(() => {
  db.reset();
  db.seed("organization", { id: "here", name: "Here Co", status: "ACTIVE", domain: "x.test", settings: {} });
  db.seed("organization", { id: "home", name: "Home Co", status: "ACTIVE", domain: "x.test", settings: {} });
  db.seed("user", { id: "boss", email: "boss@x.test", firstName: "B", lastName: "Oss", organizationId: "here", ...legacyLevelRow("MANAGER") });
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "P", organizationId: "home" });
  // Here Co removed Pat, who works here through a membership.
  db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE", removedAt: new Date("2026-10-01") });
});

describe("sendInvitation for an address whose seat here was ended", () => {
  it("refuses a Manager or a Team Lead with a plain sentence, and makes no invitation", async () => {
    for (const level of ["MANAGER", "TEAM_LEAD", "HR"]) {
      // Before: made, and Pat's acceptance undid the removal.
      expect(await invite(level), level).toEqual({ ok: false, status: 403, error: REFUSAL, code: "seat_ended" });
    }
    expect(db.tables.invitation ?? []).toEqual([]);
  });

  it("lets an Admin invite them back (D13), and an address with no seat here is anyone's to invite", async () => {
    expect(await invite("COMPANY_ADMIN")).toMatchObject({ ok: true, invitation: { email: "Pat@x.test" } });
    const fresh = await sendInvitation({ organizationId: "here", actor: { id: "boss", level: "MANAGER", email: "boss@x.test" }, email: "new@x.test", requestedLevel: "EMPLOYEE" });
    expect(fresh).toMatchObject({ ok: true });
  });
});

describe("Ask AI's invite tool for that address", () => {
  it("shows the refusal to a Manager, word for word, and makes no invitation", async () => {
    const tool = (TOOLS as unknown as Record<string, { handler: (ctx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>> }>).invite_person_with_role;
    expect(await tool.handler({ orgId: "here", userId: "boss" }, { email: "pat@x.test" })).toEqual({ error: REFUSAL });
    expect(db.tables.invitation ?? []).toEqual([]);
  });
});

// The final review, product M5: someone ended where they are anchored HERE
// (D4) is no membership an invitation revives, so the invitation is refused
// as before, but the answer now says the way back. Before: "User already
// exists in your organization", for someone not in Members at all.
// And L3: the ended-seat sentences say one rule, "An Admin can bring them
// back", so a Manager is never sent to a door that refuses them.
describe("sendInvitation for someone ended where they are anchored here (M5, L3)", () => {
  beforeEach(() => {
    db.seed("user", { id: "rex", email: "rex@x.test", firstName: "Rex", lastName: "R", organizationId: "here", status: "INACTIVE" });
  });

  it("tells an Admin where to reactivate a deactivated person, and where to restore a removed one", async () => {
    const asAdmin = (email: string) => sendInvitation({ organizationId: "here", actor: { id: "boss", level: "COMPANY_ADMIN", email: "boss@x.test" }, email, requestedLevel: "EMPLOYEE" });
    expect(await asAdmin("rex@x.test")).toEqual({ ok: false, status: 400, error: "They are deactivated here. Reactivate them in Members." });
    db.row("user", "rex").deletedAt = new Date("2026-10-01");
    expect(await asAdmin("REX@x.test")).toEqual({ ok: false, status: 400, error: "They were removed from this workspace. Restore them from the Directory's Removed view." });
    expect(db.tables.invitation ?? []).toEqual([]);
  });

  it("tells anyone else that an Admin brings them back", async () => {
    const asManager = () => sendInvitation({ organizationId: "here", actor: { id: "boss", level: "MANAGER", email: "boss@x.test" }, email: "rex@x.test", requestedLevel: "EMPLOYEE" });
    expect(await asManager()).toEqual({ ok: false, status: 400, error: "They are deactivated here. An Admin can bring them back." });
    db.row("user", "rex").deletedAt = new Date("2026-10-01");
    expect(await asManager()).toEqual({ ok: false, status: 400, error: "They were removed from this workspace. An Admin can bring them back." });
  });

  it("still answers a live person here as already in the workspace", async () => {
    db.row("user", "rex").status = "ACTIVE";
    expect(await invite("COMPANY_ADMIN").then(() => sendInvitation({ organizationId: "here", actor: { id: "boss", level: "COMPANY_ADMIN", email: "boss@x.test" }, email: "rex@x.test", requestedLevel: "EMPLOYEE" }))).toEqual({ ok: false, status: 400, error: "User already exists in your organization" });
  });
});
