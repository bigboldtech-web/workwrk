// The one invitation path (sendInvitation) and its acceptance (invite-facts
// managerOnAccept). Docs-found fixes batch 2: "Reports to" on an invitation
// was stored as sent and written straight onto the new person, so a person
// could join under an Agent, who is never anyone's manager (access 2.4), or
// under someone of another workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string; deletedAt: Date | null }>,
  invitationsMade: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => ({ domain: "acme.test", settings: {}, name: "Acme" }) },
    user: {
      findFirst: async (a: { where: { id: string; organizationId: string; deletedAt: null } }) => {
        const p = st.people[a.where.id];
        return p && p.organizationId === a.where.organizationId && p.deletedAt === null ? legacyLevelRow(p.level) : null;
      },
    },
    invitation: { findFirst: async () => null, create: async () => { st.invitationsMade += 1; return {}; } },
  },
}));
vi.mock("@/lib/webhooks", () => ({ broadcastWebhook: async () => undefined }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined }));
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }), seatsForAddress: async () => false }));
// Past the manager check, the rest of the path is not this test's business:
// "already here" stops it before any write.
vi.mock("@/lib/auth/invite-facts.server", async () => ({
  ...(await vi.importActual<object>("@/lib/auth/invite-facts.server")),
  alreadyInOrg: async () => ({ member: true, inactive: false, removed: false, elsewhere: false }),
}));

import { sendInvitation } from "./send-invitation.server";
import { managerOnAccept } from "@/lib/auth/invite-facts.server";

const invite = (managerId: unknown) =>
  sendInvitation({ organizationId: "org", actor: { id: "admin", level: "COMPANY_ADMIN", email: "admin@acme.test" }, email: "new@acme.test", requestedLevel: "EMPLOYEE", managerId });

beforeEach(() => {
  st.people = {
    mona: { organizationId: "org", level: "MANAGER", deletedAt: null },
    sam: { organizationId: "org", level: "AGENT", deletedAt: null },
    far: { organizationId: "other", level: "MANAGER", deletedAt: null },
  };
  st.invitationsMade = 0;
});

describe("sendInvitation's Reports to", () => {
  it("refuses an Agent as the manager", async () => {
    expect(await invite("sam")).toEqual({ ok: false, status: 400, error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" });
  });

  it("refuses someone outside this workspace", async () => {
    expect(await invite("far")).toEqual({ ok: false, status: 400, error: "That manager isn't in this workspace" });
    expect(await invite("ghost")).toMatchObject({ ok: false, status: 400 });
  });

  it("passes a live manager of this workspace, and no manager at all", async () => {
    // Both reach "already here", which is past the manager check.
    expect(await invite("mona")).toMatchObject({ ok: false, error: "User already exists in your organization" });
    expect(await invite(undefined)).toMatchObject({ ok: false, error: "User already exists in your organization" });
  });
});

describe("managerOnAccept", () => {
  it("writes the invitation's manager only while they may manage here", async () => {
    expect(await managerOnAccept({ organizationId: "org", managerId: "mona" })).toBe("mona");
    // Made an Agent after the invitation went out: the person joins with no manager.
    expect(await managerOnAccept({ organizationId: "org", managerId: "sam" })).toBeNull();
    st.people.mona.deletedAt = new Date();
    expect(await managerOnAccept({ organizationId: "org", managerId: "mona" })).toBeNull();
    expect(await managerOnAccept({ organizationId: "org", managerId: null })).toBeNull();
  });
});
