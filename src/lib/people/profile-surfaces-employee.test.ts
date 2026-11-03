// The surfaces a person who is no Admin sees show a department, job title or
// office only when it is this workspace's own (docs/plans/workspace-status.md
// D18, step 4; src/lib/access/profile-here.ts): the people pickers (GET
// /api/people/pick, behind Talk, mentions, meetings and Manage access), the
// Talk DM card (GET /api/conversations/[id]), the kudos feed and its
// leaderboard, the Ideas board, Workload's department groups and My team's
// rows. Run on an in-memory database.
//
// The case, as in profile-surfaces.test.ts: Max works in B (anchored there)
// but his account still carries A's Finance department and A's Controller
// title (old data, or a move before D18). Before, every one of these named
// them in B.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "u-me", organizationId: "b" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-me", organizationId: "b", ...legacyLevelRow("EMPLOYEE") } } }),
  getOrgId: () => "b",
  getUserId: () => "u-me",
}));
vi.mock("@/lib/access/viewer", () => ({
  viewerFromSession: async () => ({ userId: "u-me", organizationId: "b", orgRole: "MEMBER", isAgent: false, peopleTeam: false }),
  viewerForUser: async () => ({ userId: "u-me", orgRole: "MEMBER", peopleTeam: false }),
}));
vi.mock("@/lib/talk-gate", () => ({
  talkGate: async () => ({ error: null, gate: { userId: "u-me", organizationId: "b" } }),
  loadConversationRole: async (id: string) => ({ role: "member", joinable: false, conversation: { id, type: "DM", name: null, topic: null, restricted: false, findable: false, archivedAt: null, createdById: null, createdAt: new Date("2026-10-01"), callEpoch: 0 } }),
  conversationNotFound: () => new Response(null, { status: 404 }),
  needFullAccess: () => null,
}));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));
vi.mock("@/lib/people/team-scope.server", () => ({ teamScopeFor: async () => ({ orgWide: false, ids: ["max", "bea"], direct: new Set(["max", "bea"]), hasIndirect: false }) }));
vi.mock("@/lib/people/team-boards.server", () => ({ readableBoardsFor: async () => ({ ids: [], byId: new Map(), isDone: () => false }), openItemsWhere: () => ({}) }));
vi.mock("@/lib/work-schedule-server", () => ({ readOrgWorkSchedule: async () => null }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET as pick } from "@/app/api/people/pick/route";
import { GET as conversation } from "@/app/api/conversations/[id]/route";
import { GET as kudos } from "@/app/api/kudos/route";
import { GET as leaderboard } from "@/app/api/kudos/leaderboard/route";
import { GET as ideas } from "@/app/api/ideas/route";
import { GET as workload } from "@/app/api/team/workload/route";
import { GET as membersWork } from "@/app/api/team/members-work/route";
import { GET as skills } from "@/app/api/skills/route";

const FOREIGN = /Finance|Controller/;
const req = (url: string) => new NextRequest(`https://app.test${url}`);
const json = async (res: Response) => res.json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  db.reset();
  st.ctx = { userId: "u-me", organizationId: "b", ...legacyLevelRow("MANAGER"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false, orgWide: false, managerTier: true, chain: new Set(["max", "bea"]), writeChain: new Set(["max", "bea"]), viewer: { userId: "u-me", organizationId: "b" } };
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  db.seed("department", { id: "dep-a", name: "Finance", color: null, organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Design", color: null, organizationId: "b" });
  db.seed("role", { id: "role-a", title: "Controller", level: "MANAGER", organizationId: "a" });
  db.seed("role", { id: "role-b", title: "Designer", level: "EMPLOYEE", organizationId: "b" });
  const base = { lastName: "Lee", phone: null, status: "ACTIVE", deletedAt: null, managerId: null, officeId: null, presenceStatus: null, joinDate: new Date("2026-01-01") };
  db.seed("user", { id: "u-me", email: "me@x.test", firstName: "Mo", organizationId: "b", ...legacyLevelRow("MANAGER"), departmentId: null, roleId: null, ...base });
  db.seed("user", { id: "max", email: "max@x.test", firstName: "Max", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), departmentId: "dep-a", roleId: "role-a", ...base });
  db.seed("user", { id: "bea", email: "bea@x.test", firstName: "Bea", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), departmentId: "dep-b", roleId: "role-b", ...base });
});

describe("what a colleague sees names this workspace's own only (D18)", () => {
  it("the people pickers show this workspace's job titles only", async () => {
    const body = await json(await pick(req("/api/people/pick")));
    const people = body.people as Array<{ id: string; role: unknown }>;
    // Before: Max's row carried { title: "Controller" }, A's.
    expect(people.find((p) => p.id === "max")?.role).toBeNull();
    expect(people.find((p) => p.id === "bea")?.role).toEqual({ title: "Designer" });
    const named = await json(await pick(req("/api/people/pick?ids=max,bea")));
    expect(JSON.stringify(named)).not.toMatch(FOREIGN);
  });

  it("Talk's DM card shows this workspace's title and department only", async () => {
    db.seed("conversationMember", { id: "cm1", conversationId: "c1", userId: "u-me", notifyLevel: "ALL", starred: false, joinedAt: new Date("2026-10-01") });
    db.seed("conversationMember", { id: "cm2", conversationId: "c1", userId: "max", notifyLevel: "ALL", starred: false, joinedAt: new Date("2026-10-02") });
    const body = await json(await conversation(req("/api/conversations/c1"), { params: Promise.resolve({ id: "c1" }) }));
    const members = body.members as Array<{ userId: string; user: Record<string, unknown> }>;
    // Before: { role: { title: "Controller" }, department: { name: "Finance" } }.
    expect(members.find((m) => m.userId === "max")?.user).toMatchObject({ role: null, department: null });
    expect(JSON.stringify(members)).not.toMatch(FOREIGN);
  });

  it("the kudos feed and the leaderboard show this workspace's titles and departments only", async () => {
    db.seed("kudos", { id: "k1", organizationId: "b", giverId: "bea", receiverId: "max", message: "Thanks", companyValue: null, createdAt: new Date() });
    db.seed("kudos", { id: "k2", organizationId: "b", giverId: "max", receiverId: "bea", message: "Great", companyValue: null, createdAt: new Date(Date.now() - 1000) });
    const feed = await json(await kudos(req("/api/kudos")));
    const rows = feed.data as unknown[];
    // Before: Max as giver and as receiver named Controller and Finance.
    expect(JSON.stringify(rows)).not.toMatch(FOREIGN);
    expect(JSON.stringify(rows)).toContain("Designer");
    const board = await json(await leaderboard(req("/api/kudos/leaderboard?period=all")));
    const list = board.leaderboard as Array<{ userId: string; role: string | null; department: string }>;
    expect(list.find((r) => r.userId === "max")).toMatchObject({ role: null, department: "" });
    expect(list.find((r) => r.userId === "bea")).toMatchObject({ role: "Designer", department: "Design" });
  });

  it("the Ideas board shows a submitter's department only when it is this workspace's", async () => {
    db.seed("idea", { id: "i1", organizationId: "b", title: "Idea", description: "", submitterId: "max", reviewerId: null, status: "SUBMITTED", createdAt: new Date() });
    db.seed("idea", { id: "i2", organizationId: "b", title: "Idea 2", description: "", submitterId: "bea", reviewerId: null, status: "SUBMITTED", createdAt: new Date(Date.now() - 1000) });
    const list = (await (await ideas(req("/api/ideas"))).json()) as Array<{ id: string; submitter: { department: unknown } }>;
    // Before: { name: "Finance" }.
    expect(list.find((i) => i.id === "i1")?.submitter.department).toBeNull();
    expect(list.find((i) => i.id === "i2")?.submitter.department).toEqual({ name: "Design" });
  });

  it("the Skills directory names a holder's department only when it is this workspace's", async () => {
    db.seed("userSkill", { id: "s1", userId: "max", name: "Excel", selfRating: 4, managerRating: null });
    db.seed("userSkill", { id: "s2", userId: "bea", name: "Excel", selfRating: 3, managerRating: null });
    const body = await json(await skills(req("/api/skills")));
    const people = (body.data as Array<{ people: Array<{ userId: string; department: unknown }> }>)[0].people;
    // Before: { id: "dep-a", name: "Finance" }.
    expect(people.find((p) => p.userId === "max")?.department).toBeNull();
    expect(people.find((p) => p.userId === "bea")?.department).toEqual({ id: "dep-b", name: "Design" });
  });

  it("Workload groups by this workspace's departments only, and My team names its own titles and departments only", async () => {
    const load = await json(await workload(req("/api/team/workload?from=2026-10-05&to=2026-10-11")));
    const people = load.people as Array<{ id: string; departmentId: string | null }>;
    // Before: "dep-a", A's Finance, its own group.
    expect(people.find((p) => p.id === "max")?.departmentId).toBeNull();
    expect(people.find((p) => p.id === "bea")?.departmentId).toBe("dep-b");
    const team = await json(await membersWork(req("/api/team/members-work")));
    const rows = (team.rows ?? team.data) as Array<{ id: string; role: unknown; department: unknown }>;
    expect(rows.find((r) => r.id === "max")).toMatchObject({ role: null, department: null });
    expect(rows.find((r) => r.id === "bea")).toMatchObject({ role: { id: "role-b", title: "Designer" }, department: { id: "dep-b", name: "Design" } });
  });
});

// The rollup page (Teams, sub-teams) is a server page; its managers' job
// titles read the same rule, checked in its source.
describe("the sub-teams page", () => {
  it("reads each manager's job title with its workspace, and shows it only when it is this workspace's", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/app/(dashboard)/team/rollup/page.tsx`, "utf8");
    expect(src).toContain("role: { select: { title: true, organizationId: true } }");
    expect(src).toContain("ownHere(t.role, u.organizationId as string)?.title ?? null");
  });
});
