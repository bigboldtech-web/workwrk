// POST /api/v1/kras. Found while refreshing the API reference (2026-10-19):
// a roleId was stored without checking it belongs to this workspace, so a
// key could attach another workspace's role and read its title back on GET;
// and a body of null answered a 500. A role of another workspace answers 400
// now, as POST /people's does, and null reads as an empty body.

import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ made: [] as Array<{ roleId: string | null; name: string; organizationId: string }> }));

vi.mock("@/lib/api-auth", () => ({
  authenticate: async () => ({ ctx: { organizationId: "org", scopes: ["WRITE"], via: "api_key", apiKeyId: "k1" }, error: null }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    role: { count: async (a: { where: { id: string; organizationId: string } }) => (a.where.id === "role-mine" && a.where.organizationId === "org" ? 1 : 0) },
    kRA: {
      create: async (a: { data: { roleId: string | null; name: string; organizationId: string } }) => {
        st.made.push(a.data);
        return { id: "kra1", name: a.data.name, description: null, category: null, roleId: a.data.roleId, createdAt: new Date() };
      },
    },
  },
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("https://app.test/api/v1/kras", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => { st.made = []; });

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
