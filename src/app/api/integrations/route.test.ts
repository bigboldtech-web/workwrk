// Writing a workspace connection is for Owners and Admins only (launch audit,
// 2026-10-31). A connection's config holds its ingest secret, and whoever
// holds it can record KPI readings, kudos and tasks in anyone's name through
// /api/integrations/ingest; the legacy manager tier let a Director or VP
// create one, overwrite an Admin's Slack row, or delete it.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  orgRole: "MEMBER" as string,
  stale: false,
  writes: [] as string[],
  existing: null as null | { id: string },
}));

vi.mock("@/lib/app-gate", () => ({
  requireApp: async () => ({ viewer: { userId: "u1", organizationId: "o1", orgRole: st.orgRole } }),
  isOwnerOrAdmin: (v: { orgRole: string }) => v.orgRole === "OWNER" || v.orgRole === "ADMIN",
}));
vi.mock("@/lib/access/tab-workspace-check", () => ({
  staleTabRefusal: async () => (st.stale ? Response.json({ error: "workspace_changed" }, { status: 409 }) : null),
}));
vi.mock("@/lib/integrations/registry", () => ({ filterConnectors: () => [] }));
vi.mock("@/services/googleCalendar", () => ({ isGoogleEnabled: () => false }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: {
      findUnique: async () => st.existing,
      findFirst: async () => ({ id: "i1", organizationId: "o1" }),
      create: async (a: { data: Record<string, unknown> }) => { st.writes.push("create"); return { id: "i2", ...a.data }; },
      update: async () => { st.writes.push("update"); return { id: "i1" }; },
      delete: async () => { st.writes.push("delete"); return { id: "i1" }; },
    },
  },
}));

import { POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const body = { name: "Hook", type: "CUSTOM_WEBHOOK", config: { url: "https://example.com", ingestSecret: "s" } };
const post = () => POST(new NextRequest("http://x/api/integrations", { method: "POST", body: JSON.stringify(body) }));
const params = { params: Promise.resolve({ id: "i1" }) };
const patch = () => PATCH(new NextRequest("http://x/api/integrations/i1", { method: "PATCH", body: JSON.stringify({ config: { ingestSecret: "mine" } }) }), params);
const del = () => DELETE(new NextRequest("http://x/api/integrations/i1", { method: "DELETE" }), params);

beforeEach(() => {
  st.orgRole = "MEMBER";
  st.stale = false;
  st.writes = [];
  st.existing = null;
});

describe("workspace connections", () => {
  it("refuses a Member, whatever their legacy tier, to create, change or delete one, and writes nothing", async () => {
    for (const run of [post, patch, del]) expect((await run()).status).toBe(403);
    expect(st.writes).toEqual([]);
  });

  it("refuses a Member who would overwrite an Admin's existing row of the same type", async () => {
    st.existing = { id: "slack-of-admin" };
    expect((await post()).status).toBe(403);
    expect(st.writes).toEqual([]);
  });

  it("lets an Owner or Admin create, change and delete one", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      st.orgRole = role;
      st.writes = [];
      expect((await post()).status).toBe(201);
      expect((await patch()).status).toBe(200);
      expect((await del()).status).toBe(200);
      expect(st.writes).toEqual(["create", "update", "delete"]);
    }
  });

  it("refuses a write from a tab left open on another workspace", async () => {
    st.orgRole = "ADMIN";
    st.stale = true;
    for (const run of [post, patch, del]) expect((await run()).status).toBe(409);
    expect(st.writes).toEqual([]);
  });
});
