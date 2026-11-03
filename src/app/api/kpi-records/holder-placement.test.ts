// GET /api/kpi-records names each holder's department as THIS workspace
// holds it (docs/plans/workspace-status.md, the final review, security M1;
// D18): the account's own for someone anchored here, the membership's here
// for someone who works here through one. Run on the in-memory database.
//
// The case: Pat works in B through a membership and is anchored at her
// agency A, so her account's department is A's "Platform". She holds B's
// KPI records from when she was anchored in B. Before, B's managers, People
// team and Admins read "Platform" beside her readings.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("@/lib/api-helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-helpers")>()),
  getSessionOrFail: async () => ({ error: null, session: { user: { id: "u-admin", organizationId: "b" } } }),
  getOrgId: () => "b",
  getUserId: () => "u-admin",
}));
// An Admin of B reads the whole workspace.
vi.mock("@/lib/alignment-scope", () => ({ visibleAlignmentUserIds: async () => null, canTouchUserAlignment: async () => true }));
vi.mock("@/lib/kpi-review.server", () => ({ kpiActorCtx: async () => null, mayActOnKpisOf: () => false, notifyKpiRecordedForYou: async () => undefined, notifyKpiSubmitted: async () => undefined }));
vi.mock("@/services/performanceScoreService", () => ({ triggerRecalculation: async () => undefined }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET } from "./route";

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("department", { id: "dep-a", name: "Platform", organizationId: "a" });
  db.seed("department", { id: "dep-b", name: "Delivery", organizationId: "b" });
  db.seed("kPI", { id: "kpi-b", name: "Tickets closed", unit: "count", type: "QUANTITATIVE", lowerIsBetter: false, organizationId: "b" });
  // Pat: anchored in A, in A's department; B's membership holds B's department.
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "Lee", organizationId: "a", departmentId: "dep-a" });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "EMPLOYEE", departmentId: "dep-b" });
  // Bea: anchored in B, in B's department.
  db.seed("user", { id: "bea", email: "bea@x.test", firstName: "Bea", lastName: "Ray", organizationId: "b", departmentId: "dep-b" });
  for (const [id, userId, at] of [["r1", "pat", 2], ["r2", "bea", 1]] as const) {
    db.seed("kPIRecord", { id, kpiId: "kpi-b", userId, period: "2026-10", actualValue: 5, targetValue: 10, score: 50, status: "SUBMITTED", createdAt: new Date(Date.UTC(2026, 9, at)) });
  }
});

describe("GET /api/kpi-records and the holder's department (security M1)", () => {
  it("names the department this workspace holds, never the one of the workspace the account is anchored in", async () => {
    const res = await GET(new NextRequest("https://app.test/api/kpi-records"));
    const body = (await res.json()) as { records: Array<{ id: string; user: { firstName: string; department: { name: string } | null } }> };
    const of = (id: string) => body.records.find((r) => r.id === id)?.user;
    // Before: { name: "Platform" }, A's.
    expect(of("r1")).toEqual({ id: "pat", firstName: "Pat", lastName: "Lee", department: { name: "Delivery" } });
    expect(of("r2")?.department).toEqual({ name: "Delivery" });
    expect(JSON.stringify(body)).not.toContain("Platform");
  });

  it("names none when the membership holds none, or holds another workspace's", async () => {
    db.row("organizationMembership", "m-pat-b").departmentId = null;
    let body = (await (await GET(new NextRequest("https://app.test/api/kpi-records"))).json()) as { records: Array<{ id: string; user: { department: unknown } }> };
    expect(body.records.find((r) => r.id === "r1")?.user.department).toBeNull();
    db.row("organizationMembership", "m-pat-b").departmentId = "dep-a";
    body = (await (await GET(new NextRequest("https://app.test/api/kpi-records"))).json()) as typeof body;
    expect(body.records.find((r) => r.id === "r1")?.user.department).toBeNull();
  });
});
