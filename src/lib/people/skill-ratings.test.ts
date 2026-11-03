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
import { ratingLabel } from "./skills-aggregate";
import { GET as skills } from "@/app/api/skills/route";
import { GET as exportSkills } from "@/app/api/skills/export/route";
import { DELETE as removeSkill, PATCH as rate } from "@/app/api/users/[id]/skills/[skillId]/route";

/** An Admin of `organizationId`. */
const adminOf = (organizationId: string) => ({ userId: `admin-${organizationId}`, organizationId, ...legacyLevelRow("COMPANY_ADMIN"), orgRole: "ADMIN", isAgent: false, isAdmin: true, peopleTeam: false, orgWide: true, managerTier: true, chain: new Set<string>(), writeChain: new Set<string>(), viewer: {} });
const read = async () => (await (await skills(new NextRequest("https://app.test/api/skills"))).json()) as { data: Array<{ name: string; avgManager: number | null; expert: boolean; gap: boolean; people: Array<{ userId: string; managerRating: number | null }> }> };
const patch = (body: unknown) => rate(new NextRequest("https://app.test/api/users/pat/skills/s1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "pat", skillId: "s1" }) });
const skill = () => db.row("userSkill", "s1");
const remove = () => removeSkill(new NextRequest("https://app.test/api/users/pat/skills/s1", { method: "DELETE" }), { params: Promise.resolve({ id: "pat", skillId: "s1" }) });
const skillGone = () => !db.tables.userSkill.some((r) => r.id === "s1");

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
    // A legacy rating on the old 10-point scale reads as it is (the fixes review M1); nothing else does.
    expect(ratingHere({ b: 9 }, "b")).toBe(9);
    expect(ratingHere({ b: 10 }, "b")).toBe(10);
    for (const odd of [0, 11, 4.5, "4", null]) expect(ratingHere({ b: odd }, "b")).toBeNull();
    expect(withRatingHere({ a: 1 }, "b", 3)).toEqual({ a: 1, b: 3 });
    expect(withRatingHere({ a: 1, b: 3 }, "b", null)).toEqual({ a: 1 });
    expect(withRatingHere(null, "b", 2)).toEqual({ b: 2 });
  });
});

// The fixes review M1: the profile once rated out of 10, and a rating on
// that scale showed as "7/10" (skills-aggregate.ts ratingLabel). Step three
// copied it as it was, and the read took 1 to 5 only, so on the deploy it
// vanished from the Skills page's averages and chips and from the export.
describe("a manager rating on the old 10-point scale shows exactly as before the deploy (fixes review M1)", () => {
  beforeEach(() => {
    // Rated 7 of 10 in B, where she is anchored; the deploy keyed it by B.
    Object.assign(skill(), { managerRating: 7, managerRatings: { b: 7 } });
  });

  it("on the Skills page: her rating, the average and the Expert chip, as on 1dd1ee55", async () => {
    const body = await read();
    // Before: null, null, and no Expert chip (her self rating of 3 alone is no expert).
    expect(body.data[0].people[0].managerRating).toBe(7);
    expect(ratingLabel(body.data[0].people[0].managerRating)).toBe("7/10");
    expect(body.data[0].avgManager).toBe(7);
    expect(body.data[0].expert).toBe(true);
    expect(body.data[0].gap).toBe(false);
  });

  it("in the export: the 7 as stored", async () => {
    const csv = await (await exportSkills()).text();
    // Before: a blank manager rating.
    expect(csv.split("\n")[1]).toMatch(/,3,7$/);
  });

  it("a write stays 1 to 5, and a self rating's answer still carries the legacy 7", async () => {
    const no = await patch({ managerRating: 7 });
    expect(no.status).toBe(400);
    expect(skill().managerRatings).toEqual({ b: 7 });
    st.ctx = { ...adminOf("b"), userId: "pat" };
    const res = await patch({ selfRating: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ selfRating: 4, managerRating: 7 });
  });
});

// The fixes review L2: the row holds every workspace's rating, so B's Admin
// removing Pat's skill took the rating A gave with it, and A found none when
// she was back. Now only the person removes a skill another workspace rated.
describe("a skill another workspace rated is removed by the person only (fixes review L2)", () => {
  it("B's Admin is refused with one sentence while A holds a rating on it, and the row stays", async () => {
    const res = await remove();
    // Before: 200, and A's rating gone with the row.
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This skill has a rating from another workspace, so only they can remove it.", code: "rated_elsewhere" });
    expect(skill().managerRatings).toEqual({ a: 1 });
  });

  it("the person removes it themselves, as before: it is their skill", async () => {
    st.ctx = { ...adminOf("b"), userId: "pat", isAdmin: false, orgWide: false };
    expect((await remove()).status).toBe(200);
    expect(skillGone()).toBe(true);
  });

  it("B's Admin removes it as before when only B rated it, or nobody did", async () => {
    skill().managerRatings = { b: 4 };
    expect((await remove()).status).toBe(200);
    expect(skillGone()).toBe(true);
    db.seed("userSkill", { id: "s1", userId: "pat", name: "Excel", selfRating: 2, managerRating: null, managerRatings: {}, updatedAt: new Date("2026-10-01T00:00:00Z") });
    expect((await remove()).status).toBe(200);
    expect(skillGone()).toBe(true);
  });

  it("a rating A gives between B's read and its removal is seen, and the row stays", async () => {
    skill().managerRatings = {};
    let first = true;
    db.onCall = (entry) => {
      if (entry !== "userSkill.deleteMany" || !first) return;
      first = false;
      // A's manager rates the skill a moment before B's removal lands.
      Object.assign(skill(), { managerRatings: { a: 3 }, updatedAt: new Date("2026-10-02T00:00:00Z") });
    };
    const res = await remove();
    expect(res.status).toBe(403);
    expect(skill().managerRatings).toEqual({ a: 3 });
  });
});
