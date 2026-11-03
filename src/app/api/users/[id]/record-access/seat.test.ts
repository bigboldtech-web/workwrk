// "Who can see this record" answers for everyone with a seat here
// (docs/plans/workspace-status.md, the final review, product M3): someone
// who works here through a membership too, whose record opens since step 3.
// Before, the menu item answered 404 for them. Run on the in-memory database.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/people/person-access.server")>()),
  peopleCtx: async () => ({ userId: "u-me", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", isAgent: false, isAdmin: false, peopleTeam: false, orgWide: false, managerTier: false, chain: new Set(), writeChain: new Set(), viewer: {} }),
}));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { GET } from "./route";

const ask = (id: string) => GET(new NextRequest(`https://app.test/api/users/${id}/record-access`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  db.seed("user", { id: "olga", email: "olga@x.test", firstName: "Olga", lastName: "Ng", avatar: null, organizationId: "b", ...legacyLevelRow("SUPER_ADMIN"), managerId: null });
  db.seed("user", { id: "mo", email: "mo@x.test", firstName: "Mo", lastName: "Ray", avatar: null, organizationId: "b", ...legacyLevelRow("MANAGER"), managerId: null });
  // Pat: anchored in A, here through a membership, reporting to Mo.
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "Lee", avatar: null, organizationId: "a", ...legacyLevelRow("EMPLOYEE"), managerId: "mo" });
  db.seed("organizationMembership", { id: "m-pat-b", userId: "pat", organizationId: "b", role: "EMPLOYEE" });
  db.seed("user", { id: "ned", email: "ned@x.test", firstName: "Ned", lastName: "Fox", avatar: null, organizationId: "a", ...legacyLevelRow("EMPLOYEE"), managerId: null });
});

describe("Who can see this record, for a membership person (product M3)", () => {
  it("answers with the same groups as for anyone, their manager here on the line", async () => {
    const res = await ask("pat");
    // Before: 404.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: { id: string }; groups: Array<{ key: string; people: Array<{ id: string }> }> };
    expect(body.subject.id).toBe("pat");
    expect(body.groups.find((g) => g.key === "chain")?.people.map((p) => p.id)).toEqual(["mo"]);
    expect(body.groups.find((g) => g.key === "admin")?.people.map((p) => p.id)).toEqual(["olga"]);
  });

  it("is still the 404 for someone with no seat here", async () => {
    expect((await ask("ned")).status).toBe(404);
  });
});
