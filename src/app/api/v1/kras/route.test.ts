// POST /api/v1/kras. Found while refreshing the API reference (2026-10-19):
// a roleId was stored without checking it belongs to this workspace, so a
// key could attach another workspace's role and read its title back on GET;
// and a body of null answered a 500. A role of another workspace answers 400
// now, as POST /people's does, and null reads as an empty body.
//
// GET (the final security review, 2026-10-19): a KRA made before that check
// may still hold another workspace's roleId, and GET returned that role's id
// and title. Now such a KRA comes back with roleId and role null.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  made: [] as Array<{ roleId: string | null; name: string; organizationId: string }>,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: { count: async (a: { where: { id: string; organizationId: string } }) => (a.where.id === "role-mine" && a.where.organizationId === "org" ? 1 : 0) },
    kRA: {
      findMany: async () => st.rows,
      create: async (a: { data: { roleId: string | null; name: string; organizationId: string } }) => {
        st.made.push(a.data);
        return { id: "kra1", name: a.data.name, description: null, category: null, roleId: a.data.roleId, createdAt: new Date() };
      },
    },
  },
}));

import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/kras", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.made = []; st.rows = []; });

describe("POST /api/v1/kras", () => {
  it("never attaches a role of another workspace, or a roleId that is not a string, and makes nothing", async () => {
    for (const roleId of ["role-theirs", 7, ""]) {
      const res = await post({ name: "Support", roleId });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "roleId is not a role of this workspace" });
    }
    expect(st.made).toEqual([]);
  });

  it("attaches this workspace's own role, and none when none is sent", async () => {
    expect((await post({ name: "Support", roleId: "role-mine" })).status).toBe(201);
    expect((await post({ name: "Sales" })).status).toBe(201);
    expect((await post({ name: "Ops", roleId: null })).status).toBe(201);
    expect(st.made.map((m) => [m.name, m.roleId, m.organizationId])).toEqual([["Support", "role-mine", "org"], ["Sales", null, "org"], ["Ops", null, "org"]]);
  });

  it("answers a body of null as an empty one, 400 name required, never a 500", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name required" });
  });
});

describe("GET /api/v1/kras", () => {
  const row = (id: string, role: { id: string; title: string; organizationId: string } | null) => ({
    id, name: id, description: null, category: null, roleId: role?.id ?? null, role, createdAt: new Date("2026-10-01T00:00:00Z"), _count: { kpis: 0, assignments: 0 },
  });

  it("never returns another workspace's role, neither its id nor its title, and keeps this workspace's own", async () => {
    st.rows = [
      row("old", { id: "role-theirs", title: "Their secret title", organizationId: "org-other" }),
      row("mine", { id: "role-mine", title: "Support lead", organizationId: "org" }),
      row("none", null),
    ];
    const res = await GET(new Request("https://app.test/api/v1/kras") as never);
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    expect(text).not.toContain("role-theirs");
    expect(text).not.toContain("Their secret title");
    expect(text).not.toContain("org-other");
    const body = (await res.json()) as { data: Array<{ id: string; roleId: string | null; role: unknown }> };
    expect(body.data.map((k) => [k.id, k.roleId, k.role])).toEqual([
      ["old", null, null],
      ["mine", "role-mine", { id: "role-mine", title: "Support lead" }],
      ["none", null, null],
    ]);
  });
});
