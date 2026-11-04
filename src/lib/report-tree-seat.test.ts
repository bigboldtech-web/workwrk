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
//
// THE LINE HERE (docs/plans/workspace-status-2.md E1, step 2). Each step
// down reads this workspace's lines: the recursive name joined to a LATERAL
// subquery of two halves, the people anchored here by their account's line
// and the people here through a membership by the membership's line, never
// the account's line of someone anchored elsewhere. The double asserts both
// halves and walks the seeded rows by them. Pat is anchored at A under Max
// and works at B under Dana; Max contracts for B.

import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; organizationId: string; managerId: string | null; deletedAt: Date | null };
type M = { userId: string; organizationId: string; status: string; removedAt: Date | null; managerId: string | null };

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
        const { root } = halves(sql);
        // The step down, with t."id" and u."id" read as t.id and u.id (the two walks quote them differently).
        const below = halves(sql).below.replace(/t\."id"/g, "t.id").replace(/u\."id"/g, "u.id");
        // The clauses, asserted (see the header), then read as Postgres would.
        needs(root, `m."organizationId" = ? AND ${LIVE}`, "root's membership seat");
        needs(root, `"deletedAt" IS NULL`, "root's account");
        // One reference to the recursive name, joined to the two halves (THE LINE HERE).
        needs(below, "CROSS JOIN LATERAL (", "reports' step");
        needs(below, `u."managerId" = t.id AND u."organizationId" = ? AND u."deletedAt" IS NULL`, "anchored half");
        needs(below, `m."managerId" = t.id AND m."organizationId" = ? AND m."removedAt" IS NULL AND u."organizationId" <> ? AND u."deletedAt" IS NULL`, "membership half");
        if (below.includes(`m."status"`)) throw new Error("report-tree double: the reports' seat reads a status");
        if (/JOIN (team|tree) t ON u\."managerId"/.test(below)) throw new Error("report-tree double: the step joins the account's line");
        const [rootId, org] = [q.values[0] as string, q.values[1] as string];
        // Each value bound into the statement, by the text before its
        // placeholder (the step 2 review L4): every workspace placeholder,
        // both halves included, holds the walk's workspace; every id
        // placeholder its root; the depth cap a number. Any other is refused.
        const parts = sql.split("?");
        for (let i = 0; i < parts.length - 1; i += 1) {
          const before = parts[i].trimEnd();
          const v = q.values[i];
          const what = /"organizationId" (=|<>)$/.test(before) ? "workspace" : /(\bid|"id"|"userId") =$/.test(before) ? "root" : /depth <$/.test(before) ? "depth" : null;
          if (what === null) throw new Error(`report-tree double: a value bound after "${before.slice(-40)}"`);
          if (what === "workspace" && v !== org) throw new Error(`report-tree double: placeholder ${i + 1} binds ${String(v)} where the workspace belongs`);
          if (what === "root" && v !== rootId) throw new Error(`report-tree double: placeholder ${i + 1} binds ${String(v)} where the root belongs`);
          if (what === "depth" && typeof v !== "number") throw new Error(`report-tree double: placeholder ${i + 1} binds ${String(v)} as the depth`);
        }
        const rootSeat = (u: U) =>
          u.organizationId === org || st.memberships.some((m) => m.userId === u.id && m.organizationId === org && m.removedAt == null && m.status !== "INACTIVE");
        // Who reports to `id` HERE: anchored here by the account's line, or here through a kept membership by its line.
        const reportsHere = (id: string) =>
          st.users.filter((u) => !u.deletedAt && (u.organizationId === org
            ? u.managerId === id
            : st.memberships.some((m) => m.userId === u.id && m.organizationId === org && m.removedAt == null && m.managerId === id)));
        const r = st.users.find((u) => u.id === rootId);
        if (!r || r.deletedAt || !rootSeat(r)) return [];
        const out = [{ id: rootId, depth: 0 }];
        for (let i = 0; i < out.length; i += 1) {
          for (const u of reportsHere(out[i].id)) if (!out.some((o) => o.id === u.id)) out.push({ id: u.id, depth: out[i].depth + 1 });
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
const member = (userId: string, organizationId: string, status = "ACTIVE", removedAt: Date | null = null, managerId: string | null = null) =>
  st.memberships.push({ userId, organizationId, status, removedAt, managerId });
const seatOf = (userId: string) => st.memberships.find((m) => m.userId === userId)!;

beforeEach(() => {
  st.sql = [];
  st.users = [];
  st.memberships = [];
  // Max manages in B through a membership; his account is anchored in A.
  user("max", "a");
  member("max", "b");
  // His reports in B: Ann and Ted anchored in B, Rae and Sol in B through
  // memberships whose line names him (E1). Their accounts' lines are A's:
  // Zed leads them there.
  user("zed", "a");
  user("ann", "b", "max");
  user("ted", "b", "max");
  user("rae", "a", "zed");
  member("rae", "b", "ACTIVE", null, "max");
  user("sol", "a", "zed");
  member("sol", "b", "ACTIVE", null, "max");
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

// Pat is anchored at A under Max and works at B under Dana (her membership's
// line); Max contracts for B. Each walk gives B's tree in B and A's in A.
describe("the report-tree walks read this workspace's line (workspace-status-2 E1, step 2)", () => {
  beforeEach(() => {
    st.users = [];
    st.memberships = [];
    user("max", "a");
    member("max", "b");
    user("dana", "b");
    user("pat", "a", "max");
    member("pat", "b", "ACTIVE", null, "dana");
    user("ann", "b", "dana");
  });

  for (const [name, walk] of [
    ["team.ts getTeamUserIds", (org: string, root: string) => getTeamUserIds(org, root, { rootIsAgent: false })],
    ["reporting-line.ts getSolidReportTree", (org: string, root: string) => getSolidReportTree(root, { organizationId: org, rootIsAgent: false })],
    ["reporting-line.ts getEffectiveReportTree", (org: string, root: string) => getEffectiveReportTree(root, { organizationId: org, rootIsAgent: false })],
  ] as const) {
    it(`${name}: Dana's tree in B holds Pat by her membership's line; Max's in B does not, his in A does`, async () => {
      // Before: the step joined every account line, so Pat was in Max's tree in B and not in Dana's.
      expect((await walk("b", "dana")).sort()).toEqual(["ann", "dana", "pat"]);
      expect((await walk("b", "max")).sort()).toEqual(["max"]);
      expect((await walk("a", "max")).sort()).toEqual(["max", "pat"]);
    });

    it(`${name}: a manager whose seat here ended leads nobody here, and a report removed here leaves the tree`, async () => {
      // Rae reports to Max in B, by her membership's line.
      user("rae", "a");
      member("rae", "b", "ACTIVE", null, "max");
      expect((await walk("b", "max")).sort()).toEqual(["max", "rae"]);
      // B deactivates Max through his membership: in B he leads nobody.
      seatOf("max").status = "INACTIVE";
      expect(await walk("b", "max")).toEqual([]);
      // Pat removed in B: out of Dana's tree there, still in Max's in A.
      st.memberships.find((m) => m.userId === "pat" && m.organizationId === "b")!.removedAt = new Date("2026-10-01");
      expect((await walk("b", "dana")).sort()).toEqual(["ann", "dana"]);
      expect((await walk("a", "max")).sort()).toEqual(["max", "pat"]);
    });
  }

  it("the double refuses a statement that binds anything but the walk's workspace into a half (the step 2 review L4)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const raw = (prisma as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw;
    // team.ts's statement, with the membership half's workspace bound to the root, then to another workspace.
    const walk = (memberOrg: string, notHere: string) =>
      raw`WITH RECURSIVE team AS (SELECT id FROM "User" WHERE id = ${"dana"} AND "deletedAt" IS NULL AND ("organizationId" = ${"b"} OR EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = ${"dana"} AND m."organizationId" = ${"b"} AND (m."status" <> 'INACTIVE' AND m."removedAt" IS NULL))) UNION SELECT r.id FROM team t CROSS JOIN LATERAL (SELECT u.id FROM "User" u WHERE u."managerId" = t.id AND u."organizationId" = ${"b"} AND u."deletedAt" IS NULL UNION ALL SELECT m."userId" AS id FROM "OrganizationMembership" m JOIN "User" u ON u.id = m."userId" WHERE m."managerId" = t.id AND m."organizationId" = ${memberOrg} AND m."removedAt" IS NULL AND u."organizationId" <> ${notHere} AND u."deletedAt" IS NULL) r) SELECT id FROM team`;
    await expect(walk("dana", "b")).rejects.toThrow(/binds dana where the workspace belongs/);
    await expect(walk("b", "a")).rejects.toThrow(/binds a where the workspace belongs/);
    expect(((await walk("b", "b")) as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(["ann", "dana", "pat"]);
  });

  it("the double refuses a step that joins the account's line, so a passing walk reads the line here", async () => {
    const { prisma } = await import("@/lib/prisma");
    const raw = (prisma as unknown as { $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).$queryRaw;
    // Step 1's statement: the root as it is, the step joining every account's line.
    await expect(
      raw`WITH RECURSIVE team AS (SELECT id FROM "User" WHERE "deletedAt" IS NULL AND m."organizationId" = ${"b"} AND (m."status" <> 'INACTIVE' AND m."removedAt" IS NULL) UNION SELECT u.id FROM "User" u INNER JOIN team t ON u."managerId" = t.id WHERE u."deletedAt" IS NULL AND m."organizationId" = ${"b"} AND m."removedAt" IS NULL)`,
    ).rejects.toThrow(/reports' step/);
  });
});
