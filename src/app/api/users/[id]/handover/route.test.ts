// POST /api/users/[id]/handover and its preview. Docs-found fixes batch 5,
// from the batch 4 review:
//   - When the reports moved and the work did not (the WORK transaction
//     failed after LINES committed), the route answered a bare 500, so the
//     admin was never told the reports had already moved, and a retry's
//     "0 direct reports" was the only record. Now a 503 handover_partial
//     that says exactly that.
//   - The person picked to take the work had to be anchored here, so an
//     Owner who works here through a membership (last switched to another
//     workspace) was "not found", though the handover itself takes them.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({
  /** People, by id: where each is anchored, and whether they have a membership here. */
  people: {} as Record<string, { organizationId: string; member?: boolean; status?: string; deletedAt?: Date | null; firstName: string; lastName: string; managerId?: string | null }>,
  outcome: "done" as "done" | "partial" | "busy",
  ran: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-helpers", () => ({
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "org" } } }),
  getOrgId: () => "org",
  getUserId: () => "u-admin",
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  jsonSuccess: (data: unknown, status = 200) => Response.json(data, { status }),
}));
vi.mock("@/lib/people/person-access.server", () => ({
  peopleCtx: async () => ({ userId: "u-admin", organizationId: "org", isAdmin: true, managerTier: true }),
  relationTo: () => "admin",
}));
vi.mock("@/lib/activity", () => ({ logActivity: (row: Record<string, unknown>) => { st.logs.push(row); } }));
vi.mock("@/lib/prisma", () => {
  type W = { id?: string | { in: string[] }; organizationId?: string; deletedAt?: null; managerId?: string };
  const match = (id: string, w: W) => {
    const p = st.people[id];
    if (!p) return false;
    if (typeof w.id === "string" && w.id !== id) return false;
    if (w.id && typeof w.id === "object" && !w.id.in.includes(id)) return false;
    if (w.organizationId !== undefined && p.organizationId !== w.organizationId) return false;
    if ("deletedAt" in w && p.deletedAt) return false;
    if (w.managerId !== undefined && p.managerId !== w.managerId) return false;
    return true;
  };
  const row = (id: string) => ({ id, ...st.people[id], status: st.people[id].status ?? "ACTIVE", ...legacyLevelRow("EMPLOYEE") });
  const user = {
    findFirst: async (a: { where: W }) => { const id = Object.keys(st.people).find((x) => match(x, a.where)); return id ? row(id) : null; },
    findMany: async (a: { where: W }) => Object.keys(st.people).filter((x) => match(x, a.where)).map(row),
  };
  const organizationMembership = {
    findMany: async (a: { where: { userId: { in: string[] } } }) => a.where.userId.in.filter((id) => st.people[id]?.member).map((userId) => ({ userId, role: "SUPER_ADMIN" })),
  };
  const none = { findMany: async () => [] };
  return { prisma: { user, organizationMembership, item: none, oKR: none, kRAAssignment: none, asset: none, space: none, folder: none, board: none } };
});
vi.mock("@/lib/people/handover.server", async (orig) => {
  const real = await orig<typeof import("@/lib/people/handover.server")>();
  return {
    isOpenStatus: real.isOpenStatus,
    isHandoverWorkFailed: real.isHandoverWorkFailed,
    previewReportHandover: async () => ({ reports: 0, toRecipient: 0, recipientIsAgent: false, rehomed: [] }),
    runHandover: async (input: Record<string, unknown>) => {
      st.ran.push(input);
      if (st.outcome === "busy") throw Object.assign(new Error("busy"), { name: "OrgRolesBusy" });
      if (st.outcome === "partial") {
        throw new real.HandoverWorkFailed(
          { reportsReassigned: 1, reportsRehomed: [{ id: "r2", name: "Kim", managerId: null, managerName: null }], reportsMoved: 2 },
          new Error("timeout"),
        );
      }
      return { tasksReassigned: 3, reportsReassigned: 2, containersReassigned: 1, reportsRehomed: [] };
    },
  };
});

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "u-leo" }) };
const post = (reassignToId: string) =>
  POST(new NextRequest("https://app.test/api/users/u-leo/handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reassignToId }) }), params);

beforeEach(() => {
  st.people = {
    "u-leo": { organizationId: "org", firstName: "Leo", lastName: "Leaver" },
    "u-rae": { organizationId: "org", firstName: "Rae", lastName: "Recipient" },
    // Olga is an Owner here who last switched to another workspace.
    "u-olga": { organizationId: "client", member: true, firstName: "Olga", lastName: "Owner" },
    // Fay is in another workspace only.
    "u-fay": { organizationId: "client", firstName: "Fay", lastName: "Far" },
  };
  st.outcome = "done";
  st.ran = [];
  st.logs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the handover's answer when the reports moved and the work did not", () => {
  it("is a 503 handover_partial that says so, with what moved, and no handover row claiming it all moved", async () => {
    st.outcome = "partial";
    const res = await post("u-rae");
    // Before: the WORK error rethrown, a bare 500.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = await res.json();
    expect(body).toEqual({
      error: "Their 2 direct reports moved, but their open tasks and their Spaces, Folders and Lists didn't. Try again to move the rest.",
      code: "handover_partial",
      partial: { reportsReassigned: 1, reportsRehomed: [{ id: "r2", name: "Kim", managerId: null, managerName: null }], reportsMoved: 2, tasksReassigned: 0, containersReassigned: 0 },
    });
    expect(st.logs.filter((l) => l.type === "user_handover")).toEqual([]);
  });

  it("a busy role lock is still the 503 roles_busy, and a full run is still logged", async () => {
    st.outcome = "busy";
    expect((await (await post("u-rae")).json()).code).toBe("roles_busy");
    st.outcome = "done";
    const res = await post("u-rae");
    expect(res.status).toBe(200);
    expect(st.logs.filter((l) => l.type === "user_handover")).toHaveLength(1);
  });
});

describe("the person picked to take the work", () => {
  it("may work here through a membership: an Owner anchored in another workspace takes it", async () => {
    const res = await post("u-olga");
    // Before: 404 "Reassignment target not found or inactive".
    expect(res.status).toBe(200);
    expect(st.ran[0]).toMatchObject({ fromId: "u-leo", toId: "u-olga" });
    const preview = await GET(new NextRequest("https://app.test/api/users/u-leo/handover?to=u-olga"), params);
    expect(preview.status).toBe(200);
  });

  it("is never someone who holds no level here", async () => {
    const res = await post("u-fay");
    expect(res.status).toBe(404);
    expect(st.ran).toEqual([]);
  });

  it("the summary lists a direct report who works here through a membership", async () => {
    st.people["u-rio"] = { organizationId: "client", member: true, firstName: "Rio", lastName: "Ray", managerId: "u-leo" };
    st.people["u-fay"].managerId = "u-leo";
    const res = await GET(new NextRequest("https://app.test/api/users/u-leo/handover"), params);
    const body = await res.json();
    // Before: only reports anchored here, so the summary said none.
    expect(body.directReports).toEqual({ count: 1, items: [expect.objectContaining({ id: "u-rio" })] });
  });
});
