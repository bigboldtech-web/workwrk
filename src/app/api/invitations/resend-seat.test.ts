// PATCH /api/invitations { id, resend } for an address whose seat here this
// workspace ended (docs/plans/workspace-status.md step 2, the review H1 and
// M1). Resending an invitation, an expired one included, gives it seven more
// days, and accepting it brings that seat back (D13). Only an Admin, read
// fresh, decides that: a Space editor's resend of a Space invitation, and a
// Manager's of a workspace one, are refused, with nothing written.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ level: "EMPLOYEE", mayInvite: false, maySpace: true, emails: [] as string[] }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession("ed", st.level, "here") }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", () => ({ hasPermission: async () => st.mayInvite }));
vi.mock("@/lib/space", () => ({ canEditSpace: async () => st.maySpace }));
vi.mock("@/lib/access/workspace-admin", () => ({
  freshWorkspaceActor: async () => ({ ok: true, level: st.level, admin: st.level === "COMPANY_ADMIN", owner: false }),
  freshActorRefusal: () => Response.json({ error: "stale" }, { status: 403 }),
}));
vi.mock("@/lib/access/settings-door", () => ({ settingsDoorAllows: async () => true }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }), seatsForAddress: async () => false }));
vi.mock("@/lib/email", () => ({ sendEmail: async (m: { to: string }) => void st.emails.push(m.to) }));
vi.mock("@/lib/email-templates", () => ({ invitationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: () => undefined }));
vi.mock("@/lib/auth/invite-facts.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  inviteSender: async () => ({ inviterId: null, inviterName: null, message: null }),
}));

import { PATCH } from "./route";
import { seatDb as db } from "@/lib/access/seat-test-db";

const resend = async (id: string) => {
  const res = await PATCH(new Request("https://app.test/api/invitations", { method: "PATCH", body: JSON.stringify({ id, resend: true }), headers: { "content-type": "application/json" } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const LONG_AGO = new Date("2026-06-01T00:00:00Z");

beforeEach(() => {
  db.reset();
  st.level = "EMPLOYEE";
  st.mayInvite = false;
  st.maySpace = true;
  st.emails = [];
  db.seed("organization", { id: "here", name: "Here Co", status: "ACTIVE", settings: {} });
  db.seed("organization", { id: "home", name: "Home Co", status: "ACTIVE", settings: {} });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "home" });
  // Here Co removed Pat, who worked here through a membership; his old invitations to a Space and to the workspace expired long ago.
  db.seed("organizationMembership", { id: "m-here", userId: "pat", organizationId: "here", status: "INACTIVE", removedAt: new Date("2026-10-01") });
  db.seed("invitation", { id: "i-space", token: "t1", email: "Pat@x.test", organizationId: "here", ...legacyLevelRow("EMPLOYEE"), spaceId: "s2", spaceRole: "MEMBER", expiresAt: LONG_AGO });
  db.seed("invitation", { id: "i-work", token: "t2", email: "pat@x.test", organizationId: "here", ...legacyLevelRow("EMPLOYEE"), expiresAt: LONG_AGO });
});

describe("a resend for someone this workspace ended", () => {
  it("refuses a Space editor's resend of a Space invitation, in the Space dialog's words, and writes nothing", async () => {
    const { status, body } = await resend("i-space");
    // Before: 200, seven more days, and Pat back in Here Co on accepting.
    expect(status).toBe(403);
    expect(body).toEqual({
      error: "This person no longer has access to your workspace. An Admin can bring them back, then add them to the Space.",
      code: "seat_ended",
    });
    expect(db.writes).toEqual([]);
    expect(st.emails).toEqual([]);
  });

  it("refuses a Manager's resend of a workspace invitation", async () => {
    st.level = "MANAGER";
    st.mayInvite = true;
    const { status, body } = await resend("i-work");
    expect(status).toBe(403);
    expect(body).toEqual({ error: "They were deactivated or removed here. An Admin can bring them back.", code: "seat_ended" });
    expect(db.row("invitation", "i-work").expiresAt).toEqual(LONG_AGO);
  });

  it("lets an Admin resend it: a fresh decision to bring them back (D13)", async () => {
    st.level = "COMPANY_ADMIN";
    st.mayInvite = true;
    const { status } = await resend("i-work");
    expect(status).toBe(200);
    expect((db.row("invitation", "i-work").expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    expect(st.emails).toEqual(["pat@x.test"]);
  });

  it("a Space editor's resend for an address with no ended seat here goes out as before", async () => {
    db.tables.organizationMembership = [];
    expect((await resend("i-space")).status).toBe(200);
  });
});
