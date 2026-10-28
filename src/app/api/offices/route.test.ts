// POST and PATCH /api/offices (final Settings review, M2): an office name
// already in use here, in any case, is refused with a 409 in plain words, on
// create and on rename, the way task types refuse a name. There is no unique
// index behind it, so offices stored twice before the rule are still read
// and either can still be edited under the name it has.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; name: string; isHeadquarters: boolean };

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

vi.mock("@/lib/prisma", () => {
  const office = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => st.rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => { st.created.push(data); return { id: "new", ...data }; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      st.updated.push({ id: where.id, data });
      return { ...st.rows.find((r) => r.id === where.id), ...data };
    },
    updateMany: async () => ({ count: 0 }),
  };
  return { prisma: { office, $transaction: async (fn: (tx: unknown) => unknown) => fn({ office }) } };
});
vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u1", organizationId: "org1" } } }),
  getOrgId: () => "org1",
  getUserId: () => "u1",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
  LOOKUP_CACHE_HEADERS: {},
}));
vi.mock("@/lib/access/settings-write", () => ({ settingsWriteGate: async () => ({ ok: true, actor: { ok: true, level: "COMPANY_ADMIN", admin: true, owner: true } }) }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));

import { PATCH, POST } from "./route";

const office = (id: string, name: string, extra: Partial<Row> = {}): Row => ({ id, organizationId: "org1", name, isHeadquarters: false, ...extra });
const post = (body: unknown) => POST(new NextRequest("http://x/api/offices", { method: "POST", body: JSON.stringify(body) }));
const patch = (body: unknown) => PATCH(new NextRequest("http://x/api/offices", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  st.rows = [office("lon", "London"), office("par", "Paris"), office("other", "Berlin", { organizationId: "org2" })];
  st.created = [];
  st.updated = [];
});

describe("POST: an office name in use, in any case, is refused", () => {
  it("answers 409 for \"london\" when London exists, names the office that holds it, and creates nothing", async () => {
    const r = await post({ name: "london" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "An office called London already exists." });
    expect(st.created).toEqual([]);

    // Trimmed first.
    expect((await post({ name: "  PARIS " })).status).toBe(409);
    expect(st.created).toEqual([]);

    // A name only another workspace holds is free here.
    const free = await post({ name: "Berlin" });
    expect(free.status).toBe(201);
    expect(st.created).toHaveLength(1);
    expect(st.created[0]).toMatchObject({ organizationId: "org1", name: "Berlin" });
  });
});

describe("PATCH: a rename may not take a name another office holds", () => {
  it("answers 409 for renaming Paris to \"LONDON\", and writes nothing", async () => {
    const r = await patch({ id: "par", name: "LONDON" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("An office called London already exists.");
    expect(st.updated).toEqual([]);

    // Its own name in another case, a free name, or no name at all, goes through.
    expect((await patch({ id: "par", name: "PARIS" })).status).toBe(200);
    expect((await patch({ id: "par", name: "Lyon" })).status).toBe(200);
    expect((await patch({ id: "par", city: "Paris" })).status).toBe(200);
    expect(st.updated.map((u) => u.data.name)).toEqual(["PARIS", "Lyon", undefined]);
  });

  it("an office stored twice before the rule is still edited under the name it has, but not renamed onto another", async () => {
    st.rows.push(office("lon2", "london"));
    expect((await patch({ id: "lon2", city: "London" })).status).toBe(200);
    expect((await patch({ id: "lon2", name: "London" })).status).toBe(200);
    expect((await patch({ id: "lon2", name: "Paris" })).status).toBe(409);
  });
});
