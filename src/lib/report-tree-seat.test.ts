// The report-tree walks read this workspace's seat (docs/plans/workspace-status.md
// D12): team.ts getTeamUserIds and reporting-line.ts's solid walk grant reach,
// so their root, when they work here through a membership, has a tree only
// while that seat is LIVE; the people below are kept as people anchored here
// are kept (not removed, a deactivated one stays), so a membership report
// counts while their seat here is not removed. Before, any membership row
// counted for both.
//
// Each walk is one recursive statement, and no database runs in these tests
// (the rules forbid running SQL; the live proof runs them on Postgres). So,
// as connector-test-db.ts does, the double first ASSERTS the clauses that
// carry the statement's meaning (the root's live seat, the reports' kept
// one) and only then walks the seeded rows by them (the step 4 review T3):
// a statement that lost a clause throws, and the behaviour below is what a
// statement holding them answers.

import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; organizationId: string; managerId: string | null; deletedAt: Date | null };
type M = { userId: string; organizationId: string; status: string; removedAt: Date | null };

const st = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; values: unknown[] }>, users: [] as U[], memberships: [] as M[] }));

vi.mock("@/lib/prisma", async () => {
  const { Prisma } = await import("@/generated/prisma");
  const LIVE = `(m."status" <> 'INACTIVE' AND m."removedAt" IS NULL)`;
  const halves = (sql: string) => {
    const at = sql.indexOf("UNION");
    return { root: sql.slice(0, at), below: sql.slice(at) };
  };
  /** Throws unless the statement holds the clause. */
  const needs = (part: string, clause: string, what: string) => {
    if (!part.includes(clause)) throw new Error(`report-tree double: the ${what} lacks ${clause}`);
  };
  return {
    prisma: {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = Prisma.sql(strings, ...values);
        const sql = q.sql.replace(/\s+/g, " ").trim();
        st.sql.push({ sql, values: q.values });
        if (!/^WITH RECURSIVE (team|tree) AS/.test(sql)) throw new Error(`report-tree double: unknown statement ${sql}`);
        const { root, below } = halves(sql);
        // The clauses, asserted (see the header), then read as Postgres would.
        needs(root, `m."organizationId" = ? AND ${LIVE}`, "root's membership seat");
        needs(below, `m."organizationId" = ? AND m."removedAt" IS NULL`, "reports' membership seat");
        if (below.includes(`m."status"`)) throw new Error("report-tree double: the reports' seat reads a status");
        needs(root, `"deletedAt" IS NULL`, "root's account");
        needs(below, `u."deletedAt" IS NULL`, "reports' account");
        const [rootId, org] = [q.values[0] as string, q.values[1] as string];
        const seat = (u: U, live: boolean) =>
          u.organizationId === org || st.memberships.some((m) => m.userId === u.id && m.organizationId === org && m.removedAt == null && (!live || m.status !== "INACTIVE"));
        const r = st.users.find((u) => u.id === rootId);
        if (!r || r.deletedAt || !seat(r, true)) return [];
        const out = [{ id: rootId, depth: 0 }];
        for (let i = 0; i < out.length; i += 1) {
          for (const u of st.users) {
            if (u.managerId === out[i].id && !u.deletedAt && !out.some((o) => o.id === u.id) && seat(u, false)) out.push({ id: u.id, depth: out[i].depth + 1 });
          }
        }
        return out;
      },
      userDottedLine: { findMany: async () => [] },
    },
  };
});
vi.mock("@/lib/access/manager-lines", () => ({
  managesNobody: async () => false,
  effectiveDirectReportIds: async () => [],
  liveHereAmong: async () => new Set<string>(),
}));

import { getTeamUserIds } from "./team";
import { getEffectiveReportTree, getSolidReportTree } from "./reporting-line";

const user = (id: string, organizationId: string, managerId: string | null = null, deletedAt: Date | null = null) => st.users.push({ id, organizationId, managerId, deletedAt });
const member = (userId: string, organizationId: string, status = "ACTIVE", removedAt: Date | null = null) => st.memberships.push({ userId, organizationId, status, removedAt });
const seatOf = (userId: string) => st.memberships.find((m) => m.userId === userId)!;

beforeEach(() => {
  st.sql = [];
  st.users = [];
  st.memberships = [];
  // Max manages in B through a membership; his account is anchored in A.
  user("max", "a");
  member("max", "b");
  // His reports: Ann and Ted anchored in B, Rae and Sol in B through memberships.
  user("ann", "b", "max");
  user("ted", "b", "max");
  user("rae", "a", "max");
  member("rae", "b");
  user("sol", "a", "max");
  member("sol", "b");
});

const walks = [
  ["team.ts getTeamUserIds", () => getTeamUserIds("b", "max", { rootIsAgent: false })],
  ["reporting-line.ts getSolidReportTree", () => getSolidReportTree("max", { organizationId: "b", rootIsAgent: false })],
] as const;

describe("the report-tree walks read the seat here (D12)", () => {
  for (const [name, walk] of walks) {
    it(`${name}: a root deactivated here through a membership has no tree here`, async () => {
      expect((await walk()).sort()).toEqual(["ann", "max", "rae", "sol", "ted"]);
      seatOf("max").status = "INACTIVE";
      // Before: Max's tree here, his account being live in A.
      expect(await walk()).toEqual([]);
    });

    it(`${name}: a report deactivated here stays in the tree, one removed here leaves it`, async () => {
      seatOf("rae").status = "INACTIVE";
      seatOf("sol").removedAt = new Date("2026-10-01");
      // Before: Sol stayed, any membership row counting.
      expect((await walk()).sort()).toEqual(["ann", "max", "rae", "ted"]);
    });
  }

  it("the effective tree reads the same solid walk", async () => {
    seatOf("sol").removedAt = new Date("2026-10-01");
    expect((await getEffectiveReportTree("max", { organizationId: "b", rootIsAgent: false })).sort()).toEqual(["ann", "max", "rae", "ted"]);
  });

  it("the double refuses a statement that lost the root's live seat, so a passing walk holds the clauses", async () => {
    const { prisma } = await import("@/lib/prisma");
    const raw = (prisma as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw;
    await expect(raw`WITH RECURSIVE team AS (SELECT 1 WHERE m."organizationId" = ${"b"} UNION SELECT 1 WHERE m."organizationId" = ${"b"} AND m."removedAt" IS NULL)`).rejects.toThrow(/root's membership seat/);
  });
});
