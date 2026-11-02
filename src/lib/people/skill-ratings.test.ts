// A manager's rating of a skill belongs to the workspace it was given in
// (docs/plans/workspace-status.md, the final review, security M2;
// src/lib/people/skill-ratings.ts). Run through the real Skills page read,
// its export and the rating write, on the in-memory database.
//
// The case: A's manager rated Pat's "Negotiation" 1 of 5. A removed her
// (D3) and her account moved to B. Before, B's Admins read A's 1 on her
// record and in the Skills page's Gap and Expert chips, and B's rating
// overwrote it, so A's assessment was gone if she came back.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

const st = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: async () => null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/activity", () => ({ logAuditEvent: async () => undefined, logActivity: async () => undefined }));
vi.mock("@/lib/access/tab-workspace-check", () => ({ staleTabRefusal: async () => null }));
vi.mock("@/lib/people/person-access.server", async (orig) => ({ ...(await orig<typeof import("@/lib/people/person-access.server")>()), peopleCtx: async () => st.ctx }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { ratingHere, withRatingHere } from "./skill-ratings";
import { GET as skills } from "@/app/api/skills/route";
import { GET as exportSkills } from "@/app/api/skills/export/route";
import { PATCH as rate } from "@/app/api/users/[id]/skills/[skillId]/route";

/** An Admin of `organizationId`. */
const adminOf = (organizationId: string) => ({ userId: `admin-${organizationId}`, organizationId, ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set<string>(), writeChain: new Set<string>(), viewer: {} });
const read = async () => (await (await skills(new NextRequest("https://app.test/api/skills"))).json()) as { data: Array<{ name: string; avgManager: number | null; people: Array<{ userId: string; managerRating: number | null }> }> };
const patch = (body: unknown) => rate(new NextRequest("https://app.test/api/users/pat/skills/s1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "pat", skillId: "s1" }) });
const skill = () => db.row("userSkill", "s1");

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE", settings: {} });
  // Pat, now anchored in B (A removed her, D3), with A's rating of her skill:
  // the old column holds it, and the deploy keyed it by A (the SQL file's step three).
  db.seed("user", { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "Lee", organizationId: "b", ...legacyLevelRow("EMPLOYEE"), deletedAt: null, avatar: null, departmentId: null });
  db.seed("userSkill", { id: "s1", userId: "pat", name: "Negotiation", selfRating: 3, managerRating: 1, managerRatings: { a: 1 }, updatedAt: new Date("2026-10-01T00:00:00Z") });
  st.ctx = adminOf("b");
});

describe("the manager rating is each workspace's own (security M2)", () => {
  it("B never reads A's rating, on the Skills page or in its export", async () => {
    const body = await read();
    // Before: 1, A's, and the Gap chip counted it.
    expect(body.data[0].people.find((p) => p.userId === "pat")?.managerRating).toBeNull();
    expect(body.data[0].avgManager).toBeNull();
    const csv = await (await exportSkills()).text();
    expect(csv.split("\n")[1]).toMatch(/,3,$/);
  });

  it("B's rating sets B's key only, and A's stays: A reads its own again when she is back", async () => {
    const res = await patch({ managerRating: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "s1", managerRating: 4 });
    // Before: managerRating 4 on the one column, A's 1 gone.
    expect(skill().managerRatings).toEqual({ a: 1, b: 4 });
    expect((await read()).data[0].people[0].managerRating).toBe(4);
    db.row("user", "pat").organizationId = "a";
    st.ctx = adminOf("a");
    expect((await read()).data[0].people[0].managerRating).toBe(1);
  });

  it("clearing B's rating takes out B's key only", async () => {
    skill().managerRatings = { a: 1, b: 4 };
    expect((await patch({ managerRating: null })).status).toBe(200);
    expect(skill().managerRatings).toEqual({ a: 1 });
  });

  it("a rating another workspace wrote a moment before is never lost: the write is made again on the row as it is now", async () => {
    let first = true;
    db.onCall = (entry) => {
      if (entry !== "userSkill.updateMany" || !first) return;
      first = false;
      // Another workspace's write lands between this one's read and its write.
      Object.assign(skill(), { managerRatings: { a: 2 }, updatedAt: new Date("2026-10-02T00:00:00Z") });
    };
    expect((await patch({ managerRating: 5 })).status).toBe(200);
    expect(skill().managerRatings).toEqual({ a: 2, b: 5 });
  });

  it("ratingHere and withRatingHere read and write one key, keeping every other", () => {
    expect(ratingHere({ a: 1, b: 4 }, "b")).toBe(4);
    expect(ratingHere({ a: 1 }, "b")).toBeNull();
    expect(ratingHere(null, "b")).toBeNull();
    expect(ratingHere({ b: 9 }, "b")).toBeNull();
    expect(withRatingHere({ a: 1 }, "b", 3)).toEqual({ a: 1, b: 3 });
    expect(withRatingHere({ a: 1, b: 3 }, "b", null)).toEqual({ a: 1 });
    expect(withRatingHere(null, "b", 2)).toEqual({ b: 2 });
  });
});
