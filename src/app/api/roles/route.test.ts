// POST /api/roles and PUT/PATCH /api/roles/[id] (final Settings review,
// M2): a job title already in use here, in any case, is refused with a 409
// in plain words, on create and on rename. Role's unique (title,
// organizationId) is exact, so "designer" beside "Designer" was accepted and
// an exact copy was an unhandled 500; a write that races past the check and
// meets the index (P2002) is a 409 too.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; title: string; level: string };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: string; data: Record<string, unknown> }>,
  /** The next write meets the unique index (a write that raced the check). */
  race: false,
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

const unique = () => Object.assign(new Error("Unique constraint failed on the fields: (`title`,`organizationId`)"), { code: "P2002" });

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => st.rows.find((r) => matches(r, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (st.race) { st.race = false; throw unique(); }
        st.created.push(data);
        return { id: "new", ...data };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (st.race) { st.race = false; throw unique(); }
        st.updated.push({ id: where.id, data });
        return { ...st.rows.find((r) => r.id === where.id), ...data };
      },
    },
    department: { count: async () => 1 },
  },
}));
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org1" } } }),
  getOrgId: () => "org1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  LOOKUP_CACHE_HEADERS: {},
}));
vi.mock("@/lib/page-gates", () => ({ sessionOnLegacyManagerTier: async () => true }));
vi.mock("@/lib/access/viewer", () => ({ viewerFromSession: async () => null }));

import { POST } from "./route";
import { PATCH, PUT } from "./[id]/route";

const role = (id: string, title: string, extra: Partial<Row> = {}): Row => ({ id, organizationId: "org1", title, level: "EMPLOYEE", ...extra });
const post = (body: unknown) => POST(new NextRequest("http://x/api/roles", { method: "POST", body: JSON.stringify(body) }));
const put = (id: string, body: unknown) =>
  PUT(new NextRequest(`http://x/api/roles/${id}`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  st.rows = [role("des", "Designer"), role("eng", "Engineer"), role("other", "Analyst", { organizationId: "org2" })];
  st.created = [];
  st.updated = [];
  st.race = false;
});

describe("POST: a job title in use, in any case, is refused", () => {
  it("answers 409 for \"designer\" when Designer exists, names the title that holds it, and creates nothing", async () => {
    const r = await post({ title: "designer" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "A job title called Designer already exists." });
    expect((await post({ title: "  ENGINEER " })).status).toBe(409);
    expect(st.created).toEqual([]);

    // A title only another workspace holds is free here.
    expect((await post({ title: "Analyst" })).status).toBe(201);
    expect(st.created).toHaveLength(1);
  });

  it("a create that raced another onto the same name meets the unique index: a 409 in words, never a 500", async () => {
    st.race = true;
    const r = await post({ title: "Writer" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("A job title called Writer already exists.");
  });
});

describe("PUT and PATCH: a rename may not take a name another title holds", () => {
  it("answers 409 for renaming Engineer to \"DESIGNER\", and writes nothing", async () => {
    const r = await put("eng", { title: "DESIGNER" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("A job title called Designer already exists.");
    expect(st.updated).toEqual([]);

    // Its own name in another case, or a free name, goes through; PATCH is the same edit.
    expect((await put("eng", { title: "engineer" })).status).toBe(200);
    expect(PATCH).toBe(PUT);
    expect((await PATCH(new NextRequest("http://x/api/roles/eng", { method: "PATCH", body: JSON.stringify({ title: "Developer" }) }), { params: Promise.resolve({ id: "eng" }) })).status).toBe(200);
    expect(st.updated.map((u) => u.data.title)).toEqual(["engineer", "Developer"]);
  });

  it("a rename that raced another onto the same name is a 409 too", async () => {
    st.race = true;
    const r = await put("eng", { title: "Architect" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("A job title called Architect already exists.");
  });
});
