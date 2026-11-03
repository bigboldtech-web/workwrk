// The one place a person's line, dotted lines and profile in a workspace are
// written (docs/plans/workspace-status-2.md E16, step 1:
// src/lib/access/seat-writes.ts). Pat is anchored at her agency A, where Max
// manages her, and works for client B through a membership, where Dana
// leads her. Each write lands on the row that holds her seat in the
// workspace written in, guarded as applyRoleChangeIn's two writes are, and
// never on another workspace's. On the in-memory database, with a move
// landed at a chosen moment through its onCall hook.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./seat-test-db")).seatDb.prisma }));

import { moveLinesHere, removeDottedHere, seatRefOf, SelfLine, writeDottedHere, writeLineHere, writeProfileHere, type SeatRef } from "./seat-writes";
import { reanchorUser } from "./workspace-anchor";
import { seatDb as db } from "./seat-test-db";

type Tx = Parameters<typeof writeLineHere>[0];
const tx = () => db.prisma as unknown as Tx;
const user = (id: string) => db.row("user", id);
const seatOf = (userId: string, organizationId: string) => db.tables.organizationMembership.find((m) => m.userId === userId && m.organizationId === organizationId)!;
const person = (id: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("user", { id, email: `${id}@x.test`, organizationId, accessLevel: "EMPLOYEE", managerId: null, ...extra });
const membership = (userId: string, organizationId: string, extra: Record<string, unknown> = {}) =>
  db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", ...extra });
/** Pat's seat in B as a route reads it: a membership, her account anchored at A. */
const patInB = (): SeatRef => seatRefOf("b", { id: "pat", organizationId: "a" });
/** Pat's seat in A: her account. */
const patInA = (): SeatRef => seatRefOf("a", { id: "pat", organizationId: "a" });

beforeEach(() => {
  db.reset();
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id}`, status: "ACTIVE" });
  person("max", "a", { accessLevel: "MANAGER" });
  membership("max", "b");
  person("dana", "b", { accessLevel: "MANAGER" });
  person("bo", "b", { accessLevel: "SUPER_ADMIN" });
  person("pat", "a", { managerId: "max", weeklyCapacityHours: 40, customFields: { shirt: "M" } });
  membership("pat", "b", { managerId: "dana", weeklyCapacityHours: null, customFields: { badge: "C-12", shirt: "L" } });
});

describe("writeLineHere: the line lands on the row that holds the seat here", () => {
  it("Bo sets Pat's Reports to in B: her B membership changes, A's line (Max, on her account) does not", async () => {
    expect(await writeLineHere(tx(), patInB(), "bo")).toBe(true);
    expect(seatOf("pat", "b").managerId).toBe("bo");
    // Before (one column per account): Pat's A manager became Bo too.
    expect(user("pat").managerId).toBe("max");
  });

  it("Ada sets it in A: the account changes, B's membership does not", async () => {
    person("ada", "a", { accessLevel: "COMPANY_ADMIN" });
    expect(await writeLineHere(tx(), patInA(), "ada")).toBe(true);
    expect(user("pat").managerId).toBe("ada");
    expect(seatOf("pat", "b").managerId).toBe("dana");
  });

  it("clears it with null", async () => {
    expect(await writeLineHere(tx(), patInB(), null)).toBe(true);
    expect(seatOf("pat", "b").managerId).toBeNull();
    expect(user("pat").managerId).toBe("max");
  });

  it("takes Pat's row lock before it writes", async () => {
    db.log.length = 0;
    await writeLineHere(tx(), patInB(), "bo");
    expect(db.log.indexOf("lock:pat")).toBeGreaterThanOrEqual(0);
    expect(db.log.indexOf("lock:pat")).toBeLessThan(db.log.indexOf("organizationMembership.updateMany"));
  });

  it("a switch into B that lands while the write waits for her lock: nothing written, the caller asks again", async () => {
    db.onCall = async (entry) => {
      if (entry !== "lock:pat") return;
      db.onCall = null;
      await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    };
    // Read as a membership seat (anchored at A); she is anchored at B now.
    expect(await writeLineHere(tx(), patInB(), "bo")).toBe(false);
    // B's line is on her account now, unchanged; A's on its membership, unchanged.
    expect(user("pat")).toMatchObject({ organizationId: "b", managerId: "dana" });
    expect(seatOf("pat", "a").managerId).toBe("max");
  });

  it("a seat removed here writes nothing", async () => {
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    expect(await writeLineHere(tx(), patInB(), "bo")).toBe(false);
    expect(seatOf("pat", "b").managerId).toBe("dana");
    user("pat").deletedAt = new Date("2026-10-02");
    expect(await writeLineHere(tx(), patInA(), null)).toBe(false);
    expect(user("pat").managerId).toBe("max");
  });

  it("a line from a person to themselves is refused before anything", async () => {
    await expect(writeLineHere(tx(), patInB(), "pat")).rejects.toBeInstanceOf(SelfLine);
    expect(db.writes).toEqual([]);
  });
});

describe("moveLinesHere: a handover moves this workspace's lines only", () => {
  beforeEach(() => {
    // B: Dan anchored there under Dana. A: Dana also works there through a
    // membership, and Kim (anchored at A) reports to her there.
    person("dan", "b", { managerId: "dana" });
    membership("dana", "a");
    person("kim", "a", { managerId: "dana" });
  });

  it("B removes Dana: Pat (her B membership) and Dan (his account) move to Bo; Kim's line in A stays with Dana", async () => {
    const moved = await moveLinesHere(tx(), { organizationId: "b", fromId: "dana", moves: [{ to: "bo", ids: ["pat", "dan"] }] });
    expect(moved).toEqual([{ to: "bo", ids: ["dan", "pat"] }]);
    expect(seatOf("pat", "b").managerId).toBe("bo");
    expect(user("dan").managerId).toBe("bo");
    expect(user("kim").managerId).toBe("dana");
    // And Pat's A line is A's.
    expect(user("pat").managerId).toBe("max");
  });

  it("answers exactly who moved: a person whose line here no longer names the leaver is not moved or named", async () => {
    user("dan").managerId = "bo";
    expect(await moveLinesHere(tx(), { organizationId: "b", fromId: "dana", moves: [{ to: null, ids: ["pat", "dan"] }] })).toEqual([{ to: null, ids: ["pat"] }]);
    expect(seatOf("pat", "b").managerId).toBeNull();
    expect(user("dan").managerId).toBe("bo");
  });

  it("A's handover of Max moves Pat's A line (her account), never her B line", async () => {
    person("ada", "a", { accessLevel: "COMPANY_ADMIN" });
    seatOf("pat", "b").managerId = "max";
    expect(await moveLinesHere(tx(), { organizationId: "a", fromId: "max", moves: [{ to: "ada", ids: ["pat"] }] })).toEqual([{ to: "ada", ids: ["pat"] }]);
    expect(user("pat").managerId).toBe("ada");
    expect(seatOf("pat", "b").managerId).toBe("max");
  });

  it("a switch into B landing at the same moment: the line moves on whichever row holds it then", async () => {
    db.onCall = async (entry) => {
      if (entry !== "lock:pat") return;
      db.onCall = null;
      await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    };
    expect(await moveLinesHere(tx(), { organizationId: "b", fromId: "dana", moves: [{ to: "bo", ids: ["pat"] }] })).toEqual([{ to: "bo", ids: ["pat"] }]);
    // Anchored at B now: her B line is on her account, moved; A's stays on its membership.
    expect(user("pat")).toMatchObject({ organizationId: "b", managerId: "bo" });
    expect(seatOf("pat", "a").managerId).toBe("max");
  });

  it("locks the people in id order before any write, and never moves anyone under themselves or the leaver", async () => {
    db.log.length = 0;
    await moveLinesHere(tx(), { organizationId: "b", fromId: "dana", moves: [{ to: "bo", ids: ["pat", "dan", "dana"] }, { to: "pat", ids: ["pat"] }] });
    const locks = db.log.filter((e) => e.startsWith("lock:"));
    expect(locks).toEqual(["lock:dan", "lock:pat"]);
    expect(db.log.indexOf("lock:pat")).toBeLessThan(db.log.findIndex((e) => e.endsWith("updateManyAndReturn")));
    expect(seatOf("pat", "b").managerId).toBe("bo");
  });

  it("a report removed here keeps the line on the ended seat (a restore checks it then)", async () => {
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    expect(await moveLinesHere(tx(), { organizationId: "b", fromId: "dana", moves: [{ to: "bo", ids: ["pat"] }] })).toEqual([{ to: "bo", ids: [] }]);
    expect(seatOf("pat", "b").managerId).toBe("dana");
  });
});

describe("writeProfileHere: the profile lands on the row that holds the seat here", () => {
  it("B's HR gives Pat 10 hours and B's profile fields, merged key by key, on her B membership; A's stay on her account", async () => {
    db.seed("department", { id: "dep-b", name: "Engineering", organizationId: "b" });
    expect(await writeProfileHere(tx(), patInB(), { weeklyCapacityHours: 10, departmentId: "dep-b", workSchedule: { workdays: [1, 2] }, customFields: { set: { badge: "C-13" }, remove: ["shirt"] } })).toBe(true);
    expect(seatOf("pat", "b")).toMatchObject({ weeklyCapacityHours: 10, departmentId: "dep-b", workSchedule: { workdays: [1, 2] }, customFields: { badge: "C-13" } });
    // Before: PATCH refused it (PROFILE_ELSEWHERE), or wrote A's account.
    expect(user("pat")).toMatchObject({ weeklyCapacityHours: 40, customFields: { shirt: "M" } });
    expect(user("pat").departmentId ?? null).toBeNull();
  });

  it("A's on her account, merged with what it holds", async () => {
    expect(await writeProfileHere(tx(), patInA(), { weeklyCapacityHours: 32, customFields: { set: { desk: "4F" }, remove: [] } })).toBe(true);
    expect(user("pat")).toMatchObject({ weeklyCapacityHours: 32, customFields: { shirt: "M", desk: "4F" } });
    expect(seatOf("pat", "b")).toMatchObject({ weeklyCapacityHours: null, customFields: { badge: "C-12", shirt: "L" } });
  });

  it("a working week cleared is stored as no value", async () => {
    seatOf("pat", "b").workSchedule = { workdays: [1] };
    await writeProfileHere(tx(), patInB(), { workSchedule: null });
    expect(seatOf("pat", "b").workSchedule).toBe(Prisma.DbNull);
  });

  it("a switch landing while it waits for her lock: nothing written", async () => {
    db.onCall = async (entry) => {
      if (entry !== "lock:pat") return;
      db.onCall = null;
      await reanchorUser({ userId: "pat", to: { organizationId: "b", role: "EMPLOYEE" } });
    };
    expect(await writeProfileHere(tx(), patInB(), { weeklyCapacityHours: 10, customFields: { set: { badge: "X" }, remove: [] } })).toBe(false);
    // B's profile is on her account now, as it was; A's on its membership.
    expect(user("pat")).toMatchObject({ organizationId: "b", weeklyCapacityHours: null, customFields: { badge: "C-12", shirt: "L" } });
    expect(seatOf("pat", "a")).toMatchObject({ weeklyCapacityHours: 40, customFields: { shirt: "M" } });
  });

  it("an empty patch writes nothing and still says whether the seat stands", async () => {
    expect(await writeProfileHere(tx(), patInB(), {})).toBe(true);
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    expect(await writeProfileHere(tx(), patInB(), {})).toBe(false);
    expect(db.writes).toEqual([]);
  });
});

describe("writeDottedHere and removeDottedHere: this workspace's dotted lines only (E2)", () => {
  beforeEach(() => {
    person("kai", "b");
    // A: Pat dotted to Max there. B: Pat dotted to Max and to Kai there.
    db.seed("userDottedLine", { id: "d-a-max", userId: "pat", managerId: "max", organizationId: "a", role: "matrix" });
    db.seed("userDottedLine", { id: "d-b-max", userId: "pat", managerId: "max", organizationId: "b" });
    db.seed("userDottedLine", { id: "d-b-kai", userId: "pat", managerId: "kai", organizationId: "b" });
  });
  const lines = (organizationId: string) => db.tables.userDottedLine.filter((d) => d.organizationId === organizationId).map((d) => d.managerId).sort();

  it("Dana saves Pat's dotted lines in B as Bo alone: B's rows are replaced, A's row to Max stays", async () => {
    expect(await writeDottedHere(tx(), patInB(), [{ managerId: "bo", role: "project lead" }])).toEqual({ added: ["bo"], removed: ["kai", "max"] });
    expect(lines("b")).toEqual(["bo"]);
    // Before (one row read by every workspace): A lost Pat's dotted line to Max.
    expect(lines("a")).toEqual(["max"]);
    expect(db.tables.userDottedLine.find((d) => d.organizationId === "b")).toMatchObject({ userId: "pat", managerId: "bo", role: "project lead" });
  });

  it("keeps a named line's note when the save does not change it", async () => {
    expect(await writeDottedHere(tx(), patInA(), [{ managerId: "max" }])).toEqual({ added: [], removed: [] });
    expect(db.row("userDottedLine", "d-a-max").role).toBe("matrix");
  });

  it("writes nothing for a person removed here", async () => {
    seatOf("pat", "b").removedAt = new Date("2026-10-01");
    expect(await writeDottedHere(tx(), patInB(), [])).toBeNull();
    expect(lines("b")).toEqual(["kai", "max"]);
  });

  it("refuses a dotted line from a person to themselves", async () => {
    await expect(writeDottedHere(tx(), patInB(), [{ managerId: "pat" }])).rejects.toBeInstanceOf(SelfLine);
  });

  it("removeDottedHere takes B's line off and leaves A's row of the same pair", async () => {
    expect(await removeDottedHere(tx(), "b", [{ userId: "pat", managerId: "max" }])).toBe(1);
    expect(lines("b")).toEqual(["kai"]);
    expect(lines("a")).toEqual(["max"]);
    expect(await removeDottedHere(tx(), "b", [])).toBe(0);
  });
});
