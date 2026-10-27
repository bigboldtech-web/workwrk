// POST /api/tags and PATCH /api/tags/[id] (final Settings review, M2): one
// name per tag type, in any case. The unique (org, type, name) index is
// exact, so a create refused only an exact copy and a rename onto one was an
// unhandled 500 (P2002). Now a live tag of that name refuses a create in
// words, an archived one is brought back, a rename onto another tag's name
// is a 409, and a rename that races past the check and meets the index is a
// 409 too.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; type: string; name: string; archived: boolean; color: string | null; description: string | null };

const st = vi.hoisted(() => ({
  rows: [] as Row[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: string; data: Record<string, unknown> }>,
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tag: {
      findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { archived?: "asc" } }) => {
        const found = st.rows.filter((r) => matches(r, where));
        if (orderBy?.archived === "asc") found.sort((a, b) => Number(a.archived) - Number(b.archived));
        return found[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => { st.created.push(data); return { id: "new", ...data }; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (st.race) { st.race = false; throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" }); }
        st.updated.push({ id: where.id, data });
        return { ...st.rows.find((r) => r.id === where.id), ...data };
      },
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

import { POST } from "./route";
import { PATCH } from "./[id]/route";

const tag = (id: string, name: string, extra: Partial<Row> = {}): Row => ({ id, organizationId: "org1", type: "CUSTOM", name, archived: false, color: null, description: null, ...extra });
const post = (body: unknown) => POST(new NextRequest("http://x/api/tags", { method: "POST", body: JSON.stringify(body) }));
const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://x/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  st.rows = [tag("urg", "Urgent"), tag("old", "Legacy", { archived: true }), tag("emea", "EMEA", { type: "REGION" }), tag("x", "Blocked", { organizationId: "org2" })];
  st.created = [];
  st.updated = [];
  st.race = false;
});

describe("POST: a tag name in use, in any case, is refused", () => {
  it("answers 409 for \"urgent\" when Urgent exists, names the tag that holds it, and creates nothing", async () => {
    const r = await post({ name: "urgent", type: "CUSTOM" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "A tag called Urgent already exists." });
    expect(st.created).toEqual([]);
  });

  it("brings an archived tag of that name back, in any case, instead of a copy", async () => {
    const r = await post({ name: "LEGACY", type: "CUSTOM" });
    expect(r.status).toBe(200);
    expect(st.updated).toEqual([{ id: "old", data: { archived: false, color: null, description: null } }]);
    expect(st.created).toEqual([]);
  });

  it("a live tag wins over an archived one stored in another case before the rule", async () => {
    st.rows.push(tag("urg-old", "URGENT", { archived: true }));
    expect((await post({ name: "Urgent", type: "CUSTOM" })).status).toBe(409);
    expect(st.updated).toEqual([]);
  });

  it("the same name under another type, or in another workspace, is free", async () => {
    expect((await post({ name: "emea", type: "CUSTOM" })).status).toBe(201);
    expect((await post({ name: "Blocked", type: "CUSTOM" })).status).toBe(201);
    expect(st.created).toHaveLength(2);
  });
});

describe("PATCH: a rename may not take a name another tag of its type holds", () => {
  it("answers 409 for renaming Legacy to \"urgent\", and writes nothing", async () => {
    const r = await patch("old", { name: "urgent" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("A tag called Urgent already exists.");
    expect(st.updated).toEqual([]);

    // Its own name in another case, or a free name, goes through.
    expect((await patch("urg", { name: "URGENT" })).status).toBe(200);
    expect((await patch("urg", { name: "Now" })).status).toBe(200);
    expect(st.updated.map((u) => u.data.name)).toEqual(["URGENT", "Now"]);
  });

  it("a rename that raced another onto the same name meets the unique index: a 409 in words, never a 500", async () => {
    st.race = true;
    const r = await patch("urg", { name: "Soon" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("A tag called Soon already exists.");
  });
});
