// GET /api/search: the command palette's people, for a Guest
// (docs/plans/workspace-status-2.md step 6, its review M4). A Guest finds
// only the people they share a conversation with, the people picker's rule
// (access 11 invariant 3), never the staff list, and someone who works here
// through a membership is found by the same rule. The people are read on the
// in-memory database (seat-test-db.ts); every other kind of record answers
// none, as each has its own suite.
//
// The case of step 6: Pat is anchored at her agency A and works at client B
// through a live membership; Bea is anchored at B; Gus is a Guest in B who
// shares a conversation with Bea only; Dana is a Manager in B.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow, legacyTestSession } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ me: "gus", level: "GUEST" }));

const PEOPLE_MODELS = new Set(["user", "organizationMembership", "conversationMember", "conversation", "department", "role"]);
vi.mock("@/lib/prisma", async () => {
  const { seatDb } = await import("@/lib/access/seat-test-db");
  const none = { findMany: async () => [], findFirst: async () => null, findUnique: async () => null, count: async () => 0 };
  return { prisma: new Proxy({}, { get: (_t, k: string) => (PEOPLE_MODELS.has(k) ? (seatDb.prisma as Record<string, unknown>)[k] : none) }) };
});
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: legacyTestSession(st.me, st.level, "b") }),
  getOrgId: () => "b",
}));
vi.mock("@/lib/entitlements", () => ({ isModuleActive: async () => false }));
vi.mock("@/lib/access/node-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/access/node-access")>()),
  idsWithRole: async () => new Set<string>(),
  nodeRoles: async () => new Map(),
}));
vi.mock("@/lib/sop-access", () => ({ sopVisibilityWhere: async () => ({}) }));
vi.mock("@/lib/goal-audience", async (orig) => ({ ...(await orig<typeof import("@/lib/goal-audience")>()), goalVisibilityOr: async () => [] }));
vi.mock("@/lib/user-tags", () => ({ getUserTagIds: async () => [] }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET } from "./route";

async function people(q: string): Promise<string[]> {
  const res = await GET(new NextRequest(`https://app.test/api/search?q=${encodeURIComponent(q)}`));
  const rows = (await res.json()) as Array<{ type: string; id: string }>;
  return rows.filter((r) => r.type === "person").map((r) => r.id).sort();
}

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, departmentId: null, roleId: null, officeId: null,
    joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"), ...over,
  });
}

beforeEach(() => {
  db.reset();
  st.me = "gus";
  st.level = "GUEST";
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}` });
  person("dana", "b", { ...legacyLevelRow("MANAGER") });
  person("bea", "b");
  person("gus", "b");
  person("pat", "a");
  db.seed("organizationMembership", { id: "m-pat", userId: "pat", organizationId: "b", createdAt: new Date("2026-06-01") });
  db.seed("conversation", { id: "c-g", organizationId: "b", type: "DM" });
  db.seed("conversationMember", { id: "cm1", conversationId: "c-g", userId: "gus" });
  db.seed("conversationMember", { id: "cm2", conversationId: "c-g", userId: "bea" });
});

describe("the command palette's people for a Guest (M4)", () => {
  it("names only the people in the Guest's own conversations (Bea, and the Guest), never Dana or Pat", async () => {
    expect(await people("lee")).toEqual(["bea", "gus"]);
    expect(await people("pat")).toEqual([]);
    expect(await people("dana")).toEqual([]);
  });

  it("names a person here through a membership once they share a conversation", async () => {
    db.seed("conversationMember", { id: "cm3", conversationId: "c-g", userId: "pat" });
    expect(await people("lee")).toEqual(["bea", "gus", "pat"]);
  });

  it("names nobody to a Guest who shares no conversation", async () => {
    st.me = "dee";
    person("dee", "b");
    expect(await people("lee")).toEqual([]);
  });

  it("still names everyone here, both kinds, to a Member", async () => {
    st.me = "dana";
    st.level = "MANAGER";
    expect(await people("lee")).toEqual(["bea", "dana", "gus", "pat"]);
  });
});
