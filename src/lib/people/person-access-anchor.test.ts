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
    findMany: async (a: { where: W }) => users().filter((u) => ok(u, a.where)),
    findUnique: async (a: { where: { id: string } }) => st.users.get(a.where.id) ?? null,
  };
  const organizationMembership = {
    findUnique: async (a: { where: { userId_organizationId: { userId: string; organizationId: string } } }) =>
      st.memberships.find((m) => m.userId === a.where.userId_organizationId.userId && m.organizationId === a.where.userId_organizationId.organizationId) ?? null,
    findMany: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
      st.memberships.filter((m) => m.organizationId === a.where.organizationId && a.where.userId.in.includes(m.userId)),
  };
  const userDottedLine = { findMany: async (a: { where: { userId: string } }) => st.dotted.filter((d) => d.userId === a.where.userId) };
  return { prisma: { user, organizationMembership, userDottedLine } };
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
    expect(stale.dotted).toEqual([
      { managerId: "ava", name: "ava Ray", why: "agent" },
      { managerId: "fay", name: "fay Ray", why: "removed" },
    ]);
    expect(staleLineWords(stale.dotted[1])).toBe("fay Ray is no longer in the workspace");
  });
});
