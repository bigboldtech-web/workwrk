// The Apps page's "N people lose access" preview (app-floor-impact.server.ts)
// and the Agent tier (docs-found fixes batch 3). The preview counted anyone
// named as a manager, solid or dotted, as having reports, so an Agent with
// lines stored before rule 6 kept the manager floor there while the engine's
// viewer (reportTree, empty for an Agent) took it away. Both say the same now.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The people here through a membership: their line and level here
// (workspace-status-2 step 2). Each read answers only when it is asked what
// the preview must ask (the step 2 review L5): the people anchored here and
// active, the memberships here at an active seat (membershipHereWhere), and
// this workspace's dotted lines, every bound value this workspace.
const st = vi.hoisted(() => ({
  members: [] as Array<{ userId: string; role: string; managerId: string | null }>,
  memberWhere: null as unknown,
  asked: { users: [] as unknown[], members: [] as unknown[], dotted: [] as Array<{ sql: string; values: unknown[] }> },
}));

vi.mock("@/lib/prisma", async () => {
  // The statement as Postgres receives it: raw fragments (keptSeatSql) inline, the rest bound values.
  const { Prisma } = await import("@/generated/prisma");
  return { prisma: {
    user: {
      findMany: async (a: { where: unknown }) => {
        st.asked.users.push(a.where);
        if (JSON.stringify(a.where) !== JSON.stringify({ organizationId: "org", deletedAt: null, status: "ACTIVE" })) return [];
        return [
          { id: "mona", firstName: "Mona", lastName: "M", email: null, accessLevel: "MANAGER", managerId: null },
          { id: "sam", firstName: "Sam", lastName: "A", email: null, accessLevel: "AGENT", managerId: "mona" },
          { id: "ida", firstName: "Ida", lastName: "I", email: null, accessLevel: "EMPLOYEE", managerId: "sam" },
          { id: "dee", firstName: "Dee", lastName: "D", email: null, accessLevel: "EMPLOYEE", managerId: null },
        ];
      },
    },
    organizationMembership: {
      findMany: async (a: { where: unknown }) => {
        st.asked.members.push(a.where);
        return JSON.stringify(a.where) === JSON.stringify(st.memberWhere) ? st.members : [];
      },
    },
    // This workspace's dotted lines (workspaceDottedLines): answered only for a statement that names this workspace in both halves.
    $queryRaw: async (strings: TemplateStringsArray, ...parts: unknown[]) => {
      const q = Prisma.sql(strings, ...(parts as Parameters<typeof Prisma.sql>[1][]));
      const [sql, values] = [q.sql, q.values];
      st.asked.dotted.push({ sql, values });
      const named = (sql.match(/d\."organizationId" = \?/g) ?? []).length === 2;
      return named && values.length > 0 && values.every((v) => v === "org") ? [{ userId: "dee", managerId: "sam" }] : [];
    },
    // The cross-workspace dotted read of before: nothing.
    userDottedLine: { findMany: async () => [] },
  } };
});
vi.mock("./facts", () => ({ loadOrgFacts: async () => ({ peopleTeamIds: [] }) }));
vi.mock("./flags", () => ({ accessV2Tables: () => false }));

import { loadImpactPeople } from "./app-floor-impact.server";
import { membershipHereWhere } from "./seated-here";

beforeEach(() => {
  st.members = [];
  st.memberWhere = membershipHereWhere("org", "active");
  st.asked = { users: [], members: [], dotted: [] };
});

describe("loadImpactPeople", () => {
  it("never counts an Agent as having reports, and still counts the manager above them", async () => {
    const people = new Map((await loadImpactPeople("org")).map((p) => [p.id, p.hasReports]));
    expect(people.get("sam")).toBe(false);
    expect(people.get("mona")).toBe(true);
    expect(people.get("ida")).toBe(false);
  });
});

describe("loadImpactPeople reads this workspace's lines (docs/plans/workspace-status-2.md step 2)", () => {
  it("counts a manager here by the line a membership holds, at the level it holds here", async () => {
    // Pia works here through a membership and reports to Dee here. Before:
    // the people anchored here alone, so Dee "had no reports" and lost the
    // manager floor here.
    st.members = [{ userId: "pia", role: "EMPLOYEE", managerId: "dee" }];
    expect(new Map((await loadImpactPeople("org")).map((p) => [p.id, p.hasReports])).get("dee")).toBe(true);
    // A membership's line to an Agent here counts for nobody, as an account's does.
    st.members = [{ userId: "pia", role: "EMPLOYEE", managerId: "sam" }];
    expect(new Map((await loadImpactPeople("org")).map((p) => [p.id, p.hasReports])).get("sam")).toBe(false);
  });

  it("asks for active seats here and this workspace's dotted lines, nothing wider", async () => {
    await loadImpactPeople("org");
    // A kept seat (a deactivated membership) or another workspace's lines would be a wider read.
    expect(st.asked.members).toEqual([membershipHereWhere("org", "active")]);
    expect(st.asked.users).toEqual([{ organizationId: "org", deletedAt: null, status: "ACTIVE" }]);
    expect(st.asked.dotted).toHaveLength(1);
    expect(st.asked.dotted[0].sql).toContain('JOIN "UserDottedLine" d');
    expect(st.asked.dotted[0].values.length).toBeGreaterThan(0);
    expect(st.asked.dotted[0].values.every((v) => v === "org")).toBe(true);
  });
});
