// POST /api/people/bulk-update and the people it skips. The final review of
// docs/plans/workspace-status.md (product L5) counted the people here
// through a membership apart, as `skippedElsewhere`, because their details
// here were read-only. Since docs/plans/workspace-status-2.md step 5 (E7,
// E10) the bulk placement changes reach them, on their membership here, so
// only the people not the caller's to change are skipped, and
// `skippedElsewhere` is 0 (kept in the answer for one release). Run on the
// in-memory database.

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

describe("bulk Change department and the people it skips (product L5, workspace-status-2 step 5)", () => {
  it("moves the people anchored here and the people here through a membership, each on their own row here, and skips only the caller", async () => {
    const res = await move(["bea", "pat", "u-admin"]);
    const body = await res.json();
    // Before step 5: { updated: 1, skipped: 2, skippedElsewhere: 1 }, Pat skipped.
    expect(body).toMatchObject({ updated: 2, skipped: 1, skippedElsewhere: 0 });
    expect(db.row("user", "bea").departmentId).toBe("dep-b");
    // Pat's B department is on her B membership; her account (A's) is untouched.
    expect(db.row("organizationMembership", "m-pat-b").departmentId).toBe("dep-b");
    expect(db.row("user", "pat").departmentId).toBeNull();
  });

  it("skips someone this workspace removed through their membership, writing nothing", async () => {
    db.row("organizationMembership", "m-pat-b").removedAt = new Date("2026-10-01");
    const body = await (await move(["bea", "pat"])).json();
    expect(body).toMatchObject({ updated: 1, skipped: 1, skippedElsewhere: 0 });
    expect(db.row("organizationMembership", "m-pat-b").departmentId ?? null).toBeNull();
  });
});
