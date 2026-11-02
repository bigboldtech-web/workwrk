// GET /api/settings/billing-summary: the seats in use and the people named
// as "in through another workspace" read this workspace's seat
// (docs/plans/workspace-status.md D12): a membership counts, and is named,
// only while its seat here is live, whatever the account's status where it
// is anchored. Run on the in-memory database with the real seat count.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: "bo", organizationId: "b" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/workspace-admin", () => ({ sessionMayManageOwnerPage: async () => true }));
vi.mock("@/services/billing", () => ({ isBillingLive: false, priceConfigured: () => false, subscriptionStillOpen: async () => false }));
vi.mock("@/lib/ai-allowance", () => ({ aiQuestionsUsed: async () => 0 }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET } from "./route";

beforeEach(() => {
  db.reset();
  // The open invitations' count (seats.ts openInvitedAddresses): none.
  db.onQueryRaw = () => [{ n: 0 }];
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", plan: "STARTER", settings: {} });
  db.seed("user", { id: "bo", email: "bo@x.test", firstName: "Bo", lastName: "Lee", organizationId: "b", ...legacyLevelRow("COMPANY_ADMIN") });
  for (const [id, seat] of [["cy", {}], ["dee", { status: "INACTIVE" }], ["eve", { removedAt: new Date("2026-10-01") }]] as const) {
    db.seed("user", { id, email: `${id}@x.test`, firstName: id, lastName: "Lee", organizationId: "a" });
    db.seed("organizationMembership", { id: `m-${id}`, userId: id, organizationId: "b", createdAt: new Date("2026-05-01"), ...seat });
  }
});

describe("Plan & billing counts and names the live seats here (D12)", () => {
  it("counts and names a member here through a live seat, never one this workspace ended", async () => {
    const body = await (await GET()).json();
    // Before: 4 seats in use, and Dee and Eve named, their accounts live in A.
    expect(body.usage.members).toBe(2);
    expect(body.fromOtherWorkspaces.map((p: { id: string }) => p.id)).toEqual(["cy"]);
  });
});
