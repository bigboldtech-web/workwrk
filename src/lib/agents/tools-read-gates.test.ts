// Ask AI reads exactly what the person could open, for SOPs and meetings.
//
// search_sops listed every SOP in the workspace (drafts and restricted
// folders included) and search_meetings returned every meeting (other
// people's one to ones, with agenda and attendees, deleted ones too). Both
// now apply the page's own rule, with the caller's level read fresh. The
// database is mocked: the test reads the query each tool sends.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOf, legacyLevelRow } from "@/lib/access/test-fixtures";

let level: string | null;
let meetingWhere: Record<string, unknown> | null;
let sopWhere: Record<string, unknown> | null;
let contractWhere: Record<string, unknown> | null;
let employeeWhere: Record<string, unknown> | null;
let engineRole: "OWNER" | "ADMIN" | "MEMBER" | "GUEST" | null;
let gave: Record<string, unknown> | null;
let contractUpdated: boolean;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      // A lookup by email is send_kudos finding the receiver; any other is the caller's level.
      findFirst: async (args: { where: { email?: unknown } }) => (args.where.email ? { id: "u-lea", firstName: "Lea", lastName: "Alpha" } : level ? legacyLevelRow(level) : null),
      // The caller, by id, anchored here (tools.ts callerLevel).
      findUnique: async () => (level ? { organizationId: "org-1", ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null } : null),
      findMany: async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        employeeWhere = args.where;
        return [{ id: "u-lea", firstName: "Lea", lastName: "Alpha", email: "lea@x.com", ...legacyLevelRow("EMPLOYEE"), department: null, role: null }];
      },
    },
    conversationMember: { findMany: async () => [{ userId: "u-lea" }] },
    meeting: { findMany: async (args: { where: Record<string, unknown> }) => { meetingWhere = args.where; return []; } },
    sOP: { findMany: async (args: { where: Record<string, unknown> }) => { sopWhere = args.where; return []; } },
    contract: {
      findMany: async (args: { where: Record<string, unknown> }) => { contractWhere = args.where; return []; },
      // the mocked table holds one contract, c-1, owned by u-other
      findFirst: async (args: { where: { id: string; AND: Array<{ ownerId?: string }> } }) => {
        contractWhere = args.where as unknown as Record<string, unknown>;
        const owner = args.where.AND[0]?.ownerId;
        return args.where.id === "c-1" && (owner === undefined || owner === "u-other") ? { id: "c-1", signedAt: null } : null;
      },
      update: async () => { contractUpdated = true; return { id: "c-1" }; },
    },
  },
}));
vi.mock("@/lib/sop-access", () => ({
  sopVisibilityWhere: async (s: { user: { accessLevel?: string } }) => (legacyLevelOf(s) === "COMPANY_ADMIN" ? {} : { OR: [{ visibleTo: "u-1" }] }),
}));
vi.mock("@/lib/access/viewer", () => ({
  viewerHeldIn: async () => (engineRole ? { userId: "u-1", organizationId: "org-1", orgRole: engineRole, peopleTeam: false } : null),
}));
vi.mock("@/lib/kudos-give", () => ({
  giveKudos: async (input: Record<string, unknown>) => {
    gave = input;
    return engineRole === "GUEST" ? { ok: false, status: 404, error: "Not found" } : { ok: true, duplicate: false, kudos: { id: "k-1", message: input.message, companyValue: null } };
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  hasPermission: async () => true,
  isOrgAdmin: (s: { user: { accessLevel?: string } }) => ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(legacyLevelOf(s)),
}));

const { TOOLS } = await import("./tools");
const ctx = { orgId: "org-1", userId: "u-1" };

beforeEach(() => {
  level = "EMPLOYEE";
  meetingWhere = null;
  sopWhere = null;
  contractWhere = null;
  contractUpdated = false;
  employeeWhere = null;
  engineRole = "MEMBER";
  gave = null;
});

describe("search_meetings", () => {
  it("an employee reads only meetings they made or attend, and never a deleted one", async () => {
    await TOOLS.search_meetings.handler(ctx, {});
    expect(meetingWhere).toMatchObject({ organizationId: "org-1", deletedAt: null, OR: [{ createdById: "u-1" }, { attendees: { some: { userId: "u-1" } } }] });
  });

  it("an org admin reads every meeting, still never a deleted one", async () => {
    level = "COMPANY_ADMIN";
    await TOOLS.search_meetings.handler(ctx, {});
    expect(meetingWhere).toMatchObject({ organizationId: "org-1", deletedAt: null });
    expect(meetingWhere).not.toHaveProperty("OR");
  });

  it("a person no longer in the workspace reads nothing", async () => {
    level = null;
    expect(await TOOLS.search_meetings.handler(ctx, {})).toEqual({ count: 0, meetings: [] });
    expect(meetingWhere).toBeNull();
  });
});

describe("search_sops", () => {
  it("applies the SOP list's visibility rule beside every other filter", async () => {
    await TOOLS.search_sops.handler(ctx, { query: "onboarding" });
    expect(sopWhere).toMatchObject({ organizationId: "org-1", AND: [{ OR: [{ visibleTo: "u-1" }] }] });
    expect(sopWhere?.OR).toEqual([{ title: { contains: "onboarding", mode: "insensitive" } }, { description: { contains: "onboarding", mode: "insensitive" } }]);
  });

  it("a person no longer in the workspace reads nothing", async () => {
    level = null;
    expect(await TOOLS.search_sops.handler(ctx, {})).toEqual({ count: 0, sops: [] });
    expect(sopWhere).toBeNull();
  });
});

describe("search_contracts and update_contract", () => {
  it("an employee reads only the contracts they own; the manager tier reads them all", async () => {
    await TOOLS.search_contracts.handler(ctx, {});
    expect(contractWhere).toMatchObject({ organizationId: "org-1", AND: [{ ownerId: "u-1" }] });
    level = "MANAGER";
    await TOOLS.search_contracts.handler(ctx, {});
    expect(contractWhere).toMatchObject({ organizationId: "org-1", AND: [{}] });
  });

  it("an employee cannot change a contract someone else owns, and it reads as not found", async () => {
    expect(await TOOLS.update_contract.handler(ctx, { contractId: "c-1", status: "SIGNED" })).toEqual({ error: "Contract not found in this org" });
    expect(contractUpdated).toBe(false);
    level = "MANAGER";
    expect(await TOOLS.update_contract.handler(ctx, { contractId: "c-1", status: "SIGNED" })).toMatchObject({ ok: true });
    expect(contractUpdated).toBe(true);
  });

  it("a person no longer in the workspace reads and changes nothing", async () => {
    level = null;
    expect(await TOOLS.search_contracts.handler(ctx, {})).toEqual({ count: 0, contracts: [] });
    expect(contractWhere).toBeNull();
    expect(await TOOLS.update_contract.handler(ctx, { contractId: "c-1" })).toEqual({ error: "Contract not found in this org" });
  });
});

describe("search_employees", () => {
  it("a Member finds colleagues without their access level; an admin sees it", async () => {
    const member = await TOOLS.search_employees.handler(ctx, { query: "lea" }) as { employees: Array<Record<string, unknown>> };
    expect(legacyLevelOf({ user: member.employees[0] as { accessLevel?: string } })).toBe("");
    expect(employeeWhere).toMatchObject({ organizationId: "org-1", status: "ACTIVE", deletedAt: null });
    engineRole = "ADMIN";
    const admin = await TOOLS.search_employees.handler(ctx, { query: "lea" }) as { employees: Array<Record<string, unknown>> };
    expect(legacyLevelOf({ user: admin.employees[0] as { accessLevel?: string } })).toBe("EMPLOYEE");
  });

  it("a Guest finds only the people they share a conversation with", async () => {
    engineRole = "GUEST";
    await TOOLS.search_employees.handler(ctx, {});
    expect(employeeWhere).toMatchObject({ id: { in: ["u-lea"] } });
  });

  it("a person no longer in the workspace finds nobody", async () => {
    engineRole = null;
    expect(await TOOLS.search_employees.handler(ctx, {})).toEqual({ count: 0, employees: [] });
    expect(employeeWhere).toBeNull();
  });
});

describe("send_kudos", () => {
  it("gives the kudos the wall's way, so the person thanked is told", async () => {
    const r = await TOOLS.send_kudos.handler(ctx, { receiverEmail: "LEA@x.com ", message: "Thanks" });
    expect(gave).toMatchObject({ organizationId: "org-1", giverId: "u-1", receiverId: "u-lea", message: "Thanks" });
    expect(r).toMatchObject({ ok: true, receiver: "Lea Alpha" });
  });

  it("a Guest is told they cannot, and nothing is given", async () => {
    engineRole = "GUEST";
    expect(await TOOLS.send_kudos.handler(ctx, { receiverEmail: "lea@x.com", message: "Thanks" })).toEqual({ error: "You can't give kudos in this workspace." });
  });
});
