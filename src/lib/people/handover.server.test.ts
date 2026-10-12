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
  /** Anchored elsewhere AND holding no membership here: not in this workspace at all. */
  foreign: new Set<string>(),
  userReads: [] as Array<Record<string, unknown>>,
  itemReads: [] as Array<Record<string, unknown>>,
  items: [] as Array<{ id: string; status: string | null; assigneeIds: string[] }>,
  /** What the WORK transaction's row lock reads, when a task changed after the plan (batch 5). */
  lockedItems: null as null | Array<{ id: string; ownerId: string | null; status: string | null; assigneeIds: string[]; archivedAt: Date | null }>,
  itemWrites: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  audit: [] as Array<Record<string, unknown>>,
  /** WORK fails (a timeout, a deadlock) after LINES committed. */
  workFails: false,
  /** followReportingLine's calls, and where in st.order each came. */
  followed: [] as Array<{ at: number; ids: string[] }>,
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
  const owned = (kind: string) => ({
    updateMany: async (a: { data: { ownerId: string } }) => { st.order.push(kind); st.ownerWrites.push(a.data.ownerId); return { count: 1 }; },
    count: async () => 0,
  });
  const userDottedLine = {
    findMany: async (a: { where: { managerId: string } }) => (st.dottedTo[a.where.managerId] ?? []).map((userId) => ({ userId })),
    deleteMany: async (a: { where: { userId: { in: string[] } } }) => { st.dottedRemoved.push(a.where.userId.in); return { count: a.where.userId.in.length }; },
  };
  // The tasks as the row lock reads them now: the plan's snapshot, unless a
  // test says a task changed in between.
  const lockedRows = () => st.lockedItems ?? st.items.map((it) => ({ ...it, ownerId: "leaver", archivedAt: null }));
  const item = {
    findMany: async (a: { where: Record<string, unknown> }) => { st.itemReads.push(a.where); return st.items.map((it) => ({ id: it.id })); },
    updateMany: async (a: { where: { id: { in: string[] }; ownerId?: string }; data: Record<string, unknown> }) => {
      st.order.push("item");
      st.itemWrites.push({ where: a.where as never, data: a.data });
      // As Postgres answers it: only rows that still match the where.
      const rows = lockedRows().filter((r) => a.where.id.in.includes(r.id) && (a.where.ownerId === undefined || r.ownerId === a.where.ownerId));
      return { count: rows.length };
    },
  };
  // Someone anchored elsewhere works here through a membership, at their
  // level, unless they are foreign to this workspace (batch 5).
  const heldHere = (id: string) => st.anchoredElsewhere.has(id) && !st.foreign.has(id) && st.managers.has(id);
  const organizationMembership = {
    findMany: async (a: { where: { organizationId: string; userId: { in: string[] } } }) =>
      a.where.userId.in.filter(heldHere).map((userId) => ({ userId, role: st.levels[userId] ?? "EMPLOYEE" })),
    findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) =>
      heldHere(a.where.userId_organizationId.userId) ? { role: st.levels[a.where.userId_organizationId.userId] ?? "EMPLOYEE" } : null,
  };
  const activityLog = {
    createMany: async (a: { data: Array<Record<string, unknown>> }) => { st.order.push("audit"); st.audit.push(...a.data); return { count: a.data.length }; },
  };
  const $queryRaw = async () => {
    st.order.push("item-lock");
    if (st.workFails) throw new Error("canceling statement due to statement timeout");
    return lockedRows();
  };
  const db = { user, item, space: owned("space"), folder: owned("folder"), board: owned("list"), userDottedLine, organizationMembership, activityLog, $queryRaw };
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
  // The real "who works here" read too (batch 5).
  liveHereAmong: (await orig<typeof import("@/lib/access/manager-lines")>()).liveHereAmong,
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
vi.mock("@/lib/performance/review-cycle.server", () => ({
  followReportingLine: async (_org: string, ids: string[]) => { st.followed.push({ at: st.order.length, ids }); },
}));

import { HandoverWorkFailed, handoverPartialWords, moveAgentReports, pendingHandover, previewAgentReports, previewReportHandover, runHandover } from "./handover.server";

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
  st.lockedItems = null;
  st.itemWrites = [];
  st.audit = [];
  st.workFails = false;
  st.foreign = new Set();
  st.followed = [];
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
    // The line writes, then (batch 5) their audit rows, in the same transaction.
    expect(lines.slice(2).every((x) => x === "write" || x === "audit")).toBe(true);
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
    st.managers.set("d1", "boss");
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
    // The locked half: the lock, then the managerId write and (batch 5) its
    // audit rows, and nothing else.
    expect(st.order.slice(0, firstCommit)).toEqual(["begin", "lock", "write", "audit"]);
    // The work: its own transaction, no lock, containers before tasks (the
    // order a Space delete locks them), so the two never deadlock. The tasks
    // are locked (batch 5), then written, owner and assignees in one write.
    const work = st.order.slice(firstCommit + 1);
    expect(work).toEqual(["begin", "space", "folder", "list", "item-lock", "item", "commit"]);
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

// Docs-found fixes batch 5, from the batch 4 review.
describe("the open tasks are read and locked inside WORK, and only what the leaver still holds moves", () => {
  it("never takes back a task reassigned between the plan and the write", async () => {
    // The plan saw t1 and t2 owned by the leaver. Before WORK reached them, a
    // teammate gave t2 to Carol. The row lock reads that.
    st.items = [{ id: "t1", status: "To do", assigneeIds: ["leaver"] }, { id: "t2", status: "To do", assigneeIds: ["leaver"] }];
    st.lockedItems = [
      { id: "t1", ownerId: "leaver", status: "To do", assigneeIds: ["leaver"], archivedAt: null },
      { id: "t2", ownerId: "carol", status: "To do", assigneeIds: ["carol"], archivedAt: null },
    ];
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // Before: every write named the snapshot's ids with no owner condition,
    // so t2 went to Rae and Carol's assignment was lost.
    expect(st.itemWrites.some((w) => (w.where.id as { in: string[] }).in.includes("t2"))).toBe(false);
    for (const w of st.itemWrites) expect(w.where.ownerId).toBe("leaver");
    expect(r.tasksReassigned).toBe(1);
  });

  it("rewrites an assignee set from what it holds under the lock, so a co-assignee added meanwhile stays", async () => {
    st.items = [{ id: "t1", status: "To do", assigneeIds: ["leaver"] }];
    st.lockedItems = [{ id: "t1", ownerId: "leaver", status: "To do", assigneeIds: ["leaver", "zoe"], archivedAt: null }];
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // Before: the set came from the snapshot read outside the transaction, ["rae"].
    expect(st.itemWrites).toEqual([{ where: { id: { in: ["t1"] }, ownerId: "leaver" }, data: { ownerId: "rae", assigneeIds: ["rae", "zoe"] } }]);
  });

  it("counts only the tasks really moved: a task closed or archived meanwhile stays", async () => {
    st.items = [{ id: "t1", status: "To do", assigneeIds: ["leaver"] }, { id: "t2", status: "To do", assigneeIds: ["leaver"] }];
    st.lockedItems = [
      { id: "t1", ownerId: "leaver", status: "Done", assigneeIds: ["leaver"], archivedAt: null },
      { id: "t2", ownerId: "leaver", status: "To do", assigneeIds: ["leaver"], archivedAt: new Date() },
    ];
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.itemWrites).toEqual([]);
    expect(r.tasksReassigned).toBe(0);
  });
});

describe("the record of the report moves commits with them, and survives a failed WORK", () => {
  it("writes one reporting_line_changed row per report moved, inside the locked transaction", async () => {
    st.names = { ...st.names, leaver: "Leo Leaver", rae: "Rae Recipient", r1: "Ida", r2: "Kim" };
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    const firstCommit = st.order.indexOf("commit");
    expect(st.order.indexOf("audit")).toBeGreaterThan(-1);
    expect(st.order.indexOf("audit")).toBeLessThan(firstCommit);
    expect(st.audit.map((a) => [a.type, a.targetId, a.description, a.oldValue, a.newValue])).toEqual([
      ["reporting_line_changed", "r1", "Moved Ida from Leo Leaver to Rae Recipient in a handover", { managerId: "leaver" }, { managerId: "rae" }],
      ["reporting_line_changed", "r2", "Moved Kim from Leo Leaver to Rae Recipient in a handover", { managerId: "leaver" }, { managerId: "rae" }],
    ]);
  });

  it("names where a report went up the line, and no manager, and who acted for SCIM", async () => {
    st.levels.boss = "AGENT"; // nobody above can take them: no manager
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: null, actorType: "scim", actorLabel: "Identity provider" });
    expect(st.audit.map((a) => a.newValue)).toEqual([{ managerId: null }, { managerId: null }]);
    expect(String(st.audit[0].description)).toMatch(/to no manager in a handover$/);
    expect(st.audit[0]).toMatchObject({ actorId: null, actorType: "scim", actorLabel: "Identity provider" });
  });

  it("moves open reviews with the lines before WORK starts", async () => {
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    const linesCommit = st.order.indexOf("commit");
    const workBegin = st.order.indexOf("begin", linesCommit);
    expect(st.followed).toEqual([{ at: linesCommit + 1, ids: ["r1", "r2"] }]);
    expect(st.followed[0].at).toBeLessThanOrEqual(workBegin);
  });

  it("when WORK fails, says the reports moved and the work did not, and the reviews still followed", async () => {
    st.workFails = true;
    const err = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" }).catch((e: unknown) => e);
    // Before: the bare WORK error, and followReportingLine never ran.
    expect(err).toBeInstanceOf(HandoverWorkFailed);
    const partial = err as HandoverWorkFailed;
    expect(partial.code).toBe("handover_partial");
    expect(partial.lines).toMatchObject({ reportsReassigned: 2, reportsMoved: 2 });
    expect(partial.message).toBe("Their 2 direct reports moved, but their open tasks and their Spaces, Folders and Lists didn't. Try again to move the rest.");
    expect(partial.message).not.toMatch(/--|\u2014/);
    expect(st.audit).toHaveLength(2);
    expect(st.followed).toHaveLength(1);
  });

  it("says plainly when nothing was left to move but the work", () => {
    expect(handoverPartialWords({ reportsMoved: 0 })).toBe("Their direct reports were already moved, but their open tasks and their Spaces, Folders and Lists didn't move. Try again to move them.");
    expect(handoverPartialWords({ reportsMoved: 1 })).toMatch(/^Their direct report moved, but/);
  });
});

describe("the handover counts and moves everyone who works here, not only the people anchored here", () => {
  it("moves a report who last switched to another workspace, and leaves someone who is not in this one", async () => {
    // r1 works here through a membership (anchored in a client workspace);
    // r2 is anchored elsewhere and holds nothing here.
    st.anchoredElsewhere = new Set(["r1", "r2"]);
    st.foreign = new Set(["r2"]);
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // Before: only reports anchored here, so r1 stayed under someone who left.
    expect(st.userWrites).toContainEqual({ ids: ["r1"], managerId: "rae" });
    expect(st.userWrites.some((w) => w.ids.includes("r2"))).toBe(false);
  });

  it("walks up through a manager who works here through a membership", async () => {
    // boss is anchored elsewhere; sam (the recipient) is an Agent, so the
    // reports go up to boss, who still manages here.
    st.anchoredElsewhere = new Set(["boss"]);
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    // Before: boss was skipped as absent, and the reports went to no manager.
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "boss" });
  });

  it("counts that report as pending before a deactivation", async () => {
    st.anchoredElsewhere = new Set(["r1"]);
    st.foreign = new Set();
    const counts = await pendingHandover("org", "leaver");
    expect(counts.directReports).toBe(2);
  });
});
