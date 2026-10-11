// POST /api/spaces/[id]/duplicate makes a new Space. Docs-found fixes batch
// 2: an Agent never creates a Space (AGENT_TIER_BLURB, the engine's
// create_space verb), and Full access on the Space being copied used to let
// one make a copy anyway.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ level: "AGENT", created: 0 }));

vi.mock("next-auth", () => ({ getServerSession: async () => legacyTestSession("u1", st.level) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    space: {
      findFirst: async () => ({ id: "s1", name: "Support", description: null, icon: null, color: null, visibility: "WORKSPACE", settings: {}, parentSpaceId: null, displayOrder: 0 }),
      create: async () => { st.created += 1; return { id: "s2", slug: "support-copy", name: "Support (copy)" }; },
    },
    spaceMember: { create: async () => ({}) },
    folder: { findMany: async () => [] },
    board: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/space", () => ({
  canContributeSpace: async () => true,
  canEditSpace: async () => true,
  getSpaceForReader: async () => ({ id: "s1" }),
  uniqueSpaceSlug: async () => "support-copy",
}));
vi.mock("@/lib/board", () => ({ duplicateBoard: async () => ({ id: "b2" }) }));
vi.mock("@/lib/access/node-access", () => ({ nodeCtxFromLevel: () => ({}), nodeRoles: async () => new Map() }));
vi.mock("@/lib/access/node-rules", () => ({ refKey: () => "", roleAtLeast: () => true }));

import { POST } from "./route";

const dup = () => POST(new Request("https://app.test/api/spaces/s1/duplicate", { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: "s1" }) });

beforeEach(() => { st.created = 0; });

describe("duplicating a Space", () => {
  it("refuses an Agent with Full access, in the engine's words, and makes nothing", async () => {
    st.level = "AGENT";
    const res = await dup();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Agents never create spaces." });
    expect(st.created).toBe(0);
  });

  it("still copies for anyone else with Full access", async () => {
    st.level = "EMPLOYEE";
    const res = await dup();
    expect(res.status).toBe(200);
    expect(st.created).toBe(1);
  });
});
