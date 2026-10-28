// POST /api/item-types and PATCH /api/item-types/[id] (settings-cleanup
// Phase 6 review, M1, the server's half): a type name already in use, in any
// case, is refused with a 409 in plain words, on create and on rename, the
// way /api/tags refuses a tag it already holds. There is no unique
// constraint behind it, so rows stored twice before the rule are still read,
// and a type stored twice can still be edited or made the default under the
// name it already has.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; singular: string; plural: string; icon: string; description: string | null; category: string | null; isDefault: boolean; builtIn: boolean; createdAt: Date; updatedAt: Date };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));

/** The filters these routes use, read the way Postgres reads them: `mode: "insensitive"` compares without case, `not` excludes. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object") {
      const f = v as { not?: unknown; equals?: unknown; mode?: string };
      if ("not" in f) return row[k] !== f.not;
      if ("equals" in f) {
        return f.mode === "insensitive" ? String(row[k]).toLowerCase() === String(f.equals).toLowerCase() : row[k] === f.equals;
      }
    }
    return row[k] === v;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    itemType: {
      count: async ({ where }: { where: Record<string, unknown> }) => st.rows.filter((r) => matches(r, where)).length,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => st.rows.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => st.rows.filter((r) => matches(r, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => { st.created.push(data); return { id: "new", ...data }; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        st.updated.push({ id: where.id, data });
        return { ...st.rows.find((r) => r.id === where.id), ...data };
      },
      updateMany: async () => ({ count: 0 }),
    },
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org1" } } }),
  getOrgId: () => "org1",
  getUserId: () => "u1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true, actor: { ok: true, level: "COMPANY_ADMIN", admin: true, owner: true } }) }));

import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";

const at = new Date("2026-10-01T00:00:00.000Z");
const row = (id: string, singular: string, extra: Partial<Row> = {}): Row => ({
  id, organizationId: "org1", singular, plural: `${singular}s`, icon: "CircleDot", description: null, category: null,
  isDefault: false, builtIn: false, createdAt: at, updatedAt: at, ...extra,
});
const BUILT_INS = [
  row("task", "Task", { builtIn: true, isDefault: true }),
  row("milestone", "Milestone", { builtIn: true }),
  row("form", "Form Response", { builtIn: true }),
  row("note", "Meeting Note", { builtIn: true }),
];

const post = (body: unknown) => POST(new NextRequest("http://x/api/item-types", { method: "POST", body: JSON.stringify(body) }));
const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://x/api/item-types/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  st.rows = [...BUILT_INS, row("bug", "Bug"), row("other-org", "Epic", { organizationId: "org2" })];
  st.created = [];
  st.updated = [];
});

describe("POST: a name in use, in any case, is refused", () => {
  it("answers 409 for \"task\" when \"Task\" exists, names the type that holds it, and creates nothing", async () => {
    const r = await post({ singular: "task" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'A task type called "Task" already exists. Pick another name.' });
    expect(st.created).toEqual([]);

    // The name is trimmed first, and a custom type counts as much as a built-in.
    const spaced = await post({ singular: "  BUG " });
    expect(spaced.status).toBe(409);
    expect((await spaced.json()).error).toContain('"Bug"');
    expect(st.created).toEqual([]);

    // Only a name in use here is refused: one only another workspace holds is created.
    const free = await post({ singular: "Epic" });
    expect(free.status).toBe(201);
    expect(st.created).toHaveLength(1);
    expect(st.created[0]).toMatchObject({ organizationId: "org1", singular: "Epic", plural: "Epics" });
  });
});

describe("PATCH: a rename may not take a name another type holds", () => {
  it("answers 409 for renaming Bug to \"task\", and writes nothing", async () => {
    const r = await patch("bug", { singular: "task" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('A task type called "Task" already exists. Pick another name.');
    expect(st.updated).toEqual([]);

    // Its own name in another case, or a free name, goes through.
    expect((await patch("bug", { singular: "BUG" })).status).toBe(200);
    expect((await patch("bug", { singular: "Defect" })).status).toBe(200);
    expect(st.updated.map((u) => u.data.singular)).toEqual(["BUG", "Defect"]);
  });

  it("a type stored twice before the rule is still read, made the default, and edited under the name it has, but not renamed onto the other", async () => {
    st.rows.push(row("bug2", "bug"));
    expect((await patch("bug2", { singular: "Task" })).status).toBe(409);
    const list = await GET();
    expect(list.status).toBe(200);
    expect((await list.json()).types.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(["bug", "bug2"]));

    expect((await patch("bug2", { isDefault: true })).status).toBe(200);
    expect((await patch("bug2", { singular: "bug", description: "A defect" })).status).toBe(200);
    expect(st.updated.map((u) => u.id)).toEqual(["bug2", "bug2"]);
    // A real rename of either one onto a name the other holds is still refused.
    expect((await patch("bug2", { singular: "Bug " })).status).toBe(200); // its own name in another case, trimmed
    expect((await patch("bug2", { singular: "Milestone" })).status).toBe(409);
  });
});
