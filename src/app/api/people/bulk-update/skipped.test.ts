// POST /api/people/bulk-update says how many of the skipped work here
// through a membership (docs/plans/workspace-status.md, the final review,
// product L5): their details here are read-only for now, so Members' toast
// says why they were skipped, apart from the people not the caller's to
// change. Run on the in-memory database.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/access/tab-workspace-check", () => ({ staleTabRefusal: async () => null }));
vi.mock("@/lib/access/flags", () => ({ accessV2Resolver: () => false }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/person-access.server")>()),
  peopleCtx: async () => ({ userId: "u-admin", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set(), writeChain: new Set(), viewer: {} }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { POST } from "./route";

const move = (userIds: string[]) => POST(new NextRequest("https://app.test/api/people/bulk-update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userIds, action: "change_department", payload: { departmentId: "dep-b" } }) }));

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("department", { id: "dep-b", name: "Delivery", organizationId: "b" });
  db.seed("user", { id: "u-admin", email: "admin@x.test", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN") });
  db.seed("user", { id: "bea", email: "bea@x.test", organizationId: "b", departmentId: null });
  db.seed("user", { id: "pat", email: "pat@x.test", organizationId: "a", departmentId: null });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b" });
});

describe("bulk Change department and the people it skips (product L5)", () => {
  it("moves the people anchored here and counts the membership people it skipped, apart", async () => {
    const res = await move(["bea", "pat", "u-admin"]);
    const body = await res.json();
    // Before: { skipped: 2 } and no reason, so Members said "1 moved".
    expect(body).toMatchObject({ updated: 1, skipped: 2, skippedElsewhere: 1 });
    expect(db.row("user", "bea").departmentId).toBe("dep-b");
    expect(db.row("user", "pat").departmentId).toBeNull();
  });
});
