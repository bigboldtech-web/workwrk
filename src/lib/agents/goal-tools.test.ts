import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelOf, legacyLevelRow } from "@/lib/access/test-fixtures";

// The Ask AI goal tools act as the signed-in person and no further: search
// returns only goals that person could open, and create follows the same
// rules as POST /api/okrs (Individual only for a Member, the Company-goal
// right for a Company goal, the creator on record).

const users: Record<string, string> = {};
const goals: Array<{ id: string; title: string; level: string; ownerId: string | null; departmentId: string | null; status: string; progress: number; quarter: string | null; keyResults: unknown[] }> = [];
const created: Array<Record<string, unknown>> = [];
const activity: Array<Record<string, unknown>> = [];
const notices: Array<Record<string, unknown>> = [];
const visibleTo: Record<string, Set<string>> = {};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users[where.id] ? legacyLevelRow(users[where.id]) : null;
        const id = where.email?.split("@")[0] ?? "";
        return users[id] ? { id } : null;
      },
    },
    oKR: {
      // Applies the visibility fragment the tool passes (the mocked
      // goalVisibilityOr below returns an id list), as the database would.
      findMany: async ({ where, take }: { where: { AND?: Array<{ OR: Array<{ id?: { in: string[] } }> }> }; take: number }) => {
        const allowed = where.AND?.[0]?.OR?.[0]?.id?.in;
        return goals.filter((g) => !allowed || allowed.includes(g.id)).slice(0, take);
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `new${created.length}`, title: data.title, level: data.level, status: "ON_TRACK", quarter: null, keyResults: [] };
      },
    },
    notification: { create: async ({ data }: { data: Record<string, unknown> }) => { notices.push(data); return data; } },
  },
}));
vi.mock("@/lib/goal-audience", () => ({
  goalVisibilityOr: async (s: { user: { id: string } }) => [{ id: { in: [...(visibleTo[s.user.id] ?? [])] } }],
}));
vi.mock("@/lib/alignment-scope", () => ({
  goalRightsActor: async (s: { user: { id: string; accessLevel?: string } }) => {
    const level = legacyLevelOf(s);
    return { callerId: s.user.id, admin: level === "COMPANY_ADMIN", peopleTeam: level === "HR", manager: level === "MANAGER" || level === "COMPANY_ADMIN", agent: false, chain: null };
  },
}));
vi.mock("@/lib/alignment", () => ({ persistGoalRollupChain: async () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: (a: Record<string, unknown>) => { activity.push(a); } }));

import { TOOLS } from "./tools";

const ctx = (userId: string) => ({ orgId: "org", userId });

beforeEach(() => {
  for (const k of Object.keys(users)) delete users[k];
  for (const k of Object.keys(visibleTo)) delete visibleTo[k];
  goals.length = 0; created.length = 0; activity.length = 0; notices.length = 0;
});

describe("search_okrs", () => {
  it("returns only the goals the person could open", async () => {
    users.emp = "EMPLOYEE";
    const g = (id: string, level: string, ownerId: string | null) => ({ id, title: id, level, ownerId, departmentId: null, status: "ON_TRACK", progress: 0, quarter: null, keyResults: [] });
    goals.push(g("company", "COMPANY", "ceo"), g("mine", "INDIVIDUAL", "emp"), g("peer-private", "INDIVIDUAL", "peer"));
    visibleTo.emp = new Set(["company", "mine"]);
    const r = (await TOOLS.search_okrs.handler(ctx("emp"), {})) as { count: number; okrs: Array<{ id: string }> };
    expect(r.okrs.map((o) => o.id)).toEqual(["company", "mine"]);
  });

  it("returns nothing for someone outside the org", async () => {
    goals.push({ id: "x", title: "x", level: "COMPANY", ownerId: null, departmentId: null, status: "ON_TRACK", progress: 0, quarter: null, keyResults: [] });
    expect(await TOOLS.search_okrs.handler(ctx("stranger"), {})).toEqual({ count: 0, okrs: [] });
  });
});

describe("create_okr", () => {
  it("lets a Member make an Individual goal for themselves, with the creator on record", async () => {
    users.emp = "EMPLOYEE";
    const r = (await TOOLS.create_okr.handler(ctx("emp"), { title: "Ship it" })) as { ok?: boolean };
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ level: "INDIVIDUAL", ownerId: "emp" });
    expect(activity[0]).toMatchObject({ type: "okr_created", actorId: "emp", targetType: "okr" });
  });

  it("refuses a Member a Company or Department goal, or a goal for someone else", async () => {
    users.emp = "EMPLOYEE";
    users.ceo = "COMPANY_ADMIN";
    expect(await TOOLS.create_okr.handler(ctx("emp"), { title: "Win", level: "COMPANY" })).toHaveProperty("error");
    expect(await TOOLS.create_okr.handler(ctx("emp"), { title: "Win", level: "DEPARTMENT" })).toHaveProperty("error");
    expect(await TOOLS.create_okr.handler(ctx("emp"), { title: "Win", ownerEmail: "ceo@x.com" })).toHaveProperty("error");
    expect(created).toHaveLength(0);
  });

  it("refuses a plain manager a Company goal owned by someone else, and allows one they own", async () => {
    users.mgr = "MANAGER";
    users.ceo = "COMPANY_ADMIN";
    expect(await TOOLS.create_okr.handler(ctx("mgr"), { title: "Win", level: "COMPANY", ownerEmail: "ceo@x.com" })).toHaveProperty("error");
    expect(created).toHaveLength(0);
    const own = (await TOOLS.create_okr.handler(ctx("mgr"), { title: "Win", level: "COMPANY" })) as { ok?: boolean };
    expect(own.ok).toBe(true);
  });

  it("lets a manager give a report a goal, and tells the report", async () => {
    users.mgr = "MANAGER";
    users.rep = "EMPLOYEE";
    const r = (await TOOLS.create_okr.handler(ctx("mgr"), { title: "Grow", level: "DEPARTMENT", ownerEmail: "rep@x.com" })) as { ok?: boolean };
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ level: "DEPARTMENT", ownerId: "rep" });
    expect(notices[0]).toMatchObject({ userId: "rep", type: "okr_assigned" });
  });
});
