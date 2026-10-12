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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

// The org: boss manages mid, mid manages leaf; side has a dotted line to
// leaf (so side sits below leaf); stranger is unrelated.
let managers: Map<string, string | null>;
let dotted: Array<{ userId: string; managerId: string }>;
const writes: string[] = [];
// People who hold the Agent tier when read under the role lock (batch 3:
// a role change can land between the first check and the write).
let agentsUnderLock = new Set<string>();
/** People anchored in another workspace ("client") who hold no level here (batch 6). */
let anchoredElsewhere = new Set<string>();
/** Memberships in other workspaces, by person, with their role there (batch 6). */
let memberOf: Record<string, Record<string, string>> = {};
/** What each deleteMany kept (its managerId notIn), to see which lines a PUT replaced. */
const kept: string[][] = [];
/** Every SQL statement the route sent outside the transaction. */
const rawReads: string[] = [];

vi.mock("@/lib/prisma", () => {
  const userDottedLine = {
    findMany: async (args: { where: { userId?: string } }) =>
      (args.where.userId ? dotted.filter((d) => d.userId === args.where.userId) : dotted).map((d) => ({ ...d, role: null, manager: { id: d.managerId, firstName: d.managerId, lastName: "", avatar: null } })),
    deleteMany: async (args: { where: { managerId: { notIn: string[] } } }) => { writes.push("deleteMany"); kept.push(args.where.managerId.notIn); return { count: 0 }; },
    upsert: async () => { writes.push("upsert"); return {}; },
  };
  type OrgWhere = string | { not?: string; in?: string[] };
  const orgOk = (w: OrgWhere | undefined, org: string) => w === undefined || (typeof w === "string" ? w === org : (w.not === undefined || w.not !== org) && (w.in === undefined || w.in.includes(org)));
  const level = (id: string) => (agentsUnderLock.has(id) ? "AGENT" : "EMPLOYEE");
  const user = {
    findMany: async (args: { where: { id: { in: string[] } } }) =>
      args.where.id.in.map((id) => ({ id, organizationId: anchoredElsewhere.has(id) ? "client" : "org-1", ...legacyLevelRow(anchoredElsewhere.has(id) ? "MANAGER" : level(id)) })),
  };
  const organizationMembership = {
    findMany: async (args: { where: { userId: { in: string[] }; organizationId: OrgWhere } }) =>
      args.where.userId.in.flatMap((userId) => Object.entries(memberOf[userId] ?? {}).filter(([org]) => orgOk(args.where.organizationId, org)).map(([organizationId, role]) => ({ userId, organizationId, role }))),
  };
  const tx = {
    // The role lock's own statement; its bounded wait's lock_timeout set and reset are not writes.
    $executeRaw: async (sql: TemplateStringsArray) => { if (sql.join("?").includes("pg_advisory_xact_lock")) writes.push("lock"); return 0; },
    user,
    organizationMembership,
    userDottedLine,
  };
  return {
    prisma: {
      user: {
        ...user,
        findFirst: async (args: { where: { id: string } }) =>
          managers.has(args.where.id) ? { id: args.where.id, managerId: managers.get(args.where.id) ?? null, firstName: "A", lastName: "B" } : null,
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
  agentIdsAmong: async (_org: string, ids: string[]) => ({ found: ids.filter((i) => managers.has(i)).length, agents: [] }),
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
  kept.length = 0;
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

// Docs-found fixes batch 6, from the batch 5 review: a workspace writes only
// the dotted lines it owns. A UserDottedLine is one row every workspace the
// person belongs to reads.
describe("PUT and GET keep the dotted lines another workspace relies on", () => {
  beforeEach(() => {
    // gil works only in the client workspace; leaf works there too, and has
    // a dotted line to gil, the client workspace's.
    anchoredElsewhere = new Set(["gil"]);
    memberOf = { leaf: { client: "EMPLOYEE" } };
    dotted = [{ userId: "side", managerId: "leaf" }, { userId: "leaf", managerId: "gil" }];
  });

  it("saving the lines here never deletes that one", async () => {
    const r = await put("leaf", ["stranger"]);
    expect(r.status).toBe(200);
    // Before: deleteMany kept only ["stranger"], so leaf's dotted line in the
    // client workspace was deleted by an edit made here.
    expect(kept).toEqual([["stranger", "gil"]]);
  });

  it("a body that names it, as the edit dialog sends every line it shows, is not refused", async () => {
    const r = await put("leaf", ["gil", "stranger"]);
    // Before: 400 "Someone in that list isn't in this workspace", so no dotted
    // line of leaf's could be edited here at all.
    expect(r.status).toBe(200);
    expect(kept).toEqual([["gil", "stranger", "gil"]]);
  });

  it("a line to someone who works in none of the person's workspaces is this workspace's to take off", async () => {
    memberOf = {};
    await put("leaf", ["stranger"]);
    expect(kept).toEqual([["stranger"]]);
  });

  it("GET answers only the lines this workspace manages", async () => {
    const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "leaf" }) });
    const body = (await res.json()) as { managers: Array<{ id: string }> };
    expect(body.managers).toEqual([]);
  });

  it("the loop walk reads the workspace's dotted lines through the indexed statement", async () => {
    await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "boss" }) });
    // Before: userDottedLine.findMany with inWorkspaceWhere as its only filter.
    expect(rawReads.some((q) => q.includes('FROM "OrganizationMembership" m') && q.includes('JOIN "UserDottedLine" d'))).toBe(true);
  });
});

// Docs-found fixes batch 7, from the batch 6 review: the PUT kept another
// workspace's line silently, and answered 200 with managerIds that left it
// out, so the dialog's save tick was untrue and the line came back on the
// next load. Both now answer how many lines are kept for another workspace,
// and the PUT's managerIds are the lines this workspace manages.
describe("PUT and GET say how many lines are kept for another workspace", () => {
  beforeEach(() => {
    anchoredElsewhere = new Set(["gil"]);
    memberOf = { leaf: { client: "EMPLOYEE" } };
    dotted = [{ userId: "side", managerId: "leaf" }, { userId: "leaf", managerId: "gil" }];
  });

  it("the PUT answers the kept line as a count, never among the lines it manages", async () => {
    const r = await put("leaf", ["gil", "stranger"]);
    expect(r.status).toBe(200);
    // Before: { managerIds: ["gil", "stranger"] }, gil reading as one of this workspace's.
    expect(r.body).toEqual({ managerIds: ["stranger"], keptElsewhere: 1 });
  });

  it("GET answers the count too", async () => {
    const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "leaf" }) });
    expect(await res.json()).toMatchObject({ managers: [], keptElsewhere: 1 });
    memberOf = {};
    const none = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "leaf" }) });
    expect(await none.json()).toMatchObject({ keptElsewhere: 0 });
  });
});
