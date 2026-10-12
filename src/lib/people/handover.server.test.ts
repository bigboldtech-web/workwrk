// The handover (runHandover) and its preview for the transfer dialog
// (previewReportHandover). Docs-found fixes batch 2: an Agent is never
// anyone's manager (access 2.4), so an Agent recipient takes the work as
// asked, while the reports go up to the leaver's own manager; before, they
// went to the Agent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  levels: {} as Record<string, string>,
  names: {} as Record<string, string>,
  managers: new Map<string, string | null>(),
  inactive: new Set<string>(),
  userWrites: [] as Array<{ ids: string[]; managerId: string | null }>,
  ownerWrites: [] as string[],
  dottedRemoved: [] as string[][],
  dottedTo: {} as Record<string, string[]>,
  order: [] as string[],
  anchoredElsewhere: new Set<string>(),
  userReads: [] as Array<Record<string, unknown>>,
  itemReads: [] as Array<Record<string, unknown>>,
  items: [] as Array<{ id: string; status: string | null; assigneeIds: string[] }>,
  busy: false,
}));

vi.mock("@/lib/prisma", () => {
  // The workspace, in memory: st.managers is everyone not removed (id to
  // stored manager), anchored in "org" unless st.anchoredElsewhere says so.
  type W = { id?: string | { in: string[] }; managerId?: string; organizationId?: string; deletedAt?: null };
  const row = (id: string) => ({
    id,
    managerId: st.managers.get(id) ?? null,
    organizationId: st.anchoredElsewhere.has(id) ? "client" : "org",
    status: st.inactive.has(id) ? "INACTIVE" : "ACTIVE",
    firstName: st.names[id] ?? id,
    lastName: "",
    ...legacyLevelRow(st.levels[id] ?? "EMPLOYEE"),
  });
  const pick = (w: W) => {
    st.userReads.push(w);
    return [...st.managers.keys()]
      .filter((id) => w.id === undefined || (typeof w.id === "string" ? id === w.id : w.id.in.includes(id)))
      .filter((id) => w.managerId === undefined || st.managers.get(id) === w.managerId)
      .filter((id) => w.organizationId === undefined || row(id).organizationId === w.organizationId)
      .map(row);
  };
  const user = {
    findMany: async (a: { where: W }) => pick(a.where),
    findUnique: async (a: { where: { id: string } }) => (st.managers.has(a.where.id) ? row(a.where.id) : null),
    updateMany: async (a: { where: { id: { in: string[] } }; data: { managerId: string | null } }) => {
      st.order.push("write");
      st.userWrites.push({ ids: a.where.id.in, managerId: a.data.managerId });
      return { count: a.where.id.in.length };
    },
  };
  const owned = (kind: string) => ({ updateMany: async (a: { data: { ownerId: string } }) => { st.order.push(kind); st.ownerWrites.push(a.data.ownerId); return { count: 1 }; } });
  const userDottedLine = {
    findMany: async (a: { where: { managerId: string } }) => (st.dottedTo[a.where.managerId] ?? []).map((userId) => ({ userId })),
    deleteMany: async (a: { where: { userId: { in: string[] } } }) => { st.dottedRemoved.push(a.where.userId.in); return { count: a.where.userId.in.length }; },
  };
  const item = {
    findMany: async (a: { where: Record<string, unknown> }) => { st.itemReads.push(a.where); return st.items; },
    updateMany: async () => { st.order.push("item"); return { count: 1 }; },
  };
  const organizationMembership = { findMany: async () => [], findUnique: async () => null };
  const db = { user, item, space: owned("space"), folder: owned("folder"), board: owned("list"), userDottedLine, organizationMembership };
  return {
    prisma: {
      ...db,
      $transaction: async (arg: unknown) => {
        if (typeof arg !== "function") return Promise.all(arg as unknown[]);
        st.order.push("begin");
        const out = await (arg as (tx: unknown) => Promise<unknown>)(db);
        st.order.push("commit");
        return out;
      },
    },
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/people/person-access.server", () => ({ managerMapFor: async () => new Map(st.managers) }));
// The tier held in the workspace (manager-lines.ts managesNobody).
vi.mock("@/lib/access/manager-lines", async (orig) => ({
  // The real line-facts walk, over the prisma double above.
  lineFactsAround: (await orig<typeof import("@/lib/access/manager-lines")>()).lineFactsAround,
  managesNobody: async (id: string) => st.levels[id] === "AGENT",
  // What batch 3's handover read instead (every person of the workspace), so
  // the earlier tests answer the same on both: who manages whom, who is an
  // Agent, who is deactivated.
  // Like the real one, only people anchored here.
  lineMapFor: async () =>
    new Map([...st.managers].filter(([id]) => !st.anchoredElsewhere.has(id)).map(([id, managerId]) => [id, { managerId, agent: st.levels[id] === "AGENT", inactive: st.inactive.has(id) }])),
}));
vi.mock("@/lib/access/membership", () => ({
  lockOrgRoles: async () => {
    st.order.push("lock");
    if (st.busy) throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
  },
  unattendedRecipient: async () => null,
  wouldRemoveLastOwner: async () => false,
}));
vi.mock("@/lib/performance/review-cycle.server", () => ({ followReportingLine: async () => undefined }));

import { moveAgentReports, pendingHandover, previewAgentReports, previewReportHandover, runHandover } from "./handover.server";

beforeEach(() => {
  // boss > leaver > r1, r2; sam is on the Agent tier.
  st.managers = new Map([["boss", null], ["leaver", "boss"], ["r1", "leaver"], ["r2", "leaver"], ["sam", "boss"]]);
  st.levels = { boss: "DIRECTOR", leaver: "MANAGER", sam: "AGENT", rae: "MANAGER" };
  st.names = { boss: "Dana Lee", sam: "Sam Agent" };
  st.managers.set("rae", "boss");
  st.userWrites = [];
  st.ownerWrites = [];
  st.inactive = new Set();
  st.dottedRemoved = [];
  st.dottedTo = {};
  st.order = [];
  st.anchoredElsewhere = new Set();
  st.userReads = [];
  st.itemReads = [];
  st.items = [{ id: "t1", status: "To do", assigneeIds: ["leaver"] }];
  st.busy = false;
});

describe("runHandover to an Agent", () => {
  it("sends the work to the Agent but the reports to the leaver's own manager", async () => {
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    // Spaces, Folders and Lists go to the Agent, as asked.
    expect(st.ownerWrites).toEqual(["sam", "sam", "sam"]);
    // No report is ever written under the Agent.
    expect(st.userWrites.some((w) => w.managerId === "sam" && w.ids.length > 0)).toBe(false);
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "boss" });
    expect(r.reportsRehomed.map((x) => [x.id, x.managerId])).toEqual([["r1", "boss"], ["r2", "boss"]]);
  });

  it("still gives the reports to a recipient who may manage", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "rae" });
  });

  it("never sends the reports up to a manager who is an Agent", async () => {
    st.levels.boss = "AGENT";
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: null });
    expect(st.userWrites.some((w) => w.managerId === "boss")).toBe(false);
  });
});

describe("runHandover, docs-found fixes batch 3", () => {
  it("reads the report plan and writes under the workspace's role lock (rule 6's race)", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    const lines = st.order.slice(0, st.order.indexOf("commit"));
    expect(lines[0]).toBe("begin");
    expect(lines[1]).toBe("lock");
    expect(lines.slice(2).every((x) => x === "write")).toBe(true);
  });

  it("walks up past a deactivated manager to the first one who can manage them", async () => {
    // big > boss (deactivated) > leaver > r1, r2. The reports used to land
    // on boss, who cannot sign in and holds no reports (invariant 13).
    st.managers.set("big", null);
    st.managers.set("boss", "big");
    st.levels.big = "VP";
    st.names.big = "Big Boss";
    st.inactive.add("boss");
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "big" });
    expect(r.reportsRehomed.map((x) => x.managerName)).toEqual(["Big Boss", "Big Boss"]);
  });

  it("walks up past an Agent too, to the live manager above", async () => {
    // big > boss (an Agent made before rule 6) > leaver > r1, r2. The reports
    // used to go to no manager although big can manage them.
    st.managers.set("big", null);
    st.managers.set("boss", "big");
    st.levels.big = "VP";
    st.levels.boss = "AGENT";
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "big" });
  });

  it("gives up at a removed manager past an Agent, and never lands on them", async () => {
    st.managers.set("boss", "gone"); // gone was removed: not in the lines
    st.levels.boss = "AGENT";
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: null });
  });
});

describe("moving an Agent's stored reports off them", () => {
  beforeEach(() => {
    // boss > sam (Agent) > a1, a2, listed before rule 6; d1 has a dotted line to sam.
    st.managers.set("a1", "sam");
    st.managers.set("a2", "sam");
    st.dottedTo = { sam: ["d1"] };
  });

  it("previews where the direct reports go, by name, and the dotted lines", async () => {
    expect(await previewAgentReports("org", "sam")).toEqual({ agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }] });
    expect(await previewAgentReports("org", "rae")).toEqual({ agent: false, solid: 0, dotted: 0, rehomed: [] });
  });

  it("moves them up the line under the role lock and takes the dotted lines off", async () => {
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin" });
    expect(st.order.slice(0, 2)).toEqual(["begin", "lock"]);
    expect(st.userWrites).toEqual([{ ids: ["a1", "a2"], managerId: "boss" }]);
    expect(st.dottedRemoved).toEqual([["d1"]]);
    expect(r).toEqual({ moved: 2, dottedRemoved: 1, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }] });
  });

  it("moves nothing for someone who is no Agent", async () => {
    expect(await moveAgentReports({ organizationId: "org", agentId: "rae", actorId: "admin" })).toBeNull();
    expect(st.userWrites).toEqual([]);
  });
});

describe("previewReportHandover", () => {
  it("tells the dialog exactly what the run will do, by name", async () => {
    expect(await previewReportHandover("org", "leaver", "sam")).toEqual({ reports: 2, toRecipient: 0, recipientIsAgent: true, rehomed: [{ to: "Dana Lee", count: 2 }] });
    expect(await previewReportHandover("org", "leaver", "rae")).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [] });
  });
});

// Docs-found fixes batch 4: the role lock is held for the reporting lines
// only. It used to be held across the whole run (every open task, every
// container) while every Reports to edit, invitation acceptance with a
// manager and role change in the workspace waited behind it.
describe("runHandover holds the role lock only for the lines", () => {
  it("writes the lines in a locked transaction, then the containers and the tasks in their own, unlocked", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    const firstCommit = st.order.indexOf("commit");
    // The locked half: the lock, then the managerId write, and nothing else.
    expect(st.order.slice(0, firstCommit)).toEqual(["begin", "lock", "write"]);
    // The work: its own transaction, no lock, containers before tasks (the
    // order a Space delete locks them), so the two never deadlock.
    const work = st.order.slice(firstCommit + 1);
    expect(work).toEqual(["begin", "space", "folder", "list", "item", "item", "commit"]);
    expect(work).not.toContain("lock");
  });

  it("reads only the leaver's line facts under the lock, never the whole workspace", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userReads.length).toBeGreaterThan(0);
    for (const w of st.userReads) expect(w.id !== undefined || w.managerId !== undefined, JSON.stringify(w)).toBe(true);
  });

  it("stops before anything is written when the role lock is busy", async () => {
    st.busy = true;
    await expect(runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" })).rejects.toMatchObject({ name: "OrgRolesBusy" });
    expect(st.userWrites).toEqual([]);
    expect(st.ownerWrites).toEqual([]);
    expect(st.order).not.toContain("item");
  });

  it("never hands over or counts a meeting's hidden Item as a task", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.itemReads[0]).toMatchObject({ itemType: { notIn: ["meeting"] } });
    st.itemReads = [];
    const counts = await pendingHandover("org", "leaver").catch(() => null);
    void counts;
    expect(st.itemReads[0]).toMatchObject({ itemType: { notIn: ["meeting"] } });
  });

  it("never gives the reports to a deactivated recipient: they go up the line", async () => {
    st.inactive.add("rae");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites.some((w) => w.managerId === "rae" && w.ids.length > 0)).toBe(false);
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "boss" });
  });
});

describe("moving an Agent's reports checks the plan the drawer showed", () => {
  beforeEach(() => {
    st.managers.set("a1", "sam");
    st.managers.set("a2", "sam");
  });

  it("moves nothing when the plan under the lock is not the one shown", async () => {
    const shown = { solid: 2, dotted: 0, rehomed: [{ to: "Rae", toId: "rae", count: 2 }] };
    expect(await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin", expect: shown })).toEqual({ changed: true });
    expect(st.userWrites).toEqual([]);
  });

  it("moves them when it is", async () => {
    const shown = { solid: 2, dotted: 0, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }] };
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin", expect: shown });
    expect(r).toMatchObject({ moved: 2 });
    expect(st.userWrites).toEqual([{ ids: ["a1", "a2"], managerId: "boss" }]);
  });

  it("finds an Agent who works here through a membership, at the tier held here", async () => {
    st.anchoredElsewhere.add("sam");
    expect(await previewAgentReports("org", "sam")).toMatchObject({ agent: true, solid: 2 });
  });
});
