// SCIM Groups' member writes in one transaction (docs/plans/workspace-status-2.md,
// step 9: the coordinator's fix after the live proof measured a Group PUT of
// 5,000 members at about 21 seconds, one transaction per member).
//
// seat-writes.ts placeDepartmentHere locks the people in id order in one
// statement and writes each half with one guarded statement. These tests
// hold it to the per-person path it replaced (kept below as `perPerson`,
// built from the same lockPerson and writeProfileHere that path called):
// the same rows written, the same rows left, on every kind of seat, and when
// a seat is removed, or a move lands, while the locks are being taken. On the
// in-memory database (seat-test-db.ts), which answers each where as Postgres
// would, NULL included.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { legacyLevelRow } from "@/lib/access/test-fixtures";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/access/seat-test-db")).seatDb.prisma }));

import { seatDb as db } from "@/lib/access/seat-test-db";
import { prisma } from "@/lib/prisma";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { membershipHereWhere } from "@/lib/access/seated-here";
import { placeDepartmentHere, seatRefOf, writeProfileHere } from "@/lib/access/seat-writes";
import { addToGroupHere, groupMembersHere, removeFromGroupHere, replaceGroupHere } from "@/lib/scim-groups";

type Row = Record<string, unknown> & { id: string };

/**
 * The per-person path this step replaced (scim-groups.ts placeHere on
 * aee9b215), one transaction per person: their lock, their seat read under
 * it, then writeProfileHere on the row that holds it. True when written.
 */
async function perPersonOne(organizationId: string, userId: string, next: string | null, onlyFrom?: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockPerson(tx, userId);
    const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, deletedAt: true, departmentId: true } });
    if (!account) return false;
    let held: string | null;
    if (account.organizationId === organizationId) {
      if (account.deletedAt) return false;
      held = account.departmentId ?? null;
    } else {
      const m = await tx.organizationMembership.findFirst({ where: { ...membershipHereWhere(organizationId, "kept"), userId }, select: { departmentId: true } });
      if (!m) return false;
      held = m.departmentId ?? null;
    }
    if (onlyFrom !== undefined && held !== onlyFrom) return false;
    if (held === next) return false;
    return writeProfileHere(tx, seatRefOf(organizationId, account), { departmentId: next });
  });
}

async function perPerson(organizationId: string, userIds: string[], next: string | null, onlyFrom?: string): Promise<string[]> {
  const out: string[] = [];
  for (const id of [...new Set(userIds)].sort()) if (await perPersonOne(organizationId, id, next, onlyFrom)) out.push(id);
  return out;
}

async function batch(organizationId: string, userIds: string[], next: string | null, onlyFrom?: string): Promise<string[]> {
  return prisma.$transaction((tx) => placeDepartmentHere(tx, { organizationId, userIds, departmentId: next, onlyFrom }));
}

const ALL = ["lee", "mo", "cy", "eve", "kai", "pat", "ann", "rita", "rex", "una", "zed", "ivy"];

/**
 * Org B is "here". Every kind of seat, in or out of B's Engineering:
 * - anchored in B: lee (Engineering), mo (Operations), cy (none), eve
 *   (removed, Engineering), kai (none, with a stale B membership row in
 *   Engineering, which is never written);
 * - anchored in A, working in B through a membership: pat (none; her account
 *   is in A's Engineering), ann (Engineering), rita (deactivated in B,
 *   Engineering), rex (removed in B, Engineering), una (her account ended,
 *   Engineering), ivy (Operations);
 * - zed: anchored in A, no seat in B.
 */
function seed() {
  db.reset();
  db.onCall = null;
  const since = new Date("2025-01-01");
  for (const id of ["a", "b"]) db.seed("organization", { id, name: `Org ${id.toUpperCase()}`, status: "ACTIVE", settings: {} });
  for (const [id, organizationId, name] of [["a-eng", "a", "Engineering"], ["eng", "b", "Engineering"], ["ops", "b", "Operations"]]) db.seed("department", { id, name, color: null, organizationId });
  const person = (id: string, organizationId: string, departmentId: string | null, extra: Record<string, unknown> = {}) =>
    db.seed("user", {
      id, email: `${id}@x.test`, firstName: id[0].toUpperCase() + id.slice(1), lastName: "Ng", organizationId, ...legacyLevelRow("EMPLOYEE"), status: "ACTIVE",
      deletedAt: null, managerId: null, phone: null, departmentId, roleId: null, officeId: null, joinDate: since, createdAt: since,
      weeklyCapacityHours: null, workSchedule: null, customFields: null, ...extra,
    });
  const seatIn = (userId: string, organizationId: string, departmentId: string | null, extra: Record<string, unknown> = {}) =>
    db.seed("organizationMembership", { id: `m-${userId}-${organizationId}`, userId, organizationId, role: "EMPLOYEE", status: "ACTIVE", removedAt: null, managerId: null, departmentId, roleId: null, officeId: null, createdAt: since, ...extra });
  person("lee", "b", "eng");
  person("mo", "b", "ops");
  person("cy", "b", null);
  person("eve", "b", "eng", { deletedAt: new Date("2026-10-01"), status: "INACTIVE" });
  person("kai", "b", null);
  seatIn("kai", "b", "eng");
  person("pat", "a", "a-eng");
  seatIn("pat", "b", null);
  person("ann", "a", null);
  seatIn("ann", "b", "eng");
  person("rita", "a", null);
  seatIn("rita", "b", "eng", { status: "INACTIVE" });
  person("rex", "a", null);
  seatIn("rex", "b", "eng", { removedAt: new Date("2026-10-01"), status: "INACTIVE" });
  person("una", "a", null, { deletedAt: new Date("2026-10-01"), status: "INACTIVE" });
  seatIn("una", "b", "eng");
  person("zed", "a", null);
  person("ivy", "a", null);
  seatIn("ivy", "b", "ops");
}

/** Every row's department: each account, and each membership by person and workspace. */
function departments() {
  return {
    accounts: Object.fromEntries((db.tables.user as Row[]).map((u) => [u.id, u.departmentId ?? null])),
    memberships: Object.fromEntries((db.tables.organizationMembership as Row[]).map((m) => [`${m.userId as string}@${m.organizationId as string}`, m.departmentId ?? null])),
  };
}

/** What a run wrote and the rows after it, without its log (the two paths log differently by design). */
const written = (r: { wrote: unknown; rows: unknown }) => ({ wrote: r.wrote, rows: r.rows });

/** Runs `run` on a fresh seed, with `meanwhile` landing at each lock it names; answers what it wrote and every row after. */
async function after(run: () => Promise<string[] | void>, meanwhile: Record<string, () => void> = {}) {
  seed();
  db.onCall = (entry: string) => {
    const land = meanwhile[entry.replace(/^tx\./, "")];
    if (land) {
      delete meanwhile[entry.replace(/^tx\./, "")];
      land();
    }
  };
  db.log.length = 0;
  const wrote = await run();
  db.onCall = null;
  return { wrote, rows: departments(), log: [...db.log] };
}

describe("placeDepartmentHere writes what the per-person path wrote, one transaction for all", () => {
  beforeEach(seed);

  it("a member add: the same people placed, on the same rows, and every guard held", async () => {
    const old = await after(() => perPerson("b", ALL, "eng"));
    const now = await after(() => batch("b", ALL, "eng"));
    expect(written(now)).toEqual(written(old));
    // Written: cy and kai (no department), mo (Operations) on their accounts;
    // pat (none) and ivy (Operations) on their B memberships.
    expect(now.wrote).toEqual(["cy", "ivy", "kai", "mo", "pat"]);
    // Left: lee, ann and rita already there (rita is deactivated, a kept
    // seat); eve and rex removed; una's account ended; zed no seat in B;
    // kai's stale B row; pat's account (A's Engineering).
    expect(now.rows.memberships["kai@b"]).toBe("eng");
    expect(now.rows.accounts.pat).toBe("a-eng");
    expect(now.rows.accounts.zed).toBeNull();
    expect(now.rows.memberships["rex@b"]).toBe("eng");
  });

  it("a member remove: only the people still in that department, on the same rows", async () => {
    const old = await after(() => perPerson("b", ALL, null, "eng"));
    const now = await after(() => batch("b", ALL, null, "eng"));
    expect(written(now)).toEqual(written(old));
    expect(now.wrote).toEqual(["ann", "lee", "rita"]);
    // Mo and ivy are in Operations, and stay; the removed, the ended and the
    // stale row keep Engineering, as before.
    expect(now.rows.accounts.mo).toBe("ops");
    expect(now.rows.memberships["ivy@b"]).toBe("ops");
    expect(now.rows.memberships["rex@b"]).toBe("eng");
    expect(now.rows.memberships["una@b"]).toBe("eng");
    expect(now.rows.accounts.eve).toBe("eng");
  });

  it("a move into another department: from any, never twice", async () => {
    const old = await after(() => perPerson("b", ALL, "ops"));
    const now = await after(() => batch("b", ALL, "ops"));
    expect(written(now)).toEqual(written(old));
    expect(now.wrote).toEqual(["ann", "cy", "kai", "lee", "pat", "rita"]);
  });

  it("a seat removed while the locks are taken is left untouched, as the per-person path left it", async () => {
    // B removes Pat (her membership) and Cy (his account) in a transaction
    // that commits just before this one is granted their locks.
    const removeBoth = () => ({
      "lock:cy": () => {
        db.row("user", "cy").deletedAt = new Date();
      },
      "lock:pat": () => {
        const m = (db.tables.organizationMembership as Row[]).find((x) => x.userId === "pat" && x.organizationId === "b")!;
        m.removedAt = new Date();
      },
    });
    const old = await after(() => perPerson("b", ["pat", "cy", "mo"], "eng"), removeBoth());
    const now = await after(() => batch("b", ["pat", "cy", "mo"], "eng"), removeBoth());
    expect(written(now)).toEqual(written(old));
    expect(now.wrote).toEqual(["mo"]);
    expect(now.rows.memberships["pat@b"]).toBeNull();
    expect(now.rows.accounts.cy).toBeNull();
  });

  it("a move landing while the locks are taken is written where it landed, as the per-person path wrote it", async () => {
    // Pat switches into B just before her lock is granted: her account holds
    // her seat in B now, and her B membership is the stale row.
    const moveIn = () => ({
      "lock:pat": () => {
        db.row("user", "pat").organizationId = "b";
      },
    });
    const old = await after(() => perPerson("b", ["pat"], "eng"), moveIn());
    const now = await after(() => batch("b", ["pat"], "eng"), moveIn());
    expect(written(now)).toEqual(written(old));
    expect(now.wrote).toEqual(["pat"]);
    expect(now.rows.accounts.pat).toBe("eng");
    expect(now.rows.memberships["pat@b"]).toBeNull();
  });

  it("locks everyone first, in id order, in its one transaction, then writes each half once", async () => {
    db.log.length = 0;
    await batch("b", ["zed", "ann", "mo", "lee", "pat"], "ops");
    // Every call went through the transaction's client ("tx."): no read and
    // no write outside it, and no statement per person but the locks.
    expect(db.log).toEqual([
      "tx.lock:ann",
      "tx.lock:lee",
      "tx.lock:mo",
      "tx.lock:pat",
      "tx.lock:zed",
      "tx.user.updateManyAndReturn",
      "tx.organizationMembership.updateManyAndReturn",
    ]);
  });
});

describe("the SCIM Group writes (scim-groups.ts) on it", () => {
  beforeEach(seed);

  it("add, remove and replace write what the per-person path wrote, each in one transaction", async () => {
    const oldAdd = await after(async () => void (await perPerson("b", ["pat", "mo", "zed"], "eng")));
    const nowAdd = await after(async () => {
      expect(await addToGroupHere("b", "eng", ["pat", "mo", "zed"])).toBe(2);
    });
    expect(nowAdd.rows).toEqual(oldAdd.rows);

    const oldRemove = await after(async () => void (await perPerson("b", ["lee", "mo", "rex"], null, "eng")));
    const nowRemove = await after(async () => {
      expect(await removeFromGroupHere("b", "eng", ["lee", "mo", "rex"])).toBe(1);
    });
    expect(nowRemove.rows).toEqual(oldRemove.rows);

    // The old replace: the members listed now and not named taken out, one by
    // one, then everyone named placed, one by one.
    const named = ["pat", "mo", "zed", "rex"];
    const oldReplace = await after(async () => {
      const current = ((await groupMembersHere("b", ["eng"])).get("eng") ?? []).map((m) => m.id);
      await perPerson("b", current.filter((id) => !named.includes(id)), null, "eng");
      await perPerson("b", named, "eng");
    });
    const nowReplace = await after(() => replaceGroupHere("b", "eng", named));
    expect(nowReplace.rows).toEqual(oldReplace.rows);
    // Lee, ann and rita out; pat and mo in; zed (no seat) and rex (removed) nowhere.
    expect(((await groupMembersHere("b", ["eng"])).get("eng") ?? []).map((m) => m.id).sort()).toEqual(["mo", "pat"]);
    // The members read (two halves, outside), then one transaction: everyone
    // it touches locked first, in id order; after that only locks already
    // held are taken again (the remove's, then the add's), so no lock is
    // ever taken out of order; then each half written once per write.
    const UNION = ["ann", "lee", "mo", "pat", "rex", "rita", "zed"];
    expect(nowReplace.log.slice(0, 2)).toEqual(["user.findMany", "organizationMembership.findMany"]);
    expect(nowReplace.log.slice(2, 9)).toEqual(UNION.map((id) => `tx.lock:${id}`));
    const rest = nowReplace.log.slice(9);
    expect(rest.every((e) => e.startsWith("tx."))).toBe(true);
    expect(rest.filter((e) => e.startsWith("tx.lock:")).every((e) => UNION.includes(e.slice("tx.lock:".length)))).toBe(true);
    expect(rest.filter((e) => !e.startsWith("tx.lock:"))).toEqual([
      "tx.user.updateManyAndReturn",
      "tx.organizationMembership.updateManyAndReturn",
      "tx.user.updateManyAndReturn",
      "tx.organizationMembership.updateManyAndReturn",
    ]);
  });
});
