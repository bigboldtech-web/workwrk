// access/seated-here.ts: everyone with a seat in one workspace, read at the
// row that holds it (docs/plans/workspace-status-2.md E12 to E14, step 6).
// Run on the in-memory database (seat-test-db.ts), which honours every
// condition it is given and throws on one it does not know.
//
// The people: Pat is anchored at her agency A and works at client B through
// a live membership; Rita is anchored at A and B deactivated her; Rex is
// anchored at A and B removed him; Bea is anchored at B; Zed is anchored at A
// and has no seat in B.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import {
  anchoredAtReach,
  byName,
  capacityHereOf,
  countPeopleHere,
  everyoneHereIds,
  membershipAtReach,
  mergeOrdered,
  peopleHereAmong,
  peopleHereByEmails,
  peopleHereByName,
  personHereByEmail,
  seatedHereAmong,
  standingHere,
  type SeatReach,
} from "./seated-here";

const REACHES: SeatReach[] = ["any", "kept", "live", "active"];

function person(id: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("user", {
    id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Lee", organizationId,
    ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE", deletedAt: null, departmentId: null, roleId: null, officeId: null,
    joinDate: new Date("2025-01-01"), createdAt: new Date("2025-01-01"), weeklyCapacityHours: null, workSchedule: null, ...over,
  });
}
function seat(userId: string, organizationId: string, over: Record<string, unknown> = {}) {
  return db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, createdAt: new Date("2026-06-01"), ...over });
}

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}` });
  person("pat", "a", { ...legacyLevelRow("MANAGER"), departmentId: "dep-a", weeklyCapacityHours: 40, workSchedule: { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8 } });
  seat("pat", "b", { role: "EMPLOYEE", departmentId: "dep-b", roleId: "role-b", weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 }, joinDate: new Date("2026-06-15") });
  person("rita", "a");
  seat("rita", "b", { status: "INACTIVE" });
  person("rex", "a");
  seat("rex", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01") });
  person("bea", "b", { weeklyCapacityHours: 32 });
  person("zed", "a");
});

describe("the two halves", () => {
  it("offer Pat in B at B's values, never Rita, Rex or Zed, for the pickers' reaches", async () => {
    const active = await peopleHereByName({ organizationId: "b", reach: "active", take: 10 });
    expect(active.map((p) => p.id)).toEqual(["bea", "pat"]);
    const pat = active.find((p) => p.id === "pat")!;
    expect(pat.seat).toMatchObject({ kind: "membership", level: "EMPLOYEE", status: "ACTIVE", departmentId: "dep-b", roleId: "role-b", joinDate: new Date("2026-06-15"), accountEnded: false });
    expect((await peopleHereByName({ organizationId: "b", reach: "live", take: 10 })).map((p) => p.id)).toEqual(["bea", "pat"]);
    // Not removed here: Rita, deactivated here, is kept; Rex, removed here, never.
    expect((await peopleHereByName({ organizationId: "b", reach: "kept", take: 10 })).map((p) => p.id)).toEqual(["bea", "pat", "rita"]);
    expect((await peopleHereByName({ organizationId: "b", reach: "any", take: 10 })).map((p) => p.id)).toEqual(["bea", "pat", "rex", "rita"]);
    expect(await countPeopleHere({ organizationId: "b", reach: "live" })).toBe(2);
  });

  it("read A's people the other way round: Pat at A's level and department, nobody of B's", async () => {
    const inA = await peopleHereByName({ organizationId: "a", reach: "active", take: 10 });
    expect(inA.map((p) => p.id)).toEqual(["pat", "rex", "rita", "zed"]);
    expect(inA[0].seat).toMatchObject({ kind: "anchor", level: "MANAGER", departmentId: "dep-a" });
  });

  it("never read the anchored workspace's own stale membership row as the seat", async () => {
    // Bea once left B and came back: B's old membership row says removed.
    seat("bea", "b", { status: "INACTIVE", removedAt: new Date("2026-01-01") });
    const inB = await peopleHereAmong("b", ["bea"], "live");
    expect(inB.get("bea")?.seat.kind).toBe("anchor");
    expect((await peopleHereByName({ organizationId: "b", reach: "live", take: 10 })).filter((p) => p.id === "bea")).toHaveLength(1);
  });

  it("need a live seat's account not ended (D12)", async () => {
    db.row("user", "pat").status = "INACTIVE";
    expect(await seatedHereAmong("b", ["pat"], "live")).toEqual(new Set());
    expect((await peopleHereByName({ organizationId: "b", reach: "live", take: 10 })).map((p) => p.id)).toEqual(["bea"]);
    expect((await peopleHereAmong("b", ["pat"], "kept")).get("pat")?.seat.accountEnded).toBe(true);
  });

  it("split by kind: the anchored rule as it was, and a live seat for a membership person", async () => {
    person("dee", "b", { status: "INACTIVE" });
    expect(await seatedHereAmong("b", ["dee", "rita", "pat"], { anchored: "kept", membership: "live" })).toEqual(new Set(["dee", "pat"]));
    expect(new Set(await everyoneHereIds("b", { anchored: "kept", membership: "live" }))).toEqual(new Set(["bea", "dee", "pat"]));
  });

  it("filter the Agent tier and a department by the seat here", async () => {
    db.row("organizationMembership", "m-pat-b").role = "AGENT";
    expect((await peopleHereByName({ organizationId: "b", reach: "active", noAgents: true, take: 10 })).map((p) => p.id)).toEqual(["bea"]);
    expect((await peopleHereByName({ organizationId: "b", reach: "active", departmentIn: ["dep-b"], take: 10 })).map((p) => p.id)).toEqual(["pat"]);
    expect((await peopleHereByName({ organizationId: "b", reach: "active", departmentIn: ["dep-a"], take: 10 })).map((p) => p.id)).toEqual([]);
  });
});

describe("the where builders and the predicates say the same thing", () => {
  it("for every seat and account state, in each reach", async () => {
    db.reset();
    for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}` });
    const states = [
      { status: "ACTIVE", removedAt: null },
      { status: "ON_LEAVE", removedAt: null },
      { status: "INACTIVE", removedAt: null },
      { status: "INACTIVE", removedAt: new Date("2026-01-01") },
    ];
    const accounts = [
      { status: "ACTIVE", deletedAt: null },
      { status: "INACTIVE", deletedAt: null },
      { status: "INACTIVE", deletedAt: new Date("2026-01-01") },
    ];
    const ids: string[] = [];
    let n = 0;
    for (const s of states) {
      // Anchored here: the account row is the seat.
      const here = `h${(n += 1)}`;
      person(here, "b", { status: s.status, deletedAt: s.removedAt });
      ids.push(here);
      for (const acc of accounts) {
        const there = `m${(n += 1)}`;
        person(there, "a", acc);
        seat(there, "b", s);
        ids.push(there);
      }
    }
    for (const reach of REACHES) {
      const byWhere = new Set((await peopleHereByName({ organizationId: "b", reach, take: 1000 })).map((p) => p.id));
      const byPredicate = await seatedHereAmong("b", ids, reach);
      expect([...byPredicate].sort()).toEqual([...byWhere].sort());
      expect(await countPeopleHere({ organizationId: "b", reach })).toBe(byWhere.size);
      for (const id of ids) {
        const u = db.row("user", id) as { organizationId: string; status: string; deletedAt: Date | null };
        const m = db.tables.organizationMembership?.find((r) => r.userId === id && r.organizationId === "b") as { status: string; removedAt: Date | null } | undefined;
        const want = u.organizationId === "b" ? anchoredAtReach(u, reach) : !!m && membershipAtReach(m, u, reach);
        expect(byPredicate.has(id)).toBe(want);
      }
    }
  });
});

describe("one ordered list from two halves", () => {
  it("cuts the same page from the merge however far each half was read", () => {
    const cmp = byName();
    const mk = (id: string, firstName: string) => ({ id, firstName, lastName: "", email: "", avatar: null });
    const a = [mk("1", "Ann"), mk("2", "Cy"), mk("3", "Eve"), mk("4", "Gus"), mk("5", "Ivy")];
    const b = [mk("6", "Bo"), mk("7", "Dee"), mk("8", "eve"), mk("9", "Hal")];
    const full = mergeOrdered(a, b, cmp);
    expect(full.map((p) => p.firstName)).toEqual(["Ann", "Bo", "Cy", "Dee", "Eve", "eve", "Gus", "Hal", "Ivy"]);
    for (let take = 1; take <= 4; take++) {
      for (let skip = 0; skip < 9; skip += take) {
        const page = mergeOrdered(a.slice(0, skip + take), b.slice(0, skip + take), cmp).slice(skip, skip + take);
        expect(page).toEqual(full.slice(skip, skip + take));
      }
    }
  });

  it("pages people across both halves with no one twice and no one missed", async () => {
    for (const [id, org] of [["amy", "b"], ["cal", "a"], ["dot", "b"], ["fay", "a"]] as const) {
      person(id, org);
      if (org === "a") seat(id, "b");
    }
    const all = (await peopleHereByName({ organizationId: "b", reach: "live", take: 50 })).map((p) => p.id);
    expect(all).toEqual(["amy", "bea", "cal", "dot", "fay", "pat"]);
    const paged: string[] = [];
    for (let skip = 0; skip < all.length; skip += 2) paged.push(...(await peopleHereByName({ organizationId: "b", reach: "live", skip, take: 2 })).map((p) => p.id));
    expect(paged).toEqual(all);
  });
});

describe("by email", () => {
  it("finds Pat in B in any case through her membership, and nobody ended here", async () => {
    expect((await personHereByEmail("b", " PAT@x.test ", "live"))?.id).toBe("pat");
    expect(await personHereByEmail("b", "rita@x.test", "live")).toBeNull();
    expect(await personHereByEmail("b", "rex@x.test", "kept")).toBeNull();
    expect(await personHereByEmail("b", "zed@x.test", "any")).toBeNull();
    expect((await peopleHereByEmails("b", ["pat@x.test", "bea@x.test", "rita@x.test", "zed@x.test"], "live")).map((p) => p.id).sort()).toEqual(["bea", "pat"]);
  });

  it("prefers the account anchored here when two accounts share an address", async () => {
    person("pat2", "b", { email: "pat@x.test" });
    expect((await personHereByEmail("b", "pat@x.test", "live"))?.id).toBe("pat2");
    expect((await peopleHereByEmails("b", ["pat@x.test"], "live")).map((p) => p.id)).toEqual(["pat2"]);
  });
});

describe("capacity and standing here", () => {
  it("gives the hours and working week each gives THIS workspace", async () => {
    const inB = await capacityHereOf("b", ["pat", "bea", "rita"]);
    expect(inB.get("pat")).toEqual({ weeklyCapacityHours: 10, workSchedule: { workdays: [1, 2], hoursPerDay: 5 } });
    expect(inB.get("bea")).toEqual({ weeklyCapacityHours: 32, workSchedule: null });
    // No hours stored on Rita's membership: this workspace's calendar.
    expect(inB.get("rita")).toEqual({ weeklyCapacityHours: null, workSchedule: null });
    expect((await capacityHereOf("a", ["pat"])).get("pat")?.weeklyCapacityHours).toBe(40);
  });

  it("answers where one person stands here", async () => {
    expect(await standingHere("b", "pat")).toEqual({ kind: "membership", level: "EMPLOYEE", kept: true, live: true });
    expect(await standingHere("b", "rita")).toEqual({ kind: "membership", level: "EMPLOYEE", kept: true, live: false });
    expect(await standingHere("b", "rex")).toEqual({ kind: "membership", level: "EMPLOYEE", kept: false, live: false });
    expect(await standingHere("b", "zed")).toBeNull();
    expect(await standingHere("a", "pat")).toEqual({ kind: "anchor", level: "MANAGER", kept: true, live: true });
  });
});
