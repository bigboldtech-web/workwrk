// "Is this person in this workspace" for reporting lines (docs-found fixes
// batch 5, the batch 4 review). User.organizationId is only the workspace a
// person last switched to (reanchorUser), on any device; the level they hold
// here is what counts (acting-workspace.ts levelHeldIn: anchored here, or a
// membership here). These reads took the anchored row alone, so a manager
// who switched to a client workspace was "not in this workspace" for every
// Reports to, a dotted line to them was cleared on a restore as "no longer
// in the workspace", and a loop through them was never seen.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

type U = { id: string; organizationId: string; managerId: string | null; accessLevel: string; status: string; deletedAt: Date | null; firstName: string; lastName: string };
const st = vi.hoisted(() => ({
  users: new Map<string, U>(),
  memberships: [] as Array<{ userId: string; organizationId: string; role: string }>,
  dotted: [] as Array<{ userId: string; managerId: string }>,
  /** Every user.findMany where, to see which reads narrow by an index (batch 6). */
  reads: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));
vi.mock("@/lib/team", () => ({ getTeamUserIds: async () => [] }));
vi.mock("@/lib/prisma", () => {
  type W = Record<string, unknown>;
  const held = (u: U, org: string) => u.organizationId === org || st.memberships.some((m) => m.userId === u.id && m.organizationId === org);
  const ok = (u: U, w: W): boolean => {
    if (typeof w.id === "string" && w.id !== u.id) return false;
    const idIn = (w.id as { in?: string[] } | undefined)?.in;
    if (idIn && !idIn.includes(u.id)) return false;
    if (typeof w.organizationId === "string" && u.organizationId !== w.organizationId) return false;
    if ("deletedAt" in w && w.deletedAt === null && u.deletedAt) return false;
    if (Array.isArray(w.OR)) {
      // { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] }
      const org = (w.OR[0] as { organizationId: string }).organizationId;
      if (!held(u, org)) return false;
    }
    return true;
  };
  const users = () => [...st.users.values()];
  const user = {
    findFirst: async (a: { where: W }) => users().find((u) => ok(u, a.where)) ?? null,
    findMany: async (a: { where: W }) => { st.reads.push(a.where); return users().filter((u) => ok(u, a.where)); },
    findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
  };
  type OrgWhere = string | { not?: string; in?: string[] };
  const orgOk = (w: OrgWhere, org: string) => (typeof w === "string" ? w === org : (w.not === undefined || w.not !== org) && (w.in === undefined || w.in.includes(org)));
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
      st.memberships.find((m) => m.userId === a.where.userId_organizationId.userId && m.organizationId === a.where.userId_organizationId.organizationId) ?? null,
    findMany: async (a: { where: { organizationId: OrgWhere; userId: { in: string[] } } }) =>
      st.memberships.filter((m) => orgOk(a.where.organizationId, m.organizationId) && a.where.userId.in.includes(m.userId)),
  };
  const userDottedLine = { findMany: async (a: { where: { userId: string } }) => st.dotted.filter((d) => d.userId === a.where.userId) };
  // workspacePeopleLines (batch 6): the people who hold a level in the
  // workspace, as the statement's two halves answer them.
  const $queryRaw = async (sql: TemplateStringsArray, ...values: unknown[]) => {
    const text = sql.join("?");
    if (!text.includes('FROM "OrganizationMembership" m')) throw new Error(`unexpected SQL: ${text}`);
    const org = values[0] as string;
    return users()
      .filter((u) => !u.deletedAt && held(u, org) && (!text.includes("'INACTIVE'") || u.status !== "INACTIVE"))
      .map((u) => ({ id: u.id, managerId: u.managerId }));
  };
  return { prisma: { user, organizationMembership, userDottedLine, $queryRaw } };
});

import { agentIdsAmong, checkManagerCandidate, managerMapFor } from "./person-access.server";
import { lineAbove, managerCandidateIn, staleLineWords, staleLinesOf, wouldLoopIn } from "@/lib/access/manager-candidate";

const ORG = "org";
const add = (id: string, managerId: string | null, level = "EMPLOYEE", extra: Partial<U> = {}) =>
  st.users.set(id, { id, organizationId: ORG, managerId, ...legacyLevelRow(level), status: "ACTIVE", deletedAt: null, firstName: id, lastName: "Ray", ...extra });

beforeEach(() => {
  st.users.clear();
  st.memberships = [];
  st.dotted = [];
  st.reads = [];
  add("mona", null, "MANAGER");
  add("max", "mona");
  // dana manages here and last switched to a client workspace, where she is a Member.
  add("dana", "mona", "EMPLOYEE", { organizationId: "client" });
  st.memberships.push({ userId: "dana", organizationId: ORG, role: "MANAGER" });
  // ava is an Agent here, a Manager where she is anchored.
  add("ava", null, "MANAGER", { organizationId: "client" });
  st.memberships.push({ userId: "ava", organizationId: ORG, role: "AGENT" });
  // fay is in the client workspace only.
  add("fay", null, "MANAGER", { organizationId: "client" });
});

describe("a manager who works here through a membership", () => {
  it("may be anyone's manager here, at the tier held here", async () => {
    // Before: "not_found" for dana, and "ok" for ava (her anchored level).
    expect(await managerCandidateIn(ORG, "dana")).toBe("ok");
    expect(await managerCandidateIn(ORG, "dana", { live: true })).toBe("ok");
    expect(await checkManagerCandidate(ORG, "dana")).toBe("ok");
    expect(await managerCandidateIn(ORG, "ava")).toBe("agent_cannot_manage");
    expect(await checkManagerCandidate(ORG, "ava")).toBe("agent_cannot_manage");
    expect(await managerCandidateIn(ORG, "fay")).toBe("not_found");
    expect(await checkManagerCandidate(ORG, "fay")).toBe("not_found");
  });

  it("counts as found for the dotted-lines check, and as an Agent there when she is one here", async () => {
    // Before: found 1 of 3 (mona), and no Agent among them.
    expect(await agentIdsAmong(ORG, ["mona", "dana", "ava"])).toEqual({ found: 3, agents: ["ava"] });
    expect(await agentIdsAmong(ORG, ["fay"])).toEqual({ found: 0, agents: [] });
  });

  it("is on the line a loop check walks", async () => {
    // max > dana > mona. Making mona report to max closes a loop through dana.
    st.users.get("dana")!.managerId = "max";
    st.users.get("mona")!.managerId = "dana";
    st.users.get("max")!.managerId = null;
    // Before: the walk up from mona stopped at dana (anchored elsewhere).
    expect([...(await lineAbove(ORG, "mona"))]).toEqual(["mona", "dana", "max"]);
    expect(await wouldLoopIn(ORG, "max", "mona")).toBe(true);
    expect((await managerMapFor(ORG)).get("dana")).toBe("max");
    expect((await managerMapFor(ORG)).has("fay")).toBe(false);
  });
});

describe("a restore's or a reactivation's line check", () => {
  it("keeps lines to someone who works here through a membership, and clears only what no longer holds", async () => {
    add("lee", "dana");
    st.dotted = [{ userId: "lee", managerId: "dana" }, { userId: "lee", managerId: "ava" }, { userId: "lee", managerId: "fay" }];
    const stale = await staleLinesOf(ORG, "lee");
    // Before: dana cleared as "removed" and logged "Dana Ray is no longer in the workspace".
    expect(stale.manager).toBeNull();
    // fay holds no level here, and lee works nowhere fay does: no workspace
    // reads that line. "No longer in the workspace" is for a removed account
    // only (batch 6): fay was never here. Nor is she named here (batch 7).
    expect(stale.dotted).toEqual([
      { managerId: "ava", name: "ava Ray", why: "agent" },
      { managerId: "fay", name: null, why: "elsewhere" },
    ]);
    expect(staleLineWords(stale.dotted[1])).toBe("the manager on their record doesn't work in this workspace");
  });
});

// Docs-found fixes batch 6, from the batch 5 review: a workspace clears only
// the lines it owns. P is anchored here and also works in the client
// workspace, where her manager and her dotted-line manager are.
describe("a restore or a reactivation keeps the lines another workspace relies on", () => {
  beforeEach(() => {
    add("pia", "fay");
    st.memberships.push({ userId: "pia", organizationId: "client", role: "EMPLOYEE" });
  });

  it("keeps a manager and a dotted manager who hold no level here but work with her in the other workspace", async () => {
    add("gil", null, "MANAGER", { organizationId: "client" });
    st.dotted = [{ userId: "pia", managerId: "gil" }];
    // Before: fay cleared as "removed" ("is no longer in the workspace") and
    // the dotted line to gil deleted, both the client workspace's.
    expect(await staleLinesOf(ORG, "pia")).toEqual({ manager: null, dotted: [] });
  });

  it("keeps a line to someone on the Agent tier here who manages her in the other workspace, and clears one the other workspace does not count", async () => {
    // ava is an Agent here and a Manager where she is anchored (client).
    st.users.get("pia")!.managerId = "ava";
    st.dotted = [{ userId: "pia", managerId: "ava" }];
    expect(await staleLinesOf(ORG, "pia")).toEqual({ manager: null, dotted: [] });
    // Once ava is an Agent there too, no workspace counts her as a manager.
    add("ava", null, "AGENT", { organizationId: "client" });
    const stale = await staleLinesOf(ORG, "pia");
    expect(stale.manager).toMatchObject({ managerId: "ava", why: "agent" });
    expect(stale.dotted).toEqual([{ managerId: "ava", name: "ava Ray", why: "agent" }]);
  });

  // Batch 7, from the batch 6 review: a removed or deactivated manager was
  // answered before whose line it was, so a line the other workspace had was
  // cleared with "fay Ray is no longer in the workspace", untrue (she was
  // never here) and telling this workspace who she is and her status.
  it("asks nothing about a manager who holds no level here: deactivated or removed, the line is cleared unnamed", async () => {
    st.users.get("fay")!.status = "INACTIVE";
    const off = await staleLinesOf(ORG, "pia");
    // Before: { why: "inactive", name: "fay Ray" }.
    expect(off.manager).toEqual({ managerId: "fay", name: null, why: "elsewhere" });
    expect(staleLineWords(off.manager!)).toBe("the manager on their record doesn't work in this workspace");
    st.users.get("fay")!.status = "ACTIVE";
    st.users.get("fay")!.deletedAt = new Date("2026-09-01");
    // Before: { why: "removed" }, "fay Ray is no longer in the workspace".
    expect((await staleLinesOf(ORG, "pia")).manager).toEqual({ managerId: "fay", name: null, why: "elsewhere" });
  });

  it("keeps the line while the other workspace relies on it, and still clears a removed or deactivated manager who works here, by name", async () => {
    // fay is live in the client workspace: the line is the client's.
    expect((await staleLinesOf(ORG, "pia")).manager).toBeNull();
    // dana works here through a membership.
    st.users.get("pia")!.managerId = "dana";
    st.users.get("dana")!.status = "INACTIVE";
    expect((await staleLinesOf(ORG, "pia")).manager).toEqual({ managerId: "dana", name: "dana Ray", why: "inactive" });
    st.users.get("dana")!.deletedAt = new Date("2026-09-01");
    const gone = await staleLinesOf(ORG, "pia");
    expect(gone.manager).toEqual({ managerId: "dana", name: "dana Ray", why: "removed" });
    expect(staleLineWords(gone.manager!)).toBe("dana Ray is no longer in the workspace");
  });

  it("clears a dotted line to someone who holds no level here and no workspace counts, unnamed", async () => {
    add("zed", null, "MANAGER", { organizationId: "other", status: "INACTIVE" });
    st.dotted = [{ userId: "pia", managerId: "zed" }];
    expect((await staleLinesOf(ORG, "pia")).dotted).toEqual([{ managerId: "zed", name: null, why: "elsewhere" }]);
  });
});

describe("whole-workspace reads use the indexed statement, never the OR alone", () => {
  it("managerMapFor reads everyone who works here through workspacePeopleLines", async () => {
    // Before: user.findMany with inWorkspaceWhere as the only filter, which
    // Postgres runs as a scan of every workspace's User rows.
    const map = await managerMapFor(ORG);
    expect([...map.keys()].sort()).toEqual(["ava", "dana", "max", "mona"]);
    expect(st.reads.filter((w) => Array.isArray(w.OR) && w.id === undefined && w.managerId === undefined)).toEqual([]);
  });
});
