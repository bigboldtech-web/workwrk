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

// The org: boss manages mid, mid manages leaf; side has a dotted line to
// leaf (so side sits below leaf); stranger is unrelated.
let managers: Map<string, string | null>;
let dotted: Array<{ userId: string; managerId: string }>;
const writes: string[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async (args: { where: { id: string } }) =>
        managers.has(args.where.id) ? { id: args.where.id, managerId: managers.get(args.where.id) ?? null, firstName: "A", lastName: "B" } : null,
    },
    userDottedLine: {
      findMany: async (args: { where: { userId?: string } }) =>
        args.where.userId ? [] : dotted.map((d) => ({ ...d })),
      deleteMany: () => { writes.push("deleteMany"); return "deleteMany"; },
      upsert: () => { writes.push("upsert"); return "upsert"; },
    },
    $transaction: async (ops: unknown[]) => { writes.push("transaction"); return ops; },
  },
}));
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
