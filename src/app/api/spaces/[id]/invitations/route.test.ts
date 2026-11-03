// POST /api/spaces/[id]/invitations and someone whose membership this
// workspace ended (docs/plans/workspace-status.md step 2, D13). An ended
// membership is no longer "already a member" (alreadyInOrg), and /join
// would bring that seat back on acceptance, which is for whoever may invite
// to the workspace to decide, never a Space editor: the Space invitation is
// refused, with where to go instead, and nothing is written.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", async () => {
  const { legacyTestSession } = await import("@/lib/access/test-fixtures");
  return { getServerSession: async () => legacyTestSession("ed", "EMPLOYEE", "here") };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/space", () => ({
  getSpaceForReader: async () => ({ id: "sp", organizationId: "here" }),
  canEditSpace: async () => true,
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/email-templates", () => ({ invitationTemplate: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/access/grants", () => ({ recordSpaceInvite: async () => undefined }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }), seatsForAddress: async () => 1 }));
vi.mock("@/lib/settings/org-policy", () => ({ usersSettingsOf: () => ({ inviteExpiryDays: 7 }) }));

import { POST } from "./route";
import { seatDb as db } from "@/lib/access/seat-test-db";

const invite = async (email: string) => {
  const res = await POST(new Request("https://app.test/api/spaces/sp/invitations", { method: "POST", body: JSON.stringify({ email }), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: "sp" }),
  });
  if (!res) throw new Error("no response");
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  db.reset();
  db.seed("organization", { id: "here", name: "Here Co", status: "ACTIVE" });
  db.seed("organization", { id: "home", name: "Home Co", status: "ACTIVE" });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "home" });
});

describe("a Space invitation for someone whose membership here was ended", () => {
  it("is refused, pointing to an invitation from Members, and nothing is written", async () => {
    for (const ended of [{ status: "INACTIVE" }, { status: "INACTIVE", removedAt: new Date("2026-10-01") }]) {
      db.tables.organizationMembership = [];
      db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "here", ...ended });
      const { status, body } = await invite("pat@x.test");
      expect(status, JSON.stringify(ended)).toBe(400);
      // Before: "This person is in your workspace but is working in another one right now..."
      expect(body.error).toBe("This person no longer has access to your workspace. An Admin can bring them back, then add them to the Space.");
    }
    expect(db.writes).toEqual([]);
  });

  it("someone working here from another workspace is refused as before", async () => {
    db.seed("organizationMembership", { id: "m", userId: "pat", organizationId: "here" });
    const { status, body } = await invite("pat@x.test");
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/working in another one right now/);
  });
});
