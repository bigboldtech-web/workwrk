// The one invitation path (sendInvitation) and its acceptance (invite-facts
// managerOnAccept). Docs-found fixes batch 2: "Reports to" on an invitation
// was stored as sent and written straight onto the new person, so a person
// could join under an Agent, who is never anyone's manager (access 2.4), or
// under someone of another workspace.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string; deletedAt: Date | null; status?: string }>,
  invitationsMade: 0,
  /** People anchored elsewhere with a membership here, with its role (batch 5). */
  memberships: {} as Record<string, string>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => ({ domain: "acme.test", settings: {}, name: "Acme" }) },
    user: {
      findFirst: async (a: { where: { id: string; organizationId?: string; deletedAt: null } }) => {
        const p = st.people[a.where.id];
        if (!p || p.deletedAt !== null || (a.where.organizationId !== undefined && p.organizationId !== a.where.organizationId)) return null;
        return { organizationId: p.organizationId, ...legacyLevelRow(p.level), status: p.status ?? "ACTIVE", firstName: a.where.id, lastName: "Ray" };
      },
    },
    organizationMembership: {
      findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) => {
        const role = st.memberships[a.where.userId_organizationId.userId];
        return role ? { role } : null;
      },
    },
    // This workspace's own placement rows (batch 5).
    department: { count: async (a: { where: { id: string } }) => (a.where.id === "dept-here" ? 1 : 0), findFirst: async () => null },
    space: { findFirst: async () => null },
    role: { count: async (a: { where: { id: string } }) => (a.where.id === "role-here" ? 1 : 0) },
    office: { count: async (a: { where: { id: string } }) => (a.where.id === "office-here" ? 1 : 0) },
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
import { invitePlacement, managerOnAccept } from "@/lib/auth/invite-facts.server";

const invite = (managerId: unknown) =>
  sendInvitation({ organizationId: "org", actor: { id: "admin", level: "COMPANY_ADMIN", email: "admin@acme.test" }, email: "new@acme.test", requestedLevel: "EMPLOYEE", managerId });

beforeEach(() => {
  st.people = {
    mona: { organizationId: "org", level: "MANAGER", deletedAt: null },
    sam: { organizationId: "org", level: "AGENT", deletedAt: null },
    far: { organizationId: "other", level: "MANAGER", deletedAt: null },
  };
  st.invitationsMade = 0;
  st.memberships = {};
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

  it("never writes a manager deactivated since the invitation went out (batch 3: live means not deactivated either)", async () => {
    st.people.mona.status = "INACTIVE";
    expect(await managerOnAccept({ organizationId: "org", managerId: "mona" })).toBeNull();
    st.people.mona.status = "ON_LEAVE";
    expect(await managerOnAccept({ organizationId: "org", managerId: "mona" })).toBe("mona");
  });
});

// Docs-found fixes batch 5.
describe("an invitation's placement and manager", () => {
  const inviteWith = (extra: Record<string, unknown>) =>
    sendInvitation({ organizationId: "org", actor: { id: "admin", level: "COMPANY_ADMIN", email: "admin@acme.test" }, email: "new@acme.test", requestedLevel: "EMPLOYEE", ...extra });

  it("refuses another workspace's department, job title or office", async () => {
    // Before: stored as sent, and the acceptance wrote them onto the person.
    expect(await inviteWith({ departmentId: "dept-elsewhere" })).toEqual({ ok: false, status: 400, error: "That department isn't in this workspace" });
    expect(await inviteWith({ roleId: "role-elsewhere" })).toEqual({ ok: false, status: 400, error: "That job title isn't in this workspace" });
    expect(await inviteWith({ officeId: "office-elsewhere" })).toEqual({ ok: false, status: 400, error: "That office isn't in this workspace" });
    expect(st.invitationsMade).toBe(0);
  });

  it("passes the workspace's own, or none", async () => {
    expect(await inviteWith({ departmentId: "dept-here", roleId: "role-here", officeId: "office-here" })).toMatchObject({ ok: false, error: "User already exists in your organization" });
    expect(await inviteWith({ departmentId: "", roleId: null })).toMatchObject({ ok: false, error: "User already exists in your organization" });
  });

  it("takes a manager who last switched to another workspace and manages here, and writes them on acceptance", async () => {
    st.people.dana = { organizationId: "client", level: "EMPLOYEE", deletedAt: null };
    st.memberships = { dana: "MANAGER" };
    // Before: "That manager isn't in this workspace", and the acceptance dropped them.
    expect(await invite("dana")).toMatchObject({ ok: false, error: "User already exists in your organization" });
    expect(await managerOnAccept({ organizationId: "org", managerId: "dana" })).toBe("dana");
    st.memberships = { dana: "AGENT" };
    expect(await managerOnAccept({ organizationId: "org", managerId: "dana" })).toBeNull();
    st.memberships = {};
    expect(await managerOnAccept({ organizationId: "org", managerId: "dana" })).toBeNull();
  });

  it("/join names that manager, as the acceptance writes them", async () => {
    st.people.dana = { organizationId: "client", level: "EMPLOYEE", deletedAt: null };
    st.memberships = { dana: "MANAGER" };
    const placed = await invitePlacement({ organizationId: "org", departmentId: null, managerId: "dana", spaceId: null });
    // Before: null, the name looked up among people anchored here only.
    expect(placed.managerName).toBe("dana Ray");
  });
});
