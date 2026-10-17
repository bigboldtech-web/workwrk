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
  /** Memberships in workspaces other than this one, by person, with their role there (batch 6). */
  memberOf: {} as Record<string, Record<string, string>>,
  /** The level a person anchored elsewhere holds where they are anchored ("client"), when it differs from st.levels. */
  anchorLevel: {} as Record<string, string>,
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
  /** Who each followReportingLine call names as acting (batch 7). */
  followedActors: [] as string[],
  busy: false,
  /** The leaver's containers, by kind, as WORK's row locks read them (batch 7). */
  containers: { folder: ["f1"], space: ["s1"], list: ["b1"] } as Record<"folder" | "space" | "list", string[]>,
  /** Every raw statement WORK sent, in order (batch 7). */
  raw: [] as string[],
  /** Container writes, by kind, with their where (batch 7). */
  containerWrites: [] as Array<{ kind: string; where: Record<string, unknown> }>,
  /** Accounts that are removed or deactivated elsewhere, and Guests, for linesElsewhere (batch 7). */
  orgRole: {} as Record<string, string>,
  /** Removed accounts (deletedAt), as their row reads (batch 8). */
  removed: new Set<string>(),
}));

vi.mock("@/lib/prisma", () => {
  // The workspace, in memory: st.managers is everyone not removed (id to
  // stored manager), anchored in "org" unless st.anchoredElsewhere says so.
  type W = { id?: string | { in: string[] }; managerId?: string; organizationId?: string; deletedAt?: null };
  const row = (id: string) => ({
    id,
    managerId: st.managers.get(id) ?? null,
    organizationId: st.anchoredElsewhere.has(id) ? "client" : "org",
    status: st.inactive.has(id) || st.removed.has(id) ? "INACTIVE" : "ACTIVE",
    deletedAt: st.removed.has(id) ? new Date("2026-10-01") : null,
    orgRole: st.orgRole[id] ?? "MEMBER",
    firstName: st.names[id] ?? id,
    lastName: "",
    ...legacyLevelRow((st.anchoredElsewhere.has(id) ? st.anchorLevel[id] : undefined) ?? st.levels[id] ?? "EMPLOYEE"),
  });
  const pick = (w: W) => {
    st.userReads.push(w);
    return [...st.managers.keys()]
      .filter((id) => w.id === undefined || (typeof w.id === "string" ? id === w.id : w.id.in.includes(id)))
      .filter((id) => w.managerId === undefined || st.managers.get(id) === w.managerId)
      .filter((id) => w.organizationId === undefined || row(id).organizationId === w.organizationId)
      .filter((id) => !("deletedAt" in w) || !st.removed.has(id))
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
    updateMany: async (a: { where: Record<string, unknown>; data: { ownerId: string } }) => {
      st.order.push(kind);
      st.ownerWrites.push(a.data.ownerId);
      st.containerWrites.push({ kind, where: a.where });
      return { count: 1 };
    },
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
  // Memberships elsewhere (batch 6): st.memberOf, read with { not } or { in }.
  type OrgWhere = string | { not?: string; in?: string[] };
  const orgMatches = (w: OrgWhere | undefined, org: string) =>
    w === undefined || (typeof w === "string" ? w === org : (w.not === undefined || w.not !== org) && (w.in === undefined || w.in.includes(org)));
  const organizationMembership = {
    findMany: async (a: { where: { organizationId: OrgWhere; userId: { in: string[] } } }) => {
      const here = orgMatches(a.where.organizationId, "org")
        ? a.where.userId.in.filter(heldHere).map((userId) => ({ userId, organizationId: "org", role: st.levels[userId] ?? "EMPLOYEE" }))
        : [];
      const elsewhere = a.where.userId.in.flatMap((userId) =>
        Object.entries(st.memberOf[userId] ?? {}).filter(([org]) => org !== "org" && orgMatches(a.where.organizationId, org)).map(([organizationId, role]) => ({ userId, organizationId, role })),
      );
      return [...here, ...elsewhere];
    },
    findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) =>
      heldHere(a.where.userId_organizationId.userId) ? { role: st.levels[a.where.userId_organizationId.userId] ?? "EMPLOYEE" } : null,
  };
  const activityLog = {
    createMany: async (a: { data: Array<Record<string, unknown>> }) => { st.order.push("audit"); st.audit.push(...a.data); return { count: a.data.length }; },
  };
  // WORK's row locks, told apart by the table they read (batch 7: the
  // containers are locked first, then the tasks).
  const $queryRaw = async (sql: TemplateStringsArray) => {
    const text = sql.join("?");
    st.raw.push(text);
    const kind = text.includes('FROM "Folder"') ? "folder" : text.includes('FROM "Space"') ? "space" : text.includes('FROM "Board"') ? "list" : null;
    if (kind) {
      st.order.push(`${kind}-lock`);
      return st.containers[kind].map((id) => ({ id }));
    }
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
  followReportingLine: async (_org: string, ids: string[], actor: string) => { st.followed.push({ at: st.order.length, ids }); st.followedActors.push(actor); },
}));

import { prisma } from "@/lib/prisma";
import {
  HandoverWorkFailed,
  followAccountEndLines,
  handoverPartialWords,
  handoverReportCount,
  moveAgentReports,
  moveReliedReportsAtEnd,
  pendingHandover,
  previewAgentReports,
  previewReportHandover,
  runHandover,
} from "./handover.server";

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
  st.memberOf = {};
  st.anchorLevel = {};
  st.followed = [];
  st.followedActors = [];
  st.busy = false;
  st.containers = { folder: ["f1"], space: ["s1"], list: ["b1"] };
  st.raw = [];
  st.containerWrites = [];
  st.orgRole = {};
  st.removed = new Set();
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
    expect(await previewAgentReports("org", "sam")).toEqual({ agent: true, solid: 2, dotted: 1, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }], stays: [] });
    expect(await previewAgentReports("org", "rae")).toEqual({ agent: false, solid: 0, dotted: 0, rehomed: [], stays: [] });
  });

  it("moves them up the line under the role lock and takes the dotted lines off", async () => {
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin" });
    expect(st.order.slice(0, 2)).toEqual(["begin", "lock"]);
    expect(st.userWrites).toEqual([{ ids: ["a1", "a2"], managerId: "boss" }]);
    expect(st.dottedRemoved).toEqual([["d1"]]);
    expect(r).toEqual({ moved: 2, dottedRemoved: 1, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }], stays: [] });
  });

  it("moves nothing for someone who is no Agent", async () => {
    expect(await moveAgentReports({ organizationId: "org", agentId: "rae", actorId: "admin" })).toBeNull();
    expect(st.userWrites).toEqual([]);
  });
});

describe("previewReportHandover", () => {
  it("tells the dialog exactly what the run will do, by name", async () => {
    expect(await previewReportHandover("org", "leaver", "sam")).toEqual({ reports: 2, toRecipient: 0, recipientIsAgent: true, rehomed: [{ to: "Dana Lee", count: 2 }], alsoElsewhere: [], accountEnded: false });
    expect(await previewReportHandover("org", "leaver", "rae")).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [], alsoElsewhere: [], accountEnded: false });
  });

  // Docs-found fixes batch 9: for someone already deactivated (or removed),
  // the transfer dialog said a line another workspace relies on "moves only
  // once they are removed", while the handover moved it at once.
  it("says whether the leaver's account has already ended, as the handover reads it", async () => {
    st.inactive.add("leaver");
    expect((await previewReportHandover("org", "leaver", "rae")).accountEnded).toBe(true);
    st.inactive.clear();
    st.removed.add("leaver");
    expect((await previewReportHandover("org", "leaver", "rae")).accountEnded).toBe(true);
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
    // order a Space delete locks them), so the two never deadlock. The
    // containers are locked first, in the delete's order (batch 7), then
    // written; the tasks are locked (batch 5), then written, owner and
    // assignees in one write.
    const work = st.order.slice(firstCommit + 1);
    expect(work).toEqual(["begin", "folder-lock", "space-lock", "list-lock", "folder", "space", "list", "item-lock", "item", "commit"]);
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
    // Batch 6: most leavers have no reports, so "Their direct reports were
    // already moved" was untrue for them. With none moved, only the work is named.
    expect(handoverPartialWords({ reportsMoved: 0 })).toBe("Their open tasks and their Spaces, Folders and Lists didn't move. Try again to move them.");
    expect(handoverPartialWords({ reportsMoved: 0 })).not.toMatch(/direct report/);
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

  // Docs-found fixes batch 9: PATCH's deactivation and DELETE read the whole
  // gate again under the role lock, in their own transaction.
  it("reads every count through the transaction it is given", async () => {
    const seen: string[] = [];
    const db = prisma as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
    const spy = (model: string, op: string) => (...a: unknown[]) => { seen.push(`${model}.${op}`); return db[model][op](...a); };
    const tx = {
      ...db,
      item: { ...db.item, findMany: spy("item", "findMany") },
      user: { ...db.user, findMany: spy("user", "findMany") },
      space: { ...db.space, count: spy("space", "count") },
      folder: { ...db.folder, count: spy("folder", "count") },
      board: { ...db.board, count: spy("board", "count") },
    };
    const counts = await pendingHandover("org", "leaver", tx as never);
    // Before: it took no transaction, and read outside the lock.
    expect([...new Set(seen)].sort()).toEqual(["board.count", "folder.count", "item.findMany", "space.count", "user.findMany"]);
    expect(counts).toEqual({ openTasks: 1, directReports: 2, containers: 0 });
  });
});

// Docs-found fixes batch 6, from the batch 5 review: a workspace writes only
// the reporting lines it owns. User.managerId and UserDottedLine are one row
// each, read by every workspace a person belongs to.
describe("a line another workspace relies on is never moved here", () => {
  it("moving an Agent's reports leaves a report who also works with the Agent where the Agent manages, and names them", async () => {
    // sam is an Agent here and a Manager in the client workspace. a1 is
    // anchored in the client workspace (a membership here) and reports to
    // sam there; a2 works here only.
    st.managers.set("a1", "sam");
    st.managers.set("a2", "sam");
    st.names = { ...st.names, a1: "Ida Ray", a2: "Kim Lo" };
    st.anchoredElsewhere.add("a1");
    st.memberOf = { sam: { client: "MANAGER" } };
    const plan = await previewAgentReports("org", "sam");
    // Before: solid 2, and the move wrote a1's managerId too, the column the
    // client workspace reads, so a1 lost their manager there.
    expect(plan).toEqual({ agent: true, solid: 1, dotted: 0, rehomed: [{ to: "Dana Lee", toId: "boss", count: 1 }], stays: [{ id: "a1", name: "Ida Ray", kind: "solid" }] });
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin", expect: plan });
    expect(st.userWrites).toEqual([{ ids: ["a2"], managerId: "boss" }]);
    expect(r).toMatchObject({ moved: 1, stays: [{ id: "a1", name: "Ida Ray", kind: "solid" }] });
  });

  it("leaves a report anchored here too, when they also work with the Agent in a workspace where the Agent manages", async () => {
    st.managers.set("a1", "sam");
    st.memberOf = { sam: { client: "MANAGER" }, a1: { client: "EMPLOYEE" } };
    expect(await previewAgentReports("org", "sam")).toMatchObject({ solid: 0, stays: [{ id: "a1", kind: "solid" }] });
    await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin" });
    expect(st.userWrites.some((w) => w.ids.includes("a1"))).toBe(false);
  });

  it("keeps a dotted line the other workspace counts, and takes off one it does not", async () => {
    st.managers.set("d1", "boss");
    st.managers.set("d2", "boss");
    st.dottedTo = { sam: ["d1", "d2"] };
    st.memberOf = { sam: { client: "MANAGER" }, d1: { client: "EMPLOYEE" } };
    expect(await previewAgentReports("org", "sam")).toMatchObject({ dotted: 1, stays: [{ id: "d1", kind: "dotted" }] });
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin" });
    // Before: both dotted lines deleted.
    expect(st.dottedRemoved).toEqual([["d2"]]);
    expect(r).toMatchObject({ dottedRemoved: 1 });
  });

  it("still moves a report when the Agent is an Agent in the other workspace too, or holds nothing there", async () => {
    st.managers.set("a1", "sam");
    st.memberOf = { sam: { client: "AGENT" }, a1: { client: "EMPLOYEE" } };
    expect(await previewAgentReports("org", "sam")).toMatchObject({ solid: 1, stays: [] });
    st.memberOf = { a1: { client: "EMPLOYEE" } };
    expect(await previewAgentReports("org", "sam")).toMatchObject({ solid: 1, stays: [] });
  });

  it("the handover still moves a report anchored elsewhere whose line no other workspace relies on", async () => {
    // r1 is anchored in the client workspace, where the leaver holds nothing.
    st.anchoredElsewhere = new Set(["r1"]);
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "rae" });
  });
});

// Docs-found fixes batch 7, from the batch 6 review: a handover's leaver is
// deactivated or removed next, and both are one column, so the leaver is gone
// from every workspace. Batch 6 left a report whose line another workspace
// relied on under them, so in both workspaces the report's reviews,
// approvals and team stayed with an account nobody could sign in to.
// Batch 8, from the batch 7 review: those lines move with the step that ends
// the account, never before it, since that step can still be refused. A
// handover of an account that has already ended moves them at once.
describe("a handover moves every report, and tells the other workspace", () => {
  beforeEach(() => {
    // r1 also works with the leaver in the client workspace, where the
    // leaver is a Manager. r2 works here only.
    st.names = { ...st.names, r1: "Ida Ray", r2: "Kim Lo", leaver: "Leo Leaver", rae: "Rae Recipient" };
    st.memberOf = { leaver: { client: "MANAGER" }, r1: { client: "EMPLOYEE" } };
  });

  it("while the leaver's account is live, leaves a report whose line the other workspace relies on, names them, and the gate does not count them", async () => {
    const preview = await previewReportHandover("org", "leaver", "rae");
    // The dialog still says where every report goes, r1 with the account's end.
    expect(preview).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [], alsoElsewhere: [{ id: "r1", name: "Ida Ray" }], accountEnded: false });
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // Before (batch 7): r1 moved here, so the client workspace's live line
    // changed before a deactivation or removal that could still be refused.
    expect(st.userWrites).toEqual([{ ids: ["r2"], managerId: "rae" }]);
    expect(r.reportsReassigned).toBe(1);
    expect(r.reportsAtAccountEnd).toEqual([{ id: "r1", name: "Ida Ray" }]);
    expect(r.reportsStaying).toEqual([]);
    expect(r.reportsAlsoElsewhere).toEqual([]);
    // Nothing written in the client workspace, and r1's reviews stay with their live manager.
    expect(st.audit.map((a) => [a.organizationId, a.targetId])).toEqual([["org", "r2"]]);
    expect(st.followed.map((f) => f.ids)).toEqual([["r2"]]);
    // The step that ends the account moves r1 itself, so r1 never holds it up.
    expect((await pendingHandover("org", "leaver")).directReports).toBe(1);
    expect(await handoverReportCount("org", "leaver")).toBe(1);
  });

  it("an account that has already ended moves them at once: removed counts too, and the other workspace gets its record", async () => {
    st.removed.add("leaver");
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toContainEqual({ ids: ["r1", "r2"], managerId: "rae" });
    expect(r.reportsAtAccountEnd).toEqual([]);
    expect(r.reportsAlsoElsewhere).toEqual([{ id: "r1", name: "Ida Ray" }]);
    // Before: a removed leaver was left out even with `leaving`, so no row there.
    expect(st.audit.filter((a) => a.organizationId === "client").map((a) => a.targetId)).toEqual(["r1"]);
  });

  it("writes the other workspace its own record of the move, in the same transaction, never naming this one or a stranger there", async () => {
    st.inactive.add("leaver");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.order.indexOf("audit")).toBeLessThan(st.order.indexOf("commit"));
    const there = st.audit.filter((a) => a.organizationId === "client");
    // Before: no row in the client workspace at all.
    expect(there).toEqual([
      {
        type: "reporting_line_changed",
        actorId: null,
        actorType: "system",
        actorLabel: "Another workspace",
        organizationId: "client",
        // Rae holds no level in the client workspace: never named there.
        description: "Moved Ida Ray from Leo Leaver to someone in another workspace, in a handover there",
        targetId: "r1",
        targetType: "user",
        severity: "info",
        oldValue: { managerId: "leaver" },
        newValue: { managerId: "rae" },
        metadata: { handover: true, leaverId: "leaver", fromAnotherWorkspace: true },
      },
    ]);
    // This workspace's rows are as before, one per report moved.
    expect(st.audit.filter((a) => a.organizationId === "org").map((a) => a.targetId)).toEqual(["r1", "r2"]);
    for (const a of st.audit) expect(String(a.description)).not.toMatch(/--|\u2014/);
  });

  it("names the new manager there when they work there too, and writes the row though SCIM deactivated the leaver first", async () => {
    st.memberOf = { ...st.memberOf, rae: { client: "MANAGER" } };
    st.inactive.add("leaver");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: null, actorType: "scim", actorLabel: "Identity provider" });
    expect(st.audit.filter((a) => a.organizationId === "client").map((a) => a.description)).toEqual([
      "Moved Ida Ray from Leo Leaver to Rae Recipient, in a handover in another workspace they work in",
    ]);
  });

  it("says no manager there for a move to no manager, and writes nothing there for a line it did not rely on", async () => {
    st.levels.boss = "AGENT"; // nobody above can take them, and sam is an Agent
    st.memberOf = { leaver: { client: "AGENT" }, r1: { client: "EMPLOYEE" }, r2: { other: "EMPLOYEE" } };
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    // An Agent in the client workspace was nobody's manager there: no row.
    expect(st.audit.filter((a) => a.organizationId !== "org")).toEqual([]);
    st.audit = [];
    st.memberOf = { leaver: { client: "MANAGER" }, r1: { client: "EMPLOYEE" } };
    // An account that has ended (batch 8: a live one keeps r1 until it ends).
    st.inactive.add("leaver");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.audit.filter((a) => a.organizationId === "client").map((a) => a.description)).toEqual([
      "Moved Ida Ray from Leo Leaver to no manager, in a handover in another workspace they work in",
    ]);
  });

  it("a leaver who leaves only this workspace keeps a line they still have elsewhere, and that report's reviews here go to the recipient", async () => {
    // SCIM ending a membership here: the leaver's account stays live there.
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: null, actorType: "scim", actorLabel: "Identity provider", leavesOnlyHere: true });
    expect(st.userWrites.some((w) => w.ids.includes("r1"))).toBe(false);
    expect(st.userWrites).toContainEqual({ ids: ["r2"], managerId: "rae" });
    expect(r.reportsStaying).toEqual([{ id: "r1", name: "Ida Ray" }]);
    expect(r.reportsAlsoElsewhere).toEqual([]);
    expect(st.audit.map((a) => [a.organizationId, a.targetId])).toEqual([["org", "r2"]]);
    expect(st.followed.map((f) => f.ids)).toEqual([["r2", "r1"]]);
    expect(st.followedActors).toEqual(["rae"]);
  });
});

describe("WORK locks the leaver's containers in the order a delete takes them (batch 7)", () => {
  it("locks Folders, Spaces and Lists, each in id order, then writes only the rows it locked, still the leaver's", async () => {
    st.containers = { folder: ["f1", "f2"], space: ["s1"], list: ["b1", "b2"] };
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    const locks = st.raw.filter((q) => !q.includes('FROM "Item"'));
    // Before: three updateMany calls, which lock rows in no order.
    expect(locks).toHaveLength(3);
    expect(locks[0]).toContain('FROM "Folder"');
    expect(locks[1]).toContain('FROM "Space"');
    expect(locks[2]).toContain('FROM "Board"');
    // Batch 8: FOR NO KEY UPDATE, which a foreign-key check's FOR KEY SHARE
    // never waits for (FOR UPDATE blocked task creates and deadlocked with
    // task and List moves), and which still waits for a delete's FOR UPDATE.
    for (const q of locks) expect(q).toMatch(/"organizationId" = \? AND "ownerId" = \? ORDER BY id FOR NO KEY UPDATE$/);
    expect(st.containerWrites).toEqual([
      { kind: "folder", where: { id: { in: ["f1", "f2"] }, ownerId: "leaver" } },
      { kind: "space", where: { id: { in: ["s1"] }, ownerId: "leaver" } },
      { kind: "list", where: { id: { in: ["b1", "b2"] }, ownerId: "leaver" } },
    ]);
    expect(r.containersReassigned).toBe(3);
  });

  it("writes nothing of a kind with nothing locked", async () => {
    st.containers = { folder: [], space: ["s1"], list: [] };
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.containerWrites.map((w) => w.kind)).toEqual(["space"]);
    expect(r.containersReassigned).toBe(1);
  });
});

// Docs-found fixes batch 8, from the batch 7 review: the step that ends the
// account (PATCH's deactivation, DELETE, SCIM) moves the lines another
// workspace relies on, inside its own role-locked transaction.
describe("the step that ends an account moves the lines another workspace relies on", () => {
  beforeEach(() => {
    st.names = { ...st.names, r1: "Ida Ray", r2: "Kim Lo", leaver: "Leo Leaver", rae: "Rae Recipient" };
    // r1 also reports to the leaver in the client workspace; r2 works here only.
    st.memberOf = { leaver: { client: "MANAGER" }, r1: { client: "EMPLOYEE" } };
  });
  const end = (extra: Partial<Parameters<typeof moveReliedReportsAtEnd>[1]> = {}) =>
    moveReliedReportsAtEnd(prisma as never, { organizationId: "org", leaverId: "leaver", recipientId: "rae", actorId: "admin", ends: "deactivated", ...extra });

  it("moves every report still listed under them, to the person the handover picked, the relied one with both workspaces' record", async () => {
    const done = await end();
    // Batch 9: r2 too. The gate refused under this lock while a report it did
    // not see as relied was left, so r2 being here means the gate saw r2's
    // line relied on and it no longer is (another workspace ended a
    // membership in between). Batch 8 left r2 under the account that ended.
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "rae" }]);
    expect(done).toMatchObject({ reportsMoved: 2, reportsReassigned: 2, reportIds: ["r1", "r2"], reportsAlsoElsewhere: [{ id: "r1", name: "Ida Ray" }] });
    expect(st.audit.map((a) => [a.organizationId, a.targetId, a.description])).toEqual([
      ["org", "r1", "Moved Ida Ray from Leo Leaver to Rae Recipient as Leo Leaver was deactivated"],
      ["org", "r2", "Moved Kim Lo from Leo Leaver to Rae Recipient as Leo Leaver was deactivated"],
      // Only the line the other workspace relies on now is recorded there.
      ["client", "r1", "Moved Ida Ray from Leo Leaver to someone in another workspace, as Leo Leaver's account was ended there"],
    ]);
    expect(st.audit[2]).toMatchObject({ actorId: null, actorType: "system", actorLabel: "Another workspace", metadata: { accountEnded: "deactivated", fromAnotherWorkspace: true } });
    for (const a of st.audit) expect(String(a.description)).not.toMatch(/--|\u2014/);
    // Reviews follow once the step commits, never inside it.
    expect(st.followed).toEqual([]);
    await followAccountEndLines("org", done, "admin");
    expect(st.followed.map((f) => f.ids)).toEqual([["r1", "r2"]]);
  });

  it("with nobody named, or an Agent named, sends them up the leaver's line; a removal says so", async () => {
    await end({ recipientId: null, ends: "removed" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "boss" }]);
    expect(st.audit[0].description).toBe("Moved Ida Ray from Leo Leaver to Dana Lee as Leo Leaver was removed");
    // Dana Lee holds no level in the client workspace: never named there.
    expect(st.audit.find((a) => a.organizationId === "client")?.description).toBe("Moved Ida Ray from Leo Leaver to someone in another workspace, as Leo Leaver's account was ended there");
    st.userWrites = [];
    st.audit = [];
    await end({ recipientId: "sam" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "boss" }]);
  });

  it("names the new manager there when they work there, and still moves a line to a leaver deactivated already", async () => {
    st.memberOf = { ...st.memberOf, rae: { client: "MANAGER" } };
    st.inactive.add("leaver");
    await end({ ends: "removed" });
    expect(st.audit.filter((a) => a.organizationId === "client").map((a) => a.description)).toEqual([
      "Moved Ida Ray from Leo Leaver to Rae Recipient, as Leo Leaver's account was ended in another workspace they work in",
    ]);
  });

  it("still moves a report whose line the gate saw relied on and no workspace relies on now, with no row elsewhere", async () => {
    // The gate counted r1 as relied, so it let the step run; the client
    // workspace made the leaver an Agent before this step read it again.
    // Before (batch 8): nothing moved, and r1 and r2 stayed under an account that ended.
    st.memberOf = { leaver: { client: "AGENT" }, r1: { client: "EMPLOYEE" } };
    const done = await end();
    expect(done).toMatchObject({ reportsMoved: 2, reportsReassigned: 2, reportsAlsoElsewhere: [], reportIds: ["r1", "r2"] });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "rae" }]);
    expect(st.audit.map((a) => a.organizationId)).toEqual(["org", "org"]);
  });

  it("does nothing when no one is listed under them", async () => {
    st.managers.delete("r1");
    st.managers.delete("r2");
    const done = await end();
    expect(done).toEqual({ reportsMoved: 0, reportsReassigned: 0, reportsRehomed: [], reportsAlsoElsewhere: [], reportIds: [] });
    expect(st.userWrites).toEqual([]);
    expect(st.audit).toEqual([]);
  });
});
