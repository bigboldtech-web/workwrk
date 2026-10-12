// POST /api/users (a manager adds an account with a password). Docs-found
// fixes batch 2: its Reports to was written as sent, so a new account could
// report to an Agent, who is never anyone's manager (access 2.4), or to
// someone of another workspace. It holds the rule every other door does now.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string; status?: string }>,
  created: [] as Array<Record<string, unknown>>,
  /** The role lock is held (batch 3), and who reads as an Agent once it is. */
  locked: false,
  agentUnderLock: new Set<string>(),
  /** People anchored elsewhere with a membership here, by id, with its role (batch 5). */
  memberships: {} as Record<string, string>,
  /** Addresses already in the workspace through a membership (batch 5). */
  memberEmails: new Set<string>(),
  /** This workspace's own departments and job titles (batch 5). */
  departments: new Set<string>(),
  roles: new Set<string>(),
  seatLocks: [] as Array<{ bounded?: boolean }>,
  seatsBusy: false,
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession("u-boss", "MANAGER") }),
  getOrgId: () => "org",
  getUserId: () => "u-boss",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  isManager: () => true,
}));
vi.mock("@/lib/access/workspace-admin", () => ({ freshWorkspaceActor: async () => ({ ok: true, level: "MANAGER" }) }));
vi.mock("@/lib/people/grantable-level", () => ({ grantableAccessLevel: () => "EMPLOYEE" }));
vi.mock("@/lib/platform-admin", () => ({ isReservedStaffAddress: async () => false, STAFF_ADDRESS_REFUSAL: "" }));
vi.mock("@/lib/password-policy", () => ({ policyFromOrgSettings: () => ({}), validatePassword: () => null }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "hash" } }));
vi.mock("@/lib/seats", () => ({
  lockWorkspaceSeats: async (_tx: unknown, _org: string, opts: { bounded?: boolean } = {}) => {
    st.seatLocks.push(opts);
    if (st.seatsBusy) throw Object.assign(new Error("Someone else is adding people or changing seats in this workspace right now. Try again in a moment."), { name: "SeatsBusy" });
  },
  seatsFor: async () => ({ ok: true }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: () => undefined }));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/directory-list.server", () => ({ directoryList: async () => ({}) }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: async (a: { where: { id?: string; email?: unknown; organizationId?: string } }) => {
      if (a.where.email) return null;
      const p = a.where.id ? st.people[a.where.id] : undefined;
      if (p && st.locked && st.agentUnderLock.has(a.where.id!)) return { organizationId: p.organizationId, ...legacyLevelRow("AGENT") };
      if (!p || (a.where.organizationId !== undefined && p.organizationId !== a.where.organizationId)) return null;
      return { organizationId: p.organizationId, ...legacyLevelRow(p.level), status: p.status ?? "ACTIVE" };
    },
    create: async (a: { data: Record<string, unknown> }) => {
      st.created.push(a.data);
      return { id: "new", ...a.data };
    },
  };
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) => {
      const role = st.memberships[a.where.userId_organizationId.userId];
      return role ? { role } : null;
    },
    findFirst: async (a: { where: { user: { email: { equals: string } } } }) => (st.memberEmails.has(a.where.user.email.equals) ? { id: "mem" } : null),
  };
  return {
    prisma: {
      user,
      organizationMembership,
      department: { count: async (a: { where: { id: string } }) => (st.departments.has(a.where.id) ? 1 : 0) },
      role: { count: async (a: { where: { id: string } }) => (st.roles.has(a.where.id) ? 1 : 0) },
      organization: { findUnique: async () => ({ settings: {} }) },
      $transaction: async (fn: (t: { user: typeof user; organizationMembership: typeof organizationMembership; $executeRaw: () => Promise<number> }) => unknown) => {
        try {
          return await fn({ user, organizationMembership, $executeRaw: async () => { st.locked = true; return 0; } });
        } finally {
          st.locked = false;
        }
      },
    },
  };
});

import { POST } from "./route";

const add = (managerId: unknown) =>
  POST(new Request("https://app.test/api/users", { method: "POST", body: JSON.stringify({ firstName: "Ada", lastName: "L", email: "ada@acme.test", password: "pw", managerId }) }) as never);

beforeEach(() => {
  st.people = { mona: { organizationId: "org", level: "MANAGER" }, sam: { organizationId: "org", level: "AGENT" }, far: { organizationId: "other", level: "MANAGER" } };
  st.created = [];
  st.locked = false;
  st.agentUnderLock = new Set();
  st.memberships = {};
  st.memberEmails = new Set();
  st.departments = new Set(["dept-here"]);
  st.roles = new Set(["role-here"]);
  st.seatLocks = [];
  st.seatsBusy = false;
});

describe("POST /api/users Reports to", () => {
  it("refuses an Agent and someone of another workspace, and makes no account", async () => {
    const agent = await add("sam");
    expect(agent.status).toBe(400);
    expect(await agent.json()).toEqual({ error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" });
    const far = await add("far");
    expect(far.status).toBe(400);
    expect(await far.json()).toEqual({ error: "That manager isn't in this workspace" });
    expect(st.created).toEqual([]);
  });

  it("writes a live manager of this workspace, or none", async () => {
    expect((await add("mona")).status).toBe(201);
    expect((await add(undefined)).status).toBe(201);
    expect(st.created.map((d) => d.managerId)).toEqual(["mona", null]);
  });

  it("checks Reports to again under the role lock, and refuses a manager made an Agent meanwhile (rule 6's race)", async () => {
    // The first check saw a Manager; a role change made mona an Agent before
    // the account was written. Rule 6 counted no report then, so without
    // the second check the new account would land under an Agent.
    st.agentUnderLock = new Set(["mona"]);
    const res = await add("mona");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An Agent can't be anyone's manager", code: "agent_cannot_manage" });
    expect(st.created).toEqual([]);
  });
});

// Docs-found fixes batch 4: a new account never lands under a deactivated
// manager (invariant 13: a deactivated person holds no reports), as an
// accepted invitation never does (managerOnAccept).
describe("POST /api/users Reports to a deactivated person", () => {
  it("is refused under the role lock, and makes no account", async () => {
    st.people.dee = { organizationId: "org", level: "MANAGER", status: "INACTIVE" };
    const res = await add("dee");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("manager_inactive");
    expect(st.created).toEqual([]);
  });
});

// Docs-found fixes batch 5.
const addWith = (extra: Record<string, unknown>) =>
  POST(new Request("https://app.test/api/users", { method: "POST", body: JSON.stringify({ firstName: "Ada", lastName: "L", email: "ada@acme.test", password: "pw", ...extra }) }) as never);

describe("POST /api/users job title and department", () => {
  it("refuses another workspace's department or job title with a 400 naming the field, and makes no account", async () => {
    const dept = await addWith({ departmentId: "dept-elsewhere" });
    // Before: 201, the other workspace's department written on the person.
    expect(dept.status).toBe(400);
    expect(await dept.json()).toEqual({ error: "That department isn't in this workspace", field: "departmentId" });
    const role = await addWith({ roleId: "role-elsewhere" });
    expect(role.status).toBe(400);
    expect(await role.json()).toEqual({ error: "That job title isn't in this workspace", field: "roleId" });
    const shape = await addWith({ departmentId: { not: null } });
    expect(shape.status).toBe(400);
    expect(st.created).toEqual([]);
  });

  it("writes the workspace's own, or none", async () => {
    expect((await addWith({ departmentId: "dept-here", roleId: "role-here" })).status).toBe(201);
    expect((await addWith({ departmentId: "", roleId: null })).status).toBe(201);
    expect(st.created.map((d) => [d.departmentId, d.roleId])).toEqual([["dept-here", "role-here"], [null, null]]);
  });
});

describe("POST /api/users and people who work here through a membership", () => {
  it("takes a Reports to who last switched to another workspace and manages here", async () => {
    st.people.dana = { organizationId: "client", level: "EMPLOYEE" };
    st.memberships = { dana: "MANAGER" };
    const res = await add("dana");
    // Before: 400 "That manager isn't in this workspace".
    expect(res.status).toBe(201);
    expect(st.created.map((d) => d.managerId)).toEqual(["dana"]);
  });

  it("refuses an address already here through a membership: one address, one person", async () => {
    st.memberEmails = new Set(["ada@acme.test"]);
    const res = await add(undefined);
    // Before: a second account for the same mailbox in this workspace.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A user with this email already exists" });
    expect(st.created).toEqual([]);
  });
});

describe("POST /api/users and the seat lock", () => {
  it("waits a bounded time for the seats, and a busy seat lock answers 503 roles_busy, never a 500", async () => {
    expect((await add("mona")).status).toBe(201);
    expect(st.seatLocks).toEqual([{ bounded: true }]);
    st.seatsBusy = true;
    const res = await add("mona");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
  });
});
