// POST /api/users (a manager adds an account with a password). Docs-found
// fixes batch 2: its Reports to was written as sent, so a new account could
// report to an Agent, who is never anyone's manager (access 2.4), or to
// someone of another workspace. It holds the rule every other door does now.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  people: {} as Record<string, { organizationId: string; level: string }>,
  created: [] as Array<Record<string, unknown>>,
  /** The role lock is held (batch 3), and who reads as an Agent once it is. */
  locked: false,
  agentUnderLock: new Set<string>(),
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
vi.mock("@/lib/seats", () => ({ lockWorkspaceSeats: async () => undefined, seatsFor: async () => ({ ok: true }) }));
vi.mock("@/lib/activity", () => ({ logActivity: () => undefined }));
vi.mock("@/lib/alignment-assign", () => ({ seedAlignmentForUser: async () => undefined }));
vi.mock("@/lib/people/directory-list.server", () => ({ directoryList: async () => ({}) }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/user-tags", () => ({ getUserTagsMap: async () => new Map(), resolveUserIdsByTags: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const user = {
    findFirst: async (a: { where: { id?: string; email?: string; organizationId: string } }) => {
      if (a.where.email) return null;
      const p = a.where.id ? st.people[a.where.id] : undefined;
      if (p && st.locked && st.agentUnderLock.has(a.where.id!)) return legacyLevelRow("AGENT");
      return p && p.organizationId === a.where.organizationId ? legacyLevelRow(p.level) : null;
    },
    create: async (a: { data: Record<string, unknown> }) => {
      st.created.push(a.data);
      return { id: "new", ...a.data };
    },
  };
  return {
    prisma: {
      user,
      organization: { findUnique: async () => ({ settings: {} }) },
      $transaction: async (fn: (t: { user: typeof user; $executeRaw: () => Promise<number> }) => unknown) => {
        try {
          return await fn({ user, $executeRaw: async () => { st.locked = true; return 0; } });
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
