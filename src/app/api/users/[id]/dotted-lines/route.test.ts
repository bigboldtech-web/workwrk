// Contract test for PUT and GET /api/users/[id]/dotted-lines, and the org
// chart's picker exclusion (reportTreeOf in org-tree.tsx).
//
// Two ways a dotted line went wrong. A dotted line from a manager to their
// own report was accepted, which put the manager in the report's tree (the
// chain-view read reach), so the report could read the manager's phone,
// skill ratings, KPI history and reviews. And the subject's own id was
// dropped in silence, which, because PUT replaces the whole set, wiped every
// other dotted line in the same request. The database is mocked: the test
// reads what the route refused and what it wrote.
//
// docs/plans/workspace-status-2.md step 4 (E2, E4, E6): every dotted line
// names its workspace, and PUT replaces THIS workspace's rows with the body
// (seat-writes.ts writeDottedHere). Another workspace's rows are never read
// or touched, and none is kept here for another workspace, so the batch 6
// and 7 keep list and its `keptElsewhere` count are gone. A new line needs a
// live seat here; a line already held here is kept as it is.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

// The org: boss manages mid, mid manages leaf; side has a dotted line to
// leaf (so side sits below leaf); stranger is unrelated.
let managers: Map<string, string | null>;
/** Each line's workspace (E2): "org-1", this one, unless it says otherwise. */
let dotted: Array<{ userId: string; managerId: string; organizationId?: string }>;
const writes: string[] = [];
// People who hold the Agent tier when read under the role lock (batch 3:
// a role change can land between the first check and the write).
let agentsUnderLock = new Set<string>();
/** People anchored in another workspace ("client") who hold no level here (batch 6). */
let anchoredElsewhere = new Set<string>();
/** Memberships in other workspaces, by person, with their role there (batch 6). */
let memberOf: Record<string, Record<string, string>> = {};
/** Seats deactivated HERE through a membership (E4): kept seats, never a new line's manager. */
let deactivatedHere = new Set<string>();
/** Postgres ends the write's transaction to break a deadlock (40P01). */
let deadlock = false;
/** People removed here after the PUT's first check (the step 4 review L4): gone from any read of seats not removed. */
let removedHere = new Set<string>();
/** Every SQL statement the route sent outside the transaction. */
const rawReads: string[] = [];

vi.mock("@/lib/prisma", () => {
  const userDottedLine = {
    findMany: async (args: { where: { userId?: string; organizationId?: string } }) =>
      (args.where.userId ? dotted.filter((d) => d.userId === args.where.userId) : dotted)
        .filter((d) => args.where.organizationId === undefined || (d.organizationId ?? "org-1") === args.where.organizationId)
        .map((d) => ({ ...d, role: null, manager: { id: d.managerId, firstName: d.managerId, lastName: "", avatar: null } })),
    // writeDottedHere: this workspace's rows of the person, by manager.
    deleteMany: async (args: { where: { userId: string; organizationId: string; managerId: { in: string[] } } }) => {
      writes.push("deleteMany");
      const w = args.where;
      const before = dotted.length;
      dotted = dotted.filter((d) => !(d.userId === w.userId && (d.organizationId ?? "org-1") === w.organizationId && w.managerId.in.includes(d.managerId)));
      return { count: before - dotted.length };
    },
    upsert: async (args: { where: { userId_managerId_organizationId: { userId: string; managerId: string; organizationId: string } } }) => {
      writes.push("upsert");
      const k = args.where.userId_managerId_organizationId;
      if (!dotted.some((d) => d.userId === k.userId && d.managerId === k.managerId && (d.organizationId ?? "org-1") === k.organizationId)) dotted.push({ ...k });
      return {};
    },
  };
  type OrgWhere = string | { not?: string; in?: string[] };
  const orgOk = (w: OrgWhere | undefined, org: string) => w === undefined || (typeof w === "string" ? w === org : (w.not === undefined || w.not !== org) && (w.in === undefined || w.in.includes(org)));
  const level = (id: string) => (agentsUnderLock.has(id) ? "AGENT" : "EMPLOYEE");
  const user = {
    findMany: async (args: { where: { id: { in: string[] }; deletedAt?: null } }) =>
      args.where.id.in
        .filter((id) => !("deletedAt" in args.where && removedHere.has(id)))
        .map((id) => ({ id, organizationId: anchoredElsewhere.has(id) ? "client" : "org-1", ...legacyLevelRow(anchoredElsewhere.has(id) ? "MANAGER" : level(id)) })),
  };
  const organizationMembership = {
    findMany: async (args: { where: { userId: { in: string[] }; organizationId: OrgWhere } }) =>
      args.where.userId.in.flatMap((userId) => Object.entries(memberOf[userId] ?? {}).filter(([org]) => orgOk(args.where.organizationId, org)).map(([organizationId, role]) => ({ userId, organizationId, role }))),
  };
  // A person as the seat reads read them (managerCandidateIn, seatsHeldFor):
  // anchored here unless anchoredElsewhere says so.
  const personRow = (id: string) => ({ id, organizationId: anchoredElsewhere.has(id) ? "client" : "org-1", ...legacyLevelRow(anchoredElsewhere.has(id) ? "MANAGER" : level(id)), status: "ACTIVE", managerId: managers.get(id) ?? null });
  const tx = {
    // The role lock's own statement; its bounded wait's lock_timeout set and
    // reset, and the person's row lock, are not writes.
    $executeRaw: async (sql: TemplateStringsArray) => {
      const text = sql.join("?");
      if (text.includes("pg_advisory_xact_lock")) {
        writes.push("lock");
        if (deadlock) throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      }
      if (text.includes("FOR NO KEY UPDATE")) writes.push("person-lock");
      return 0;
    },
    user: {
      ...user,
      findFirst: async (args: { where: { id: string } }) => (managers.has(args.where.id) || anchoredElsewhere.has(args.where.id) ? personRow(args.where.id) : null),
      // writeDottedHere's seat check: the subject still anchored here.
      count: async (args: { where: { id: string; organizationId: string } }) => (managers.has(args.where.id) && !anchoredElsewhere.has(args.where.id) && args.where.organizationId === "org-1" ? 1 : 0),
    },
    organizationMembership: {
      // By person and workspace (seatsHeldFor), with the seat's state here.
      findMany: async (args: { where: { userId: { in: string[] }; organizationId: OrgWhere } }) =>
        args.where.userId.in.flatMap((userId) => Object.entries(memberOf[userId] ?? {}).filter(([org]) => orgOk(args.where.organizationId, org)).map(([organizationId, role]) => ({ userId, organizationId, role, status: organizationId === "org-1" && deactivatedHere.has(userId) ? "INACTIVE" : "ACTIVE", removedAt: null, managerId: null }))),
    },
    userDottedLine,
    // The save's Audit row, in the transaction (the final review of workspace-status-2, integrity L2).
    activityLog: { create: async () => ({}) },
  };
  return {
    prisma: {
      user: {
        ...user,
        findFirst: async (args: { where: { id: string } }) =>
          managers.has(args.where.id) ? { id: args.where.id, managerId: managers.get(args.where.id) ?? null, firstName: "A", lastName: "B" } : null,
        // The GET's seat check (personSeatIn): everyone in `managers` is anchored here.
        findUnique: async (args: { where: { id: string } }) =>
          managers.has(args.where.id) ? { organizationId: "org-1", ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, adminScopes: [], managerId: managers.get(args.where.id) ?? null } : null,
      },
      organizationMembership,
      userDottedLine,
      // workspaceDottedLines (batch 6): every dotted line from someone who works here.
      $queryRaw: async (sql: TemplateStringsArray) => { rawReads.push(sql.join("?")); return dotted.filter((d) => managers.has(d.userId)).map((d) => ({ ...d })); },
      // An interactive transaction, or (before batch 3) a batch of writes.
      $transaction: async (arg: unknown) => { writes.push("transaction"); return typeof arg === "function" ? arg(tx) : Promise.all(arg as unknown[]); },
    },
  };
});
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => ({ userId: "admin", organizationId: "org-1", orgRole: "ADMIN", isAdmin: true }),
  relationTo: (_ctx: unknown, id: string) => (id === "admin" ? "self" : "admin"),
  managerMapFor: async () => managers,
  // Kept seats here: anchored here, or a membership here (deactivated too).
  agentIdsAmong: async (_org: string, ids: string[]) => ({ found: ids.filter((i) => managers.has(i) || !!memberOf[i]?.["org-1"]).length, agents: [] }),
}));

import { GET, PUT } from "./route";
import { reportTreeOf } from "@/components/people/org-tree";

async function put(id: string, managerIds: string[]) {
  const req = new Request(`http://x/api/users/${id}/dotted-lines`, { method: "PUT", body: JSON.stringify({ managerIds }) });
  const res = await PUT(req as never, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  managers = new Map([["admin", null], ["boss", null], ["mid", "boss"], ["leaf", "mid"], ["side", null], ["stranger", null]]);
  dotted = [{ userId: "side", managerId: "leaf" }];
  writes.length = 0;
  agentsUnderLock = new Set();
  anchoredElsewhere = new Set();
  memberOf = {};
  deactivatedHere = new Set();
  deadlock = false;
  removedHere = new Set();
  rawReads.length = 0;
});

describe("PUT /api/users/[id]/dotted-lines", () => {
  it("refuses a direct report as the manager's dotted-line manager, and writes nothing", async () => {
    const r = await put("boss", ["mid"]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("dotted_line_cycle");
    expect(r.body.managerIds).toEqual(["mid"]);
    expect(writes).toEqual([]);
  });

  it("refuses anyone further down, over solid lines and existing dotted lines", async () => {
    expect((await put("boss", ["leaf"])).status).toBe(409);
    // side reports to leaf by a dotted line, so side is below boss too.
    expect((await put("boss", ["side"])).status).toBe(409);
    expect((await put("mid", ["stranger", "side"])).body.managerIds).toEqual(["side"]);
    expect(writes).toEqual([]);
  });

  it("refuses the subject's own id out loud instead of wiping the list", async () => {
    const r = await put("boss", ["stranger", "boss"]);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("self_dotted_line");
    expect(writes).toEqual([]);
  });

  it("still saves a dotted line to someone outside the tree, and clearing always passes", async () => {
    const ok = await put("leaf", ["stranger", "boss"]);
    expect(ok.status).toBe(200);
    expect(ok.body.managerIds).toEqual(["stranger", "boss"]);
    expect(writes).toContain("transaction");
    expect((await put("boss", [])).status).toBe(200);
  });

  it("writes under the role lock, and refuses a manager made an Agent since the first check (rule 6's race)", async () => {
    // The first check saw no Agent; a role change made stranger one before
    // this write took the lock. Rule 6 counted no dotted report then, so
    // without the second check the line would land under an Agent.
    agentsUnderLock = new Set(["stranger"]);
    const r = await put("leaf", ["stranger"]);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("agent_cannot_manage");
    expect(writes).toEqual(["transaction", "lock"]);
  });

  it("a loop already in the data never hangs the walk", async () => {
    managers.set("boss", "leaf"); // boss > mid > leaf > boss
    const r = await put("boss", ["mid"]);
    expect(r.status).toBe(409);
  });
});

describe("GET /api/users/[id]/dotted-lines", () => {
  it("gives a writer the person's whole report tree for the picker", async () => {
    const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "boss" }) });
    const body = (await res.json()) as { below?: string[] };
    expect(new Set(body.below)).toEqual(new Set(["mid", "leaf", "side"]));
  });
});

describe("reportTreeOf (the org chart's Dotted lines picker)", () => {
  const chart = [
    { id: "boss", managerId: null, dottedManagerIds: [] },
    { id: "mid", managerId: "boss", dottedManagerIds: [] },
    { id: "leaf", managerId: "mid", dottedManagerIds: [] },
    { id: "side", managerId: null, dottedManagerIds: ["leaf"] },
    { id: "stranger", managerId: null, dottedManagerIds: [] },
  ];
  it("leaves out everyone below, solid and dotted, nearest first", () => {
    const below = reportTreeOf(chart);
    expect(below("boss")).toEqual(["mid", "leaf", "side"]);
    expect(below("leaf")).toEqual(["side"]);
    expect(below("stranger")).toEqual([]);
  });
  it("survives a loop in the data", () => {
    const below = reportTreeOf([...chart.slice(1), { id: "boss", managerId: "leaf", dottedManagerIds: [] }]);
    expect(new Set(below("mid"))).toEqual(new Set(["leaf", "boss", "side"]));
  });
});

// Docs-found fixes batches 6 and 7 kept a line "another workspace relies
// on" whatever the body said, and counted it (`keptElsewhere`): a
// UserDottedLine was one row every workspace read. Since workspace-status-2
// E2 each row names its workspace, so step 4 replaces this workspace's rows
// only, keeps none for another, and counts nothing (E6).
describe("PUT replaces this workspace's dotted lines, and never another workspace's", () => {
  // the rows of this workspace as the test reads them
  const here = (userId: string) => dotted.filter((d) => d.userId === userId && (d.organizationId ?? "org-1") === "org-1").map((d) => d.managerId).sort();
  beforeEach(() => {
    // gil works only in the client workspace; leaf works there too, and has
    // a dotted line to gil there (its row names "client").
    anchoredElsewhere = new Set(["gil"]);
    memberOf = { leaf: { client: "EMPLOYEE" } };
    dotted = [{ userId: "side", managerId: "leaf" }, { userId: "leaf", managerId: "gil", organizationId: "client" }, { userId: "leaf", managerId: "boss" }];
  });

  it("replaces this workspace's rows with the body and leaves the client's row as it is", async () => {
    const r = await put("leaf", ["stranger"]);
    expect(r.status).toBe(200);
    // The answer is the lines here, with no count of another workspace's.
    expect(r.body).toEqual({ managerIds: ["stranger"] });
    expect(here("leaf")).toEqual(["stranger"]);
    expect(dotted).toContainEqual({ userId: "leaf", managerId: "gil", organizationId: "client" });
    expect(writes).toEqual(["transaction", "lock", "person-lock", "deleteMany", "upsert"]);
  });

  it("refuses a body that names someone with no seat here, as for any new line here", async () => {
    // Before (batch 6): 200, gil kept as the client's line. The record and
    // the GET list only this workspace's rows to people with a seat here
    // (step 3), so no dialog sends gil.
    const r = await put("leaf", ["gil", "stranger"]);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Someone in that list isn't in this workspace");
    expect(here("leaf")).toEqual(["boss"]);
  });

  it("takes off a row here to someone this workspace deactivated who is live elsewhere (the step 3 review item 3b)", async () => {
    // Rita: anchored in the client workspace, where leaf works too and Rita
    // manages; deactivated here through her membership. Before: the keep
    // list kept her row (keptElsewhere 1), and she was back on the next load.
    anchoredElsewhere = new Set(["gil", "rita"]);
    memberOf = { leaf: { client: "EMPLOYEE" }, rita: { "org-1": "MANAGER", client: "MANAGER" } };
    deactivatedHere = new Set(["rita"]);
    dotted.push({ userId: "leaf", managerId: "rita" });
    const r = await put("leaf", ["boss"]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ managerIds: ["boss"] });
    expect(here("leaf")).toEqual(["boss"]);
  });

  it("keeps a row here to someone deactivated here when the body keeps it, and never makes a new one (E4)", async () => {
    anchoredElsewhere = new Set(["gil", "rita"]);
    memberOf = { leaf: { client: "EMPLOYEE" }, rita: { "org-1": "MANAGER" } };
    deactivatedHere = new Set(["rita"]);
    // A new line to Rita: refused, nothing written.
    const fresh = await put("leaf", ["boss", "rita"]);
    expect(fresh.status).toBe(400);
    expect(fresh.body).toMatchObject({ code: "manager_inactive", field: "dottedLines" });
    expect(here("leaf")).toEqual(["boss"]);
    // Held already: kept as it is, as a deactivation keeps dotted lines.
    dotted.push({ userId: "leaf", managerId: "rita" });
    const kept = await put("leaf", ["boss", "rita"]);
    expect(kept.status).toBe(200);
    expect(here("leaf")).toEqual(["boss", "rita"]);
  });

  // The step 4 review L4: a held line is kept without the live check, so its
  // manager's seat is read again under the lock.
  it("refuses a held line whose manager was removed here between the first check and the lock, writing nothing", async () => {
    // The first check (agentIdsAmong, before the lock) still found boss.
    removedHere = new Set(["boss"]);
    const r = await put("leaf", ["boss", "stranger"]);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Someone in that list isn't in this workspace");
    expect(here("leaf")).toEqual(["boss"]);
    expect(writes).toEqual(["transaction", "lock"]);
  });

  it("answers a deadlock Postgres broke as the 503 roles_busy, never a 500, and writes nothing", async () => {
    deadlock = true;
    const req = new Request("http://x/api/users/leaf/dotted-lines", { method: "PUT", body: JSON.stringify({ managerIds: ["stranger"] }) });
    const res = await PUT(req as never, { params: Promise.resolve({ id: "leaf" }) });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("roles_busy");
    expect(here("leaf")).toEqual(["boss"]);
  });

  it("the loop walk reads the workspace's dotted lines through the indexed statement", async () => {
    await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "boss" }) });
    // Before: userDottedLine.findMany with inWorkspaceWhere as its only filter.
    expect(rawReads.some((q) => q.includes('FROM "OrganizationMembership" m') && q.includes('JOIN "UserDottedLine" d'))).toBe(true);
  });
});

// workspace-status-2 E2, E6, step 3: the GET reads THIS workspace's rows
// only, so another workspace's line is neither listed nor counted. Before:
// { managers: [], keptElsewhere: 1 }, read from every workspace's rows.
describe("GET says nothing of another workspace's lines", () => {
  beforeEach(() => {
    anchoredElsewhere = new Set(["gil"]);
    memberOf = { leaf: { client: "EMPLOYEE" } };
    dotted = [{ userId: "side", managerId: "leaf" }, { userId: "leaf", managerId: "gil", organizationId: "client" }];
  });

  it("GET reads this workspace's rows only, and counts none of another workspace's", async () => {
    const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "leaf" }) });
    const body = await res.json();
    expect(body.managers).toEqual([]);
    expect(body).not.toHaveProperty("keptElsewhere");
    // The same line as this workspace's own row is this workspace's to list.
    memberOf = { gil: { "org-1": "MANAGER" }, leaf: { client: "EMPLOYEE" } };
    dotted = [{ userId: "leaf", managerId: "gil" }];
    const own = await (await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "leaf" }) })).json();
    expect(own.managers.map((m: { id: string }) => m.id)).toEqual(["gil"]);
  });
});
