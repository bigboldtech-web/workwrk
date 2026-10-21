// POST /api/docs as a function of who is acting (docs/plans/mcp-server.md
// step 3 test "the extractions: answers equal the routes'"). The route reads
// the session and the body and hands both to createDocAs, the body moved
// verbatim: for the same caller and body the two answer the same, status
// and body, and write the same doc with its first version. Fails on the code
// before step 3: there was no createDocAs.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  readable: true,
  canCreate: true,
  live: true,
  parentHome: null as null | { entityType: string; entityId: string },
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/suites/auth", async () => {
  const { legacyLevelRow } = await import("@/lib/access/test-fixtures");
  return { resolveSuiteContext: async () => ({ userId: "u-max", orgId: "org", ...legacyLevelRow("EMPLOYEE"), sessionOrgId: "org" }) };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doc: {
      create: async (a: { data: Record<string, unknown> }) => {
        h.created.push(a.data);
        return { id: "d-new", title: a.data.title, content: a.data.content, entityType: a.data.entityType, entityId: a.data.entityId, createdAt: new Date(0), updatedAt: new Date(0) };
      },
    },
  },
}));
vi.mock("@/lib/access/node-access", () => ({
  nodeCtxFromLevel: (userId: string, organizationId: string) => ({ userId, organizationId }),
  canReadDocPlace: async () => h.readable,
  nodeRoleMap: async () => new Map(),
  docRoleFor: async () => "none",
}));
vi.mock("@/lib/access/node-placement", () => ({
  docHomeOf: async () => h.parentHome,
  docPlaceLive: async () => h.live,
  docAnchorPlaceOf: async () => ({ kind: "space", id: "s1", name: "Proof Space" }),
}));
vi.mock("@/lib/doc-access", () => ({ canCreateDocAt: async () => h.canCreate }));

import { POST } from "@/app/api/docs/route";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { createDocAs } from "./doc-create";

const C = { userId: "u-max", orgId: "org", ...legacyLevelRow("EMPLOYEE") };

async function read(res: Response | undefined) {
  if (!res) throw new Error("no answer");
  return { status: res.status, body: await res.json() };
}

/** The route's and the function's answers, and the doc each wrote, with the position (a time) set aside. */
async function both(body: unknown) {
  const out = [];
  for (const run of [
    async () => read(await POST(new Request("https://app.workwrk.com/api/docs", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }))),
    async () => read(await createDocAs(C, typeof body === "string" ? null : body)),
  ]) {
    h.created = [];
    const answer = await run();
    out.push({ answer, created: h.created.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "position"))) });
  }
  return out;
}

beforeEach(() => {
  h.readable = true;
  h.canCreate = true;
  h.live = true;
  h.parentHome = null;
});

describe("createDocAs answers as the route does", () => {
  it("for a note, a doc in a Space and a sub-page, each with its first version", async () => {
    for (const body of [
      { title: "Note", content: { blocks: [] }, entityType: "NOTEPAD", entityId: "u-max" },
      { title: "Plan", entityType: "SPACE", entityId: "s1" },
      { title: "Page", parentId: "d-root" },
    ]) {
      const [route, fn] = await both(body);
      expect(route.answer.status, body.title).toBe(200);
      expect(route.created[0]).toMatchObject({ createdById: "u-max", versions: { create: { version: 1, title: body.title, authorId: "u-max" } } });
      expect(fn).toEqual(route);
    }
  });

  it("for every refusal: a bad body, an empty parent, a half anchor, an unknown anchor, a place it cannot read, one in Trash, one it cannot add to", async () => {
    const cases: Array<[() => void, unknown, number]> = [
      [() => undefined, "nope", 400],
      [() => undefined, { title: "" }, 400],
      [() => undefined, { title: "x", parentId: "" }, 400],
      [() => undefined, { title: "x", entityType: "SPACE" }, 400],
      [() => undefined, { title: "x", entityType: "TABLE", entityId: "t" }, 400],
      [() => (h.readable = false), { title: "x", entityType: "SPACE", entityId: "s1" }, 404],
      [() => (h.parentHome = { entityType: "SPACE", entityId: "s2" }), { title: "x", entityType: "SPACE", entityId: "s1", parentId: "d1" }, 400],
      [() => (h.live = false), { title: "x", entityType: "SPACE", entityId: "s1" }, 400],
      [() => (h.canCreate = false), { title: "x", entityType: "SPACE", entityId: "s1" }, 403],
    ];
    for (const [setUp, body, status] of cases) {
      setUp();
      const [route, fn] = await both(body);
      expect(route.answer.status, JSON.stringify(body)).toBe(status);
      expect(fn, JSON.stringify(body)).toEqual(route);
      expect(route.created).toEqual([]);
      h.readable = true;
      h.canCreate = true;
      h.live = true;
      h.parentHome = null;
    }
  });
});
