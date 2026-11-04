// The handover (runHandover) and its preview for the transfer dialog
// (previewReportHandover). Docs-found fixes batch 2: an Agent is never
// anyone's manager (access 2.4), so an Agent recipient takes the work as
// asked, while the reports go up to the leaver's own manager; before, they
// went to the Agent.
//
// docs/plans/workspace-status-2.md step 4: the lines are THIS workspace's.
// The double keeps a report's line here on the row that holds it (the
// account's for someone anchored here, st.managers; the membership's for
// someone here through one, st.memberLine) and writes each half only as
// Postgres would (seat-writes.ts moveLinesHere: the account half by its
// workspace, the membership half by its own), so a write of the wrong row,
// or of another workspace's line, shows. Every report here moves; nothing
// is kept, moved or logged for another workspace (E6).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  levels: {} as Record<string, string>,
  names: {} as Record<string, string>,
  managers: new Map<string, string | null>(),
  inactive: new Set<string>(),
  userWrites: [] as Array<{ ids: string[]; managerId: string | null }>,
  /** The membership half of a line move (moveLinesHere): whose line HERE moved, on their membership. */
  memberWrites: [] as Array<{ ids: string[]; managerId: string | null }>,
  /** Each person's row lock (workspace-anchor.ts lockPerson), in the order taken. */
  personLocks: [] as string[],
  /** Dotted lines of OTHER workspaces (E2): never read, counted or deleted by this one. */
  dottedElsewhere: [] as Array<{ userId: string; managerId: string; organizationId: string }>,
  /** Every dotted delete's where. */
  dottedDeletes: [] as Array<Record<string, unknown>>,
  ownerWrites: [] as string[],
  dottedRemoved: [] as string[][],
  /** This workspace's dotted lines, by manager. */
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
  /**
   * The line a membership HERE holds, for someone anchored elsewhere
   * (docs/plans/workspace-status-2.md E1; the step 2 review L8): kept apart
   * from st.managers, which is the account's line (the anchored
   * workspace's), so a reader or a writer that takes the wrong row shows.
   */
  memberLine: {} as Record<string, string | null>,
}));

vi.mock("@/lib/prisma", () => {
  // The workspace, in memory: st.managers is everyone not removed (id to
  // stored manager), anchored in "org" unless st.anchoredElsewhere says so.
  type W = { id?: string | { in: string[] }; managerId?: string | { in: string[] }; organizationId?: string; deletedAt?: null };
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
      .filter((id) => w.managerId === undefined || (typeof w.managerId === "string" ? st.managers.get(id) === w.managerId : w.managerId.in.includes(st.managers.get(id) ?? "")))
      .filter((id) => w.organizationId === undefined || row(id).organizationId === w.organizationId)
      .filter((id) => !("deletedAt" in w) || !st.removed.has(id))
      .map(row);
  };
  const user = {
    findMany: async (a: { where: W }) => pick(a.where),
    findUnique: async (a: { where: { id: string } }) => (st.managers.has(a.where.id) ? row(a.where.id) : null),
    // moveLinesHere's account half, as Postgres answers it: the rows of people
    // anchored in the workspace named, not removed, whose ACCOUNT line still
    // names the leaver. Never a membership's line (st.memberLine).
    updateManyAndReturn: async (a: { where: { id: { in: string[] }; organizationId?: string; managerId?: string }; data: { managerId: string | null } }) => {
      st.order.push("write");
      const ids = a.where.id.in.filter((id) =>
        st.managers.has(id) && !st.removed.has(id) &&
        (a.where.organizationId === undefined || row(id).organizationId === a.where.organizationId) &&
        (a.where.managerId === undefined || st.managers.get(id) === a.where.managerId));
      st.userWrites.push({ ids, managerId: a.data.managerId });
      for (const id of ids) st.managers.set(id, a.data.managerId);
      return ids.map((id) => ({ id }));
    },
    // As Postgres answers it: only the rows whose ACCOUNT line still names
    // the one the where names (the step 2 review L8), never a membership's.
    updateMany: async (a: { where: { id: { in: string[] }; managerId?: string }; data: { managerId: string | null } }) => {
      st.order.push("write");
      const ids = a.where.id.in.filter((id) => a.where.managerId === undefined || st.managers.get(id) === a.where.managerId);
      st.userWrites.push({ ids, managerId: a.data.managerId });
      return { count: ids.length };
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
  // This workspace's dotted lines (st.dottedTo) and other workspaces'
  // (st.dottedElsewhere): a read without organizationId sees both, as
  // Postgres would, so a reader that forgets the workspace shows.
  const dottedRows = () => [
    ...Object.entries(st.dottedTo).flatMap(([managerId, users]) => users.map((userId) => ({ userId, managerId, organizationId: "org" }))),
    ...st.dottedElsewhere,
  ];
  const userDottedLine = {
    findMany: async (a: { where: { managerId: string; organizationId?: string } }) =>
      dottedRows().filter((d) => d.managerId === a.where.managerId && (a.where.organizationId === undefined || d.organizationId === a.where.organizationId)).map((d) => ({ userId: d.userId })),
    // removeDottedHere: this workspace's rows of these pairs only.
    deleteMany: async (a: { where: { organizationId?: string; OR?: Array<{ userId: string; managerId: string }> } }) => {
      st.dottedDeletes.push(a.where);
      const pairs = a.where.OR ?? [];
      const hit = (d: { userId: string; managerId: string; organizationId: string }) =>
        (a.where.organizationId === undefined || d.organizationId === a.where.organizationId) && pairs.some((p) => p.userId === d.userId && p.managerId === d.managerId);
      const gone = dottedRows().filter(hit);
      for (const d of gone) {
        if (d.organizationId === "org") st.dottedTo[d.managerId] = (st.dottedTo[d.managerId] ?? []).filter((u) => u !== d.userId);
        else st.dottedElsewhere = st.dottedElsewhere.filter((x) => x !== d);
      }
      st.dottedRemoved.push(gone.map((d) => d.userId));
      return { count: gone.length };
    },
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
  // A membership here holds its person's line here (docs/plans/workspace-status-2.md
  // E1): st.memberLine, never the account's (st.managers). Read by person,
  // or (reportsHereOf) by the managers its line names.
  const lineHere = (id: string) => st.memberLine[id] ?? null;
  const organizationMembership = {
    findMany: async (a: { where: { organizationId: OrgWhere; userId?: { in: string[] }; managerId?: { in: string[] } } }) => {
      if (a.where.managerId) {
        const named = a.where.managerId.in;
        return orgMatches(a.where.organizationId, "org")
          ? [...st.managers.keys()].filter((id) => heldHere(id) && !st.removed.has(id) && named.includes(lineHere(id) ?? "")).map((userId) => ({ userId, managerId: lineHere(userId), status: "ACTIVE", role: st.levels[userId] ?? "EMPLOYEE" }))
          : [];
      }
      const ids = a.where.userId?.in ?? [];
      const here = orgMatches(a.where.organizationId, "org")
        ? ids.filter(heldHere).map((userId) => ({ userId, organizationId: "org", role: st.levels[userId] ?? "EMPLOYEE", managerId: lineHere(userId) }))
        : [];
      const elsewhere = ids.flatMap((userId) =>
        Object.entries(st.memberOf[userId] ?? {}).filter(([org]) => org !== "org" && orgMatches(a.where.organizationId, org)).map(([organizationId, role]) => ({ userId, organizationId, role })),
      );
      return [...here, ...elsewhere];
    },
    findUnique: async (a: { where: { userId_organizationId: { userId: string } } }) =>
      heldHere(a.where.userId_organizationId.userId) ? { role: st.levels[a.where.userId_organizationId.userId] ?? "EMPLOYEE" } : null,
    // moveLinesHere's membership half: the memberships HERE whose own line
    // still names the leaver, of people anchored elsewhere, not removed.
    updateManyAndReturn: async (a: { where: { userId: { in: string[] }; organizationId: string; managerId?: string }; data: { managerId: string | null } }) => {
      st.order.push("member-write");
      const ids = a.where.organizationId === "org"
        ? a.where.userId.in.filter((id) => heldHere(id) && !st.removed.has(id) && (a.where.managerId === undefined || lineHere(id) === a.where.managerId))
        : [];
      st.memberWrites.push({ ids, managerId: a.data.managerId });
      for (const id of ids) st.memberLine[id] = a.data.managerId;
      return ids.map((userId) => ({ userId }));
    },
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
  // The person's row lock (workspace-anchor.ts lockPerson), the one raw
  // write a line move takes; anything else is not modelled.
  const $executeRaw = async (sql: TemplateStringsArray, ...values: unknown[]) => {
    const text = sql.join("?");
    if (!/^SELECT 1 FROM "User" WHERE "id" = \? FOR NO KEY UPDATE$/.test(text)) throw new Error(`raw statement not modelled: ${text}`);
    st.order.push("person-lock");
    st.personLocks.push(String(values[0]));
    return 1;
  };
  const db = { user, item, space: owned("space"), folder: owned("folder"), board: owned("list"), userDottedLine, organizationMembership, activityLog, $queryRaw, $executeRaw };
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
  handoverPartialWords,
  handoverReportCount,
  moveAgentReports,
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
  st.memberWrites = [];
  st.personLocks = [];
  st.dottedElsewhere = [];
  st.dottedDeletes = [];
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
  st.memberLine = {};
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
    // Then each report's row lock, in id order (step 4: moveLinesHere), the
    // line writes (the account half, then the membership half), and (batch
    // 5) their audit rows, in the same transaction.
    expect(lines.slice(2)).toEqual(["person-lock", "person-lock", "write", "member-write", "audit"]);
    expect(st.personLocks).toEqual(["r1", "r2"]);
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
    // This workspace's row of the pair only (removeDottedHere).
    expect(st.dottedDeletes).toEqual([{ organizationId: "org", OR: [{ userId: "d1", managerId: "sam" }] }]);
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

  // workspace-status-2 step 4 (the step 2 review's pairing 3): the dialog's
  // count, its preview and the run read the same lines, this workspace's.
  it("counts the reports whose line HERE names the leaver, never an account line of another workspace", async () => {
    // r1 is here through a membership, her line here naming the leaver; kai
    // is here through a membership too, his account (the client's line)
    // naming the leaver but his line here naming boss.
    st.anchoredElsewhere = new Set(["r1", "kai"]);
    st.memberLine = { r1: "leaver", kai: "boss" };
    st.managers.set("r1", "cleo");
    st.managers.set("kai", "leaver");
    expect(await previewReportHandover("org", "leaver", "rae")).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [] });
    expect(await handoverReportCount("org", "leaver")).toBe(2);
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
    // The locked half: the lock, each report's row lock (step 4), the line
    // writes (account half, membership half) and (batch 5) their audit rows,
    // and nothing else.
    expect(st.order.slice(0, firstCommit)).toEqual(["begin", "lock", "person-lock", "person-lock", "write", "member-write", "audit"]);
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

  // The step 4 review L1: the recipient's seat here ended between the route's
  // check and this lock (a race). Before: judged by the account's status
  // alone, so a recipient live in another workspace took every report here,
  // under someone with no seat here.
  it("never gives the reports to a recipient who holds no seat here at the lock: they go up the line", async () => {
    st.anchoredElsewhere = new Set(["rae"]);
    st.foreign = new Set(["rae"]);
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "boss" }]);
    expect(st.memberWrites.every((w) => w.managerId !== "rae")).toBe(true);
    expect(r.reportsReassigned).toBe(0);
    // Their work still goes to them, as asked: only the reports are refused.
    expect(st.ownerWrites).toEqual(["rae", "rae", "rae"]);
  });

  it("never gives the reports, nor sends them up, to someone here through a membership whose account has ended (D12)", async () => {
    // Rae works here through a live membership; her account has ended where
    // it is anchored, so she signs in nowhere.
    st.anchoredElsewhere = new Set(["rae"]);
    st.inactive.add("rae");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "boss" }]);
    // The same for the walk up: boss is here through a membership, his
    // account ended; the reports go past him to big.
    st.userWrites = [];
    st.managers.set("r1", "leaver");
    st.managers.set("r2", "leaver");
    st.managers.set("big", null);
    st.levels.big = "VP";
    st.anchoredElsewhere = new Set(["boss"]);
    st.memberLine = { boss: "big" };
    st.inactive = new Set(["boss"]);
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "sam", actorId: "admin" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "big" }]);
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
    // Step 4 turned this green (it.fails since step 2): the plan reads r1's
    // line HERE (the membership's), and moveLinesHere writes it there (the
    // step 2 review's pairing 1). Before step 4 writeReportMoves wrote the
    // account's line, so nothing was written for r1.
    // r1 works here through a membership (anchored in a client workspace),
    // and reports to the leaver here by it; the account's line is client's.
    // r2 is anchored elsewhere and holds nothing here.
    st.anchoredElsewhere = new Set(["r1", "r2"]);
    st.foreign = new Set(["r2"]);
    st.memberLine = { r1: "leaver" };
    st.managers.set("r1", "cleo");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // Before batch 5: only reports anchored here, so r1 stayed under someone
    // who left. The move lands on the row that holds r1's line here, her
    // membership, and the client workspace's line (the account's) stays.
    expect(st.memberWrites).toContainEqual({ ids: ["r1"], managerId: "rae" });
    expect(st.memberLine.r1).toBe("rae");
    expect(st.managers.get("r1")).toBe("cleo");
    expect(st.userWrites.some((w) => w.ids.includes("r1") || w.ids.includes("r2"))).toBe(false);
    expect(st.memberWrites.some((w) => w.ids.includes("r2"))).toBe(false);
  });

  it("never moves the account's line of a report here through a membership, whose line in their own workspace names the leaver too", async () => {
    // Step 4 turned this green (it.fails since step 2): r1's line here (the
    // membership's) and in the client workspace (the account's) both name
    // the leaver. Before step 4 writeReportMoves wrote the account's (the
    // step 2 review's pairing 1b), so this workspace's handover rewrote the
    // client workspace's line. moveLinesHere moves the membership's only.
    st.anchoredElsewhere = new Set(["r1"]);
    st.memberLine = { r1: "leaver" };
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites.some((w) => w.ids.includes("r1"))).toBe(false);
    expect(st.managers.get("r1")).toBe("leaver");
    expect(st.memberWrites).toContainEqual({ ids: ["r1"], managerId: "rae" });
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
    // Step 4 turned this green (it.fails since step 2): handoverReportCount
    // counts the reports here (reportsHereOf, the step 2 review's pairing
    // 2). Before, it counted account lines, so r1, under the leaver here by
    // the membership's line, was not counted.
    st.anchoredElsewhere = new Set(["r1"]);
    st.foreign = new Set();
    st.memberLine = { r1: "leaver" };
    st.managers.set("r1", "cleo");
    const counts = await pendingHandover("org", "leaver");
    expect(counts.directReports).toBe(2);
  });

  it("the handover still moves a report anchored elsewhere whose line no other workspace relies on", async () => {
    // Step 4 turned this green (it.fails since step 2): the plan reads r1's
    // line HERE (the membership's), and moveLinesHere writes it there (the
    // step 2 review's pairing 1). Before step 4 writeReportMoves wrote the
    // account's line, so nothing was written for r1.
    // r1 is anchored in the client workspace, where the leaver holds nothing;
    // r1's line here (the membership's) names the leaver, the account's cleo.
    st.anchoredElsewhere = new Set(["r1"]);
    st.memberLine = { r1: "leaver" };
    st.managers.set("r1", "cleo");
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    // r2 (anchored here) on the account, r1 on the membership that holds her
    // line here; the client workspace's line (r1's account) stays cleo.
    expect(st.userWrites).toContainEqual({ ids: ["r2"], managerId: "rae" });
    expect(st.memberWrites).toContainEqual({ ids: ["r1"], managerId: "rae" });
    expect(st.memberLine.r1).toBe("rae");
    expect(st.managers.get("r1")).toBe("cleo");
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

// workspace-status-2 step 4 (E1, E2, E6): an Agent's move and a handover move
// THIS workspace's lines, every one of them, and never another workspace's.
// Batches 6 to 9 kept a line "another workspace relies on" (`stays`), moved
// it with the step that ended the account and logged it there; with one line
// per workspace there is no such line. The tests below are batch 6's and 7's
// cases, now with the lines each workspace holds.
describe("an Agent's move here moves this workspace's lines only", () => {
  it("moves every report listed under the Agent here, and never the line their own workspace holds", async () => {
    // sam is an Agent here and a Manager in the client workspace. a1 is
    // anchored in the client workspace (a membership here) and reports to
    // sam in both; a2 works here only.
    st.managers.set("a1", "sam");
    st.managers.set("a2", "sam");
    st.names = { ...st.names, a1: "Ida Ray", a2: "Kim Lo" };
    st.anchoredElsewhere.add("a1");
    st.memberLine = { a1: "sam" };
    st.memberOf = { sam: { client: "MANAGER" } };
    const plan = await previewAgentReports("org", "sam");
    // Before (batch 6): solid 1, a1 named as staying, so a1 stayed listed
    // under an Agent here, whose line here counts for nobody.
    expect(plan).toEqual({ agent: true, solid: 2, dotted: 0, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }] });
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin", expect: plan });
    expect(st.userWrites).toEqual([{ ids: ["a2"], managerId: "boss" }]);
    expect(st.memberWrites).toEqual([{ ids: ["a1"], managerId: "boss" }]);
    // The client workspace's line (a1's account) still names sam, its manager there.
    expect(st.managers.get("a1")).toBe("sam");
    expect(r).toEqual({ moved: 2, dottedRemoved: 0, rehomed: [{ to: "Dana Lee", toId: "boss", count: 2 }] });
  });

  it("takes off this workspace's dotted lines to the Agent and leaves another workspace's row of the same pair", async () => {
    st.managers.set("d1", "boss");
    st.managers.set("d2", "boss");
    st.dottedTo = { sam: ["d1", "d2"] };
    // d1 also has a dotted line to sam in the client workspace, where sam manages.
    st.dottedElsewhere = [{ userId: "d1", managerId: "sam", organizationId: "client" }];
    st.memberOf = { sam: { client: "MANAGER" }, d1: { client: "EMPLOYEE" } };
    // Before: the preview counted every workspace's rows to sam (the step 2
    // review's pairing 6), while the Members drawer counted this one's.
    expect(await previewAgentReports("org", "sam")).toMatchObject({ dotted: 2 });
    const r = await moveAgentReports({ organizationId: "org", agentId: "sam", actorId: "admin" });
    expect(r).toMatchObject({ dottedRemoved: 2 });
    expect(st.dottedDeletes).toEqual([{ organizationId: "org", OR: [{ userId: "d1", managerId: "sam" }, { userId: "d2", managerId: "sam" }] }]);
    // Before: the delete named no workspace, so the client lost d1's line to sam.
    expect(st.dottedElsewhere).toEqual([{ userId: "d1", managerId: "sam", organizationId: "client" }]);
    expect(st.dottedTo.sam).toEqual([]);
  });

  it("never counts another workspace's dotted row to the Agent in the preview", async () => {
    st.managers.set("d1", "boss");
    st.dottedElsewhere = [{ userId: "d1", managerId: "sam", organizationId: "client" }];
    expect(await previewAgentReports("org", "sam")).toEqual({ agent: true, solid: 0, dotted: 0, rehomed: [] });
  });
});

describe("a handover moves every report here and writes nothing of another workspace", () => {
  beforeEach(() => {
    // r1 also works with the leaver in the client workspace, where the
    // leaver is a Manager. r2 works here only.
    st.names = { ...st.names, r1: "Ida Ray", r2: "Kim Lo", leaver: "Leo Leaver", rae: "Rae Recipient" };
    st.memberOf = { leaver: { client: "MANAGER" }, r1: { client: "EMPLOYEE" } };
  });

  it("moves every report here at once, whatever the leaver is elsewhere, and the gate counts each until then", async () => {
    // Before (batch 8): r1 was left under the leaver ("reportsAtAccountEnd"),
    // the gate left r1 out, and the step that ended the account moved r1.
    expect(await previewReportHandover("org", "leaver", "rae")).toEqual({ reports: 2, toRecipient: 2, recipientIsAgent: false, rehomed: [] });
    expect(await handoverReportCount("org", "leaver")).toBe(2);
    const r = await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.userWrites).toEqual([{ ids: ["r1", "r2"], managerId: "rae" }]);
    expect(r.reportsReassigned).toBe(2);
    expect(Object.keys(r).sort()).toEqual(["containersReassigned", "reportsReassigned", "reportsRehomed", "tasksReassigned"]);
    expect(st.followed.map((f) => f.ids)).toEqual([["r1", "r2"]]);
    expect(await handoverReportCount("org", "leaver")).toBe(0);
  });

  it("writes its record here only, one row per report moved, never in another workspace", async () => {
    // Before (batch 7): a row in the client workspace's Audit log too.
    for (const ended of [false, true]) {
      st.audit = [];
      st.managers.set("r1", "leaver");
      st.managers.set("r2", "leaver");
      if (ended) st.inactive.add("leaver");
      await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: null, actorType: "scim", actorLabel: "Identity provider" });
      expect(st.audit.map((a) => [a.organizationId, a.targetId, a.description])).toEqual([
        ["org", "r1", "Moved Ida Ray from Leo Leaver to Rae Recipient in a handover"],
        ["org", "r2", "Moved Kim Lo from Leo Leaver to Rae Recipient in a handover"],
      ]);
      for (const a of st.audit) expect(a.metadata).toEqual({ handover: true, leaverId: "leaver" });
    }
  });

  it("moves a report here through a membership on their membership, and their own workspace's line to the leaver stays", async () => {
    // r1 is anchored in the client workspace, where the leaver manages her
    // too: both lines name the leaver. This workspace's handover moves the
    // line here; the client's handover is the client's to run.
    st.anchoredElsewhere = new Set(["r1"]);
    st.memberLine = { r1: "leaver" };
    await runHandover({ organizationId: "org", fromId: "leaver", toId: "rae", actorId: "admin" });
    expect(st.memberLine.r1).toBe("rae");
    expect(st.managers.get("r1")).toBe("leaver");
    expect(st.userWrites).toEqual([{ ids: ["r2"], managerId: "rae" }]);
    expect(st.audit.map((a) => [a.organizationId, a.targetId])).toEqual([["org", "r1"], ["org", "r2"]]);
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
