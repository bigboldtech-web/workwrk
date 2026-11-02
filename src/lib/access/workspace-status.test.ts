// A person's status in each workspace (docs/plans/workspace-status.md, step 1):
// the seat rule (D2), endSeat (D3, D4, D5) and restoreSeat (D6), run through
// the real move between workspaces (workspace-anchor.ts reanchorUser) on a
// small in-memory transaction, and the invariant of D7 after every step.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; organizationId: string; email: string; status: string; deletedAt: Date | null; accessLevel: string; adminScopes: string[]; tokenVersion: number };
type M = { userId: string; organizationId: string; role: string; status: string; removedAt: Date | null; isPrimary: boolean; createdAt: Date; adminScopes: string[]; endedWithAccount: boolean };

const st = vi.hoisted(() => ({
  users: new Map<string, U>(),
  memberships: [] as M[],
  /** Each workspace's status. */
  orgs: new Map<string, string>(),
  /** The newest erasure record's withdrawnAt per account (src/lib/compliance/erased-account.ts). */
  erasures: new Map<string, Date>(),
  /** Every statement, in order: "lock:<id>" for the person's row lock, else "<model>.<op>". */
  log: [] as string[],
}));

type Where = Record<string, unknown>;

/** The `where` shapes the code under test sends, and nothing else: an unknown one throws. */
function membershipMatches(m: M, where: Where): boolean {
  for (const [k, c] of Object.entries(where)) {
    if (k === "organization") {
      const status = st.orgs.get(m.organizationId);
      const cond = (c as { status: { notIn: string[] } }).status;
      if (!cond?.notIn) throw new Error(`fake: unknown organization condition ${JSON.stringify(c)}`);
      if (status === undefined || cond.notIn.includes(status)) return false;
      continue;
    }
    if (!["userId", "organizationId", "status", "removedAt", "isPrimary", "endedWithAccount"].includes(k)) throw new Error(`fake: unknown membership field ${k}`);
    const v = (m as unknown as Record<string, unknown>)[k];
    if (c === null) {
      if (v != null) return false;
    } else if (typeof c === "object" && !(c instanceof Date)) {
      const o = c as { not?: unknown; in?: unknown[] };
      if ("not" in o && v === o.not) return false;
      if (o.in && !o.in.includes(v)) return false;
      if (Object.keys(o).some((x) => x !== "not" && x !== "in")) throw new Error(`fake: unknown condition ${JSON.stringify(c)}`);
    } else if (v !== c) return false;
  }
  return true;
}

function apply<T extends Record<string, unknown>>(row: T, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && "increment" in v) (row as Record<string, unknown>)[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
    else (row as Record<string, unknown>)[k] = v;
  }
}

const keyOf = (w: { userId_organizationId: { userId: string; organizationId: string } }) => w.userId_organizationId;
const findSeat = (userId: string, organizationId: string) => st.memberships.find((m) => m.userId === userId && m.organizationId === organizationId);

const tx = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(tx, {
  $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
    const text = sql.join("?");
    if (!/SELECT 1 FROM "User" WHERE "id" = \? FOR NO KEY UPDATE/.test(text)) throw new Error(`fake: unknown raw statement ${text}`);
    st.log.push(`lock:${values[0]}`);
    return 1;
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      st.log.push("user.findUnique");
      const u = st.users.get(where.id);
      return u ? { ...u } : null;
    },
    findMany: async ({ where }: { where: { OR: Array<{ organizationId: string; email: string }> } }) => {
      st.log.push("user.findMany");
      return [...st.users.values()].filter((u) => where.OR.some((w) => w.organizationId === u.organizationId && w.email === u.email)).map((u) => ({ ...u }));
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      st.log.push("user.update");
      const u = st.users.get(where.id);
      if (!u) throw new Error("fake: user.update no row");
      apply(u, data);
      return { ...u };
    },
    updateMany: async ({ where, data }: { where: { id: string; organizationId?: string; deletedAt?: null }; data: Record<string, unknown> }) => {
      st.log.push("user.updateMany");
      const u = st.users.get(where.id);
      if (!u || (where.organizationId !== undefined && u.organizationId !== where.organizationId) || ("deletedAt" in where && u.deletedAt !== null)) return { count: 0 };
      apply(u, data);
      return { count: 1 };
    },
  },
  organizationMembership: {
    findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
      st.log.push("membership.findUnique");
      const m = findSeat(keyOf(where).userId, keyOf(where).organizationId);
      return m ? { ...m } : null;
    },
    findFirst: async ({ where }: { where: Where }) => {
      st.log.push("membership.findFirst");
      const m = st.memberships.find((x) => membershipMatches(x, where));
      return m ? { ...m } : null;
    },
    findMany: async ({ where, orderBy }: { where: Where; orderBy?: unknown }) => {
      st.log.push("membership.findMany");
      // Ordered only as sign-in orders seats (primary first, then oldest), when asked for an order.
      if (orderBy !== undefined) expect(orderBy).toEqual([{ isPrimary: "desc" }, { createdAt: "asc" }]);
      return st.memberships
        .filter((m) => membershipMatches(m, where))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({ ...m }));
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      st.log.push("membership.updateMany");
      const rows = st.memberships.filter((m) => membershipMatches(m, where));
      for (const m of rows) apply(m, data);
      return { count: rows.length };
    },
    update: async ({ where, data }: { where: { userId_organizationId: { userId: string; organizationId: string } }; data: Record<string, unknown> }) => {
      st.log.push("membership.update");
      const m = findSeat(keyOf(where).userId, keyOf(where).organizationId);
      if (!m) throw new Error("fake: membership.update no row");
      apply(m, data);
      return { ...m };
    },
    upsert: async ({ where, create, update }: { where: { userId_organizationId: { userId: string; organizationId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      st.log.push("membership.upsert");
      const m = findSeat(keyOf(where).userId, keyOf(where).organizationId);
      if (m) apply(m, update);
      else st.memberships.push({ adminScopes: [], isPrimary: false, createdAt: new Date(), status: "ACTIVE", removedAt: null, endedWithAccount: false, ...(create as Partial<M>) } as M);
      return {};
    },
  },
  consentRecord: {
    findFirst: async ({ where }: { where: { userId: string } }) => {
      const at = st.erasures.get(where.userId);
      return at ? { withdrawnAt: at } : null;
    },
  },
});

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } }));

import {
  CLOSED_WORKSPACE_STATUSES,
  alreadyEnded,
  endSeat,
  keptSeatSql,
  keptSeatWhere,
  liveSeatSql,
  liveSeatWhere,
  restoreRefusal,
  restoreSeat,
  seatIsKept,
  seatIsLive,
  seatIsUsable,
  usableSeatWhere,
  workspaceIsOpen,
} from "./workspace-status";
import { reanchorUser } from "./workspace-anchor";

const T = tx as never;
const NOW = new Date("2026-11-01T10:00:00Z");

function person(id: string, organizationId: string, extra: Partial<U> = {}): U {
  const u: U = { id, organizationId, email: `${id}@x.test`, status: "ACTIVE", deletedAt: null, accessLevel: "EMPLOYEE", adminScopes: [], tokenVersion: 0, ...extra };
  st.users.set(id, u);
  return u;
}
let created = 0;
function seat(userId: string, organizationId: string, extra: Partial<M> = {}): M {
  created += 1;
  const m: M = { userId, organizationId, role: "EMPLOYEE", status: "ACTIVE", removedAt: null, isPrimary: false, createdAt: new Date(Date.UTC(2026, 0, created)), adminScopes: [], endedWithAccount: false, ...extra };
  st.memberships.push(m);
  return m;
}
const u = (id: string) => st.users.get(id)!;
const m = (userId: string, org: string) => findSeat(userId, org);
const writes = () => st.log.filter((l) => /\.(update|updateMany|upsert)$/.test(l));

/** D7: if any of a person's seats is usable, their anchor is usable. */
function invariantHolds(userId: string): boolean {
  const p = u(userId);
  const anchorUsable = p.status !== "INACTIVE" && p.deletedAt == null && workspaceIsOpen(st.orgs.get(p.organizationId));
  const usableElsewhere = st.memberships.some((x) => x.userId === userId && x.organizationId !== p.organizationId && seatIsUsable(x, st.orgs.get(x.organizationId)));
  return anchorUsable || !usableElsewhere;
}

beforeEach(() => {
  st.users.clear();
  st.memberships.length = 0;
  st.orgs.clear();
  st.erasures.clear();
  st.log.length = 0;
  created = 0;
  for (const [id, status] of [["a", "ACTIVE"], ["b", "ACTIVE"], ["c", "TRIAL"], ["held", "SUSPENDED"], ["closed", "CANCELLED"]]) st.orgs.set(id, status);
});

describe("the seat rule (D2): one statement, three forms that agree", () => {
  const statuses = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"];
  const removals = [null, new Date("2026-10-01")];
  const orgStatuses = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"];

  it("a live seat is not INACTIVE and not removed; HR statuses are live", () => {
    for (const status of statuses) for (const removedAt of removals) expect(seatIsLive({ status, removedAt }), `${status} ${removedAt}`).toBe(status !== "INACTIVE" && removedAt === null);
    expect(seatIsKept({ status: "INACTIVE", removedAt: null })).toBe(true);
    expect(seatIsKept({ status: "ACTIVE", removedAt: new Date() })).toBe(false);
  });

  it("a usable seat is live in a workspace that is neither suspended nor closed, and the where says exactly that", () => {
    expect([...CLOSED_WORKSPACE_STATUSES]).toEqual(["SUSPENDED", "CANCELLED"]);
    for (const status of statuses) {
      for (const removedAt of removals) {
        for (const org of orgStatuses) {
          st.orgs.set("x", org);
          const row: M = { userId: "p", organizationId: "x", role: "EMPLOYEE", status, removedAt, isPrimary: false, createdAt: NOW, adminScopes: [], endedWithAccount: false };
          const want = status !== "INACTIVE" && removedAt === null && (org === "ACTIVE" || org === "TRIAL");
          expect(seatIsUsable(row, org), `${status} ${removedAt} ${org}`).toBe(want);
          expect(membershipMatches(row, usableSeatWhere()), `where ${status} ${removedAt} ${org}`).toBe(want);
          expect(membershipMatches(row, liveSeatWhere())).toBe(seatIsLive(row));
          expect(membershipMatches(row, keptSeatWhere())).toBe(seatIsKept(row));
        }
      }
    }
    expect(workspaceIsOpen(undefined)).toBe(false);
  });

  it("states the same rule in SQL, for a plain alias only", () => {
    expect(liveSeatSql("m").sql).toBe(`(m."status" <> 'INACTIVE' AND m."removedAt" IS NULL)`);
    expect(liveSeatSql("m").values).toEqual([]);
    expect(keptSeatSql("m").sql).toBe(`m."removedAt" IS NULL`);
    expect(() => liveSeatSql(`m"; DROP TABLE "User`)).toThrow(/plain alias/);
  });

  it("says when a seat is already ended, and why a seat cannot come back", () => {
    expect(alreadyEnded({ status: "INACTIVE", removedAt: null }, "deactivated")).toBe(true);
    expect(alreadyEnded({ status: "INACTIVE", removedAt: null }, "removed")).toBe(false);
    expect(alreadyEnded({ status: "INACTIVE", removedAt: NOW }, "removed")).toBe(true);
    expect(alreadyEnded({ status: "ON_LEAVE", removedAt: null }, "deactivated")).toBe(false);
    expect(restoreRefusal({ status: "INACTIVE", removedAt: NOW }, "restored")).toBeNull();
    expect(restoreRefusal({ status: "INACTIVE", removedAt: null }, "restored")).toBe("not_ended");
    expect(restoreRefusal({ status: "INACTIVE", removedAt: null }, "reactivated")).toBeNull();
    expect(restoreRefusal({ status: "INACTIVE", removedAt: NOW }, "reactivated")).toBe("removed");
    expect(restoreRefusal({ status: "ACTIVE", removedAt: null }, "reactivated")).toBe("not_ended");
  });
});

describe("endSeat", () => {
  it("D5: ends only the membership of someone who works here from another workspace, and never deletes it", async () => {
    person("p", "a");
    seat("p", "b");
    seat("p", "c");
    expect(await endSeat(T, { userId: "p", organizationId: "b", kind: "deactivated", now: NOW })).toEqual({ outcome: "membership_ended", anchoredIn: "a" });
    expect(m("p", "b")).toMatchObject({ status: "INACTIVE", removedAt: null });
    // The account, its anchor, its sessions and the other workspaces are untouched.
    expect(u("p")).toMatchObject({ organizationId: "a", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
    expect(m("p", "c")).toMatchObject({ status: "ACTIVE", removedAt: null });

    expect(await endSeat(T, { userId: "p", organizationId: "c", kind: "removed", now: NOW })).toEqual({ outcome: "membership_ended", anchoredIn: "a" });
    expect(m("p", "c")).toMatchObject({ status: "INACTIVE", removedAt: NOW });
    expect(st.memberships).toHaveLength(2);
    expect(u("p").tokenVersion).toBe(0);
    expect(invariantHolds("p")).toBe(true);
  });

  it("D3: moves someone anchored here to their usable seat elsewhere, leaving the ended seat here, with no sign out", async () => {
    person("p", "a", { accessLevel: "MANAGER", status: "ON_LEAVE" });
    seat("p", "b", { role: "COMPANY_ADMIN" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "moved", anchoredIn: "b", from: "a" });
    // The account is B's now: B's level and status, never removed, still signed in.
    expect(u("p")).toMatchObject({ organizationId: "b", accessLevel: "COMPANY_ADMIN", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
    // A keeps the ended seat, at the level held there, as the record and the way back.
    expect(m("p", "a")).toMatchObject({ role: "MANAGER", status: "INACTIVE", removedAt: NOW });
    expect(invariantHolds("p")).toBe(true);
  });

  it("D3: a deactivation leaves the seat here deactivated, not removed", async () => {
    person("p", "a");
    seat("p", "b");
    expect((await endSeat(T, { userId: "p", organizationId: "a", kind: "deactivated", now: NOW })).outcome).toBe("moved");
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(u("p")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
  });

  it("D3: picks the best usable seat as sign-in does (primary first, then oldest), passing over ended, suspended, closed and taken ones", async () => {
    person("p", "a");
    seat("p", "held"); // a live seat in a suspended workspace: not usable
    seat("p", "closed"); // a closed workspace: not usable
    seat("p", "b", { status: "INACTIVE" }); // deactivated in B: not usable
    seat("p", "c", { removedAt: new Date("2026-09-01") }); // removed from C: not usable
    st.orgs.set("d", "ACTIVE");
    st.orgs.set("e", "ACTIVE");
    st.orgs.set("f", "ACTIVE");
    seat("p", "d"); // oldest usable, but an account with the same email is anchored there
    person("twin", "d", { email: "p@x.test" });
    seat("p", "e"); // the oldest usable one left
    seat("p", "f");
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toMatchObject({ outcome: "moved", anchoredIn: "e" });

    // And a primary seat wins over an older one.
    st.users.clear();
    st.memberships.length = 0;
    person("q", "a");
    seat("q", "b");
    seat("q", "c", { isPrimary: true });
    expect(await endSeat(T, { userId: "q", organizationId: "a", kind: "deactivated", now: NOW })).toMatchObject({ outcome: "moved", anchoredIn: "c" });
  });

  it("D4: with no usable seat anywhere else, ends the account and its sessions, as before", async () => {
    person("p", "a");
    seat("p", "held");
    seat("p", "b", { status: "INACTIVE" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "account_ended", anchoredIn: "a", strandedIn: [] });
    expect(u("p")).toMatchObject({ organizationId: "a", status: "INACTIVE", deletedAt: NOW, tokenVersion: 1 });
    // Another workspace's seat is never written.
    expect(m("p", "held")).toMatchObject({ status: "ACTIVE", removedAt: null });
    expect(m("p", "b")).toMatchObject({ status: "INACTIVE", removedAt: null });

    person("solo", "a");
    expect(await endSeat(T, { userId: "solo", organizationId: "a", kind: "deactivated", now: NOW })).toEqual({ outcome: "account_ended", anchoredIn: "a", strandedIn: [] });
    expect(u("solo")).toMatchObject({ status: "INACTIVE", deletedAt: null, tokenVersion: 1 });
    expect(invariantHolds("p")).toBe(true);
    expect(invariantHolds("solo")).toBe(true);
  });

  it("D4: removes a person already deactivated here, keeping them ended", async () => {
    person("p", "a", { status: "INACTIVE" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "account_ended", anchoredIn: "a", strandedIn: [] });
    expect(u("p")).toMatchObject({ status: "INACTIVE", deletedAt: NOW });
  });

  it("writes nothing for a seat already ended that way, or no seat here", async () => {
    const before = new Date("2026-10-01");
    person("p", "a", { status: "INACTIVE", deletedAt: before });
    seat("p", "b", { status: "INACTIVE", removedAt: before });
    seat("p", "c", { status: "INACTIVE" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "already_ended", anchoredIn: "a" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "deactivated", now: NOW })).toEqual({ outcome: "already_ended", anchoredIn: "a" });
    expect(await endSeat(T, { userId: "p", organizationId: "b", kind: "removed", now: NOW })).toEqual({ outcome: "already_ended", anchoredIn: "a" });
    expect(await endSeat(T, { userId: "p", organizationId: "c", kind: "deactivated", now: NOW })).toEqual({ outcome: "already_ended", anchoredIn: "a" });
    expect(await endSeat(T, { userId: "p", organizationId: "closed", kind: "removed", now: NOW })).toEqual({ outcome: "not_here", anchoredIn: "a" });
    expect(await endSeat(T, { userId: "nobody", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "not_here", anchoredIn: null });
    expect(writes()).toEqual([]);
    // The removal moment is kept.
    expect(u("p").deletedAt).toBe(before);
    expect(m("p", "b")?.removedAt).toBe(before);
  });

  it("removes a seat that was only deactivated, stamping the removal", async () => {
    person("p", "a");
    seat("p", "b", { status: "INACTIVE" });
    expect(await endSeat(T, { userId: "p", organizationId: "b", kind: "removed", now: NOW })).toEqual({ outcome: "membership_ended", anchoredIn: "a" });
    expect(m("p", "b")).toMatchObject({ status: "INACTIVE", removedAt: NOW });
  });

  it("takes the person's row lock before it reads them", async () => {
    person("p", "a");
    seat("p", "b");
    await endSeat(T, { userId: "p", organizationId: "b", kind: "removed", now: NOW });
    expect(st.log[0]).toBe("lock:p");
    expect(st.log[1]).toBe("user.findUnique");
  });
});

describe("restoreSeat", () => {
  it("restores a removed membership here, leaving the live anchor and every other seat as they are", async () => {
    person("p", "a");
    seat("p", "b", { status: "INACTIVE", removedAt: new Date("2026-10-01"), role: "MANAGER" });
    seat("p", "c", { status: "INACTIVE" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored" })).toEqual({ outcome: "restored", seat: "membership", anchoredIn: "a", movedFrom: null, anchorEnded: false, alsoRestoredIn: [] });
    expect(m("p", "b")).toMatchObject({ status: "ACTIVE", removedAt: null, role: "MANAGER" });
    expect(m("p", "c")).toMatchObject({ status: "INACTIVE" });
    expect(u("p")).toMatchObject({ organizationId: "a", status: "ACTIVE", tokenVersion: 0 });
  });

  it("reactivates a deactivated membership at the status asked for", async () => {
    person("p", "a");
    seat("p", "b", { status: "INACTIVE" });
    expect((await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated", status: "ON_LEAVE" })).outcome).toBe("restored");
    expect(m("p", "b")).toMatchObject({ status: "ON_LEAVE", removedAt: null });
  });

  it("restores and reactivates the anchored seat as before", async () => {
    person("p", "a", { status: "INACTIVE", deletedAt: new Date("2026-10-01") });
    expect(await restoreSeat(T, { userId: "p", organizationId: "a", kind: "restored" })).toEqual({ outcome: "restored", seat: "anchor", anchoredIn: "a", movedFrom: null, anchorEnded: false, alsoRestoredIn: [] });
    expect(u("p")).toMatchObject({ status: "ACTIVE", deletedAt: null, tokenVersion: 0 });

    person("q", "a", { status: "INACTIVE" });
    expect((await restoreSeat(T, { userId: "q", organizationId: "a", kind: "reactivated", status: "PROBATION" })).outcome).toBe("restored");
    expect(u("q")).toMatchObject({ status: "PROBATION", deletedAt: null });
  });

  it("D6: moves an ended anchor to the workspace that restored them, keeping the ended seat it leaves", async () => {
    // Removed from A when they had nowhere else; then B, which had removed them earlier, restores them.
    const removedFromA = new Date("2026-10-20");
    person("p", "a", { status: "INACTIVE", deletedAt: removedFromA, accessLevel: "MANAGER", tokenVersion: 3 });
    seat("p", "b", { status: "INACTIVE", removedAt: new Date("2026-10-10"), role: "EMPLOYEE" });
    expect(invariantHolds("p")).toBe(true);
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored" })).toEqual({ outcome: "restored", seat: "membership", anchoredIn: "b", movedFrom: "a", anchorEnded: false, alsoRestoredIn: [] });
    expect(u("p")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null, accessLevel: "EMPLOYEE", tokenVersion: 3 });
    expect(m("p", "a")).toMatchObject({ role: "MANAGER", status: "INACTIVE", removedAt: removedFromA });
    // Before the move, a usable seat in B sat beside an ended anchor (D7 broken).
    expect(invariantHolds("p")).toBe(true);
  });

  it("D6: a deactivated anchor moves too, on a reactivation", async () => {
    person("p", "a", { status: "INACTIVE" });
    seat("p", "b", { status: "INACTIVE" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" })).toMatchObject({ outcome: "restored", anchoredIn: "b", movedFrom: "a" });
    expect(u("p")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null });
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", removedAt: null });
  });

  it("D6: says so when an ended anchor cannot move here (an account with the same email is anchored here)", async () => {
    person("p", "a", { status: "INACTIVE" });
    seat("p", "b", { status: "INACTIVE" });
    person("twin", "b", { email: "p@x.test" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" })).toEqual({ outcome: "restored", seat: "membership", anchoredIn: "a", movedFrom: null, anchorEnded: true, alsoRestoredIn: [] });
    expect(u("p").organizationId).toBe("a");
  });

  it("never brings back an account its own person erased", async () => {
    const erased = new Date("2026-10-25T12:00:00Z");
    person("p", "a", { status: "INACTIVE", deletedAt: erased });
    seat("p", "b", { status: "INACTIVE", removedAt: erased });
    st.erasures.set("p", erased);
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored" })).toEqual({ outcome: "erased", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "a", kind: "restored" })).toEqual({ outcome: "erased", anchoredIn: "a" });
    expect(writes()).toEqual([]);
  });

  it("refuses, writing nothing, a seat that is not ended the way asked, or no seat here", async () => {
    person("p", "a");
    seat("p", "b");
    seat("p", "c", { status: "INACTIVE", removedAt: NOW });
    person("q", "a", { status: "INACTIVE", deletedAt: NOW });
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored" })).toEqual({ outcome: "not_ended", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" })).toEqual({ outcome: "not_ended", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "c", kind: "reactivated" })).toEqual({ outcome: "removed", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "a", kind: "restored" })).toEqual({ outcome: "not_ended", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "q", organizationId: "a", kind: "reactivated" })).toEqual({ outcome: "removed", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "p", organizationId: "closed", kind: "restored" })).toEqual({ outcome: "not_here", anchoredIn: "a" });
    expect(await restoreSeat(T, { userId: "nobody", organizationId: "a", kind: "restored" })).toEqual({ outcome: "not_here", anchoredIn: null });
    expect(writes()).toEqual([]);
    await expect(restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored", status: "INACTIVE" as never })).rejects.toThrow(/never INACTIVE/);
  });

  it("takes the person's row lock before it reads them", async () => {
    person("p", "a");
    seat("p", "b", { status: "INACTIVE" });
    await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" });
    expect(st.log.slice(0, 2)).toEqual(["lock:p", "user.findUnique"]);
  });
});

// The founder's two companies, through every step, with the invariant of D7
// checked after each: A ends nothing in B, and B ends nothing in A.
describe("one person in two workspaces, end to end", () => {
  it("B deactivates, A works on; A removes, the person lands in B; A restores; the switcher swaps the status back and forth", async () => {
    person("p", "a");
    seat("p", "b");
    // B deactivates them: A untouched, no sign out.
    expect((await endSeat(T, { userId: "p", organizationId: "b", kind: "deactivated", now: NOW })).outcome).toBe("membership_ended");
    expect(u("p")).toMatchObject({ organizationId: "a", status: "ACTIVE", tokenVersion: 0 });
    expect(invariantHolds("p")).toBe(true);
    // B reactivates them.
    expect((await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" })).outcome).toBe("restored");
    expect(invariantHolds("p")).toBe(true);
    // A removes them: they land in B, still signed in there.
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toMatchObject({ outcome: "moved", anchoredIn: "b" });
    expect(u("p")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null, tokenVersion: 0 });
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", removedAt: NOW });
    expect(invariantHolds("p")).toBe(true);
    // A restores them: A's membership comes back; the anchor stays in B.
    expect(await restoreSeat(T, { userId: "p", organizationId: "a", kind: "restored" })).toMatchObject({ outcome: "restored", seat: "membership", anchoredIn: "b", movedFrom: null });
    // The switcher back to A: the account takes A's (live) seat, and B keeps its own.
    await reanchorUser({ userId: "p", to: { organizationId: "a", role: "EMPLOYEE" } }, T);
    expect(u("p")).toMatchObject({ organizationId: "a", status: "ACTIVE", deletedAt: null });
    expect(m("p", "b")).toMatchObject({ status: "ACTIVE", removedAt: null });
    expect(invariantHolds("p")).toBe(true);
    // Now B removes them through its membership, then A deactivates them: nowhere left, the account ends.
    expect((await endSeat(T, { userId: "p", organizationId: "b", kind: "removed", now: NOW })).outcome).toBe("membership_ended");
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "deactivated", now: NOW })).toEqual({ outcome: "account_ended", anchoredIn: "a", strandedIn: [] });
    expect(u("p")).toMatchObject({ organizationId: "a", status: "INACTIVE", deletedAt: null, tokenVersion: 1 });
    expect(invariantHolds("p")).toBe(true);
    // B restores them: the ended anchor comes to B (D6), and A keeps its deactivation.
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "restored" })).toMatchObject({ outcome: "restored", anchoredIn: "b", movedFrom: "a" });
    expect(u("p")).toMatchObject({ organizationId: "b", status: "ACTIVE", deletedAt: null });
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", removedAt: null });
    expect(invariantHolds("p")).toBe(true);
  });
});

// acting-workspace.ts inWorkspaceWhere: an ended membership counts as none
// by default (D7, D12). A caller that keeps deactivated people anchored here
// (it filters User.deletedAt only) passes `deactivatedToo`, so it keeps a
// deactivated membership person too and its behaviour is unchanged: the
// one-time step of prisma/sql/2026-11-01-membership-status.sql made the
// memberships of every deactivated account INACTIVE, and without the option
// those people would have dropped out of these reads on the deploy. A new
// caller fails this test until it is listed here with its reason.
describe("every caller of inWorkspaceWhere says which people it means", () => {
  const CALLERS: Record<string, { deactivatedToo: string; count: number; why: string }> = {
    "src/app/api/calendar/events/route.ts": { deactivatedToo: "true", count: 2, why: "the Team pill: reports not removed, as the anchored rows it reads (deletedAt only)" },
    "src/app/api/users/[id]/agent-reports/route.ts": { deactivatedToo: "true", count: 1, why: "moving an Agent's reports: anyone here not removed, a deactivated person included" },
    "src/app/api/users/[id]/record-access/route.ts": { deactivatedToo: "true", count: 2, why: "the solid line walks through a deactivated manager and stops at a removed one, as for anchored rows" },
    "src/lib/people/teams-counts.ts": { deactivatedToo: "true", count: 2, why: "the Teams badge counts reports not removed, as the anchored rows it reads" },
    "src/lib/people/team-scope.server.ts": { deactivatedToo: "!!opts.includeDeactivated", count: 1, why: "My team's chain, with deactivated people only when asked, as its workspacePeopleLines half" },
    "src/lib/goals/goal-period-notify.server.ts": { deactivatedToo: "default", count: 1, why: "live people only (status not INACTIVE): an ended membership is none" },
    "src/lib/people/employed.server.ts": { deactivatedToo: "default", count: 1, why: "employed people only (status not INACTIVE): an ended membership is none" },
  };

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (name === "generated" || name.startsWith(".")) continue;
      if (statSync(p).isDirectory()) sources(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("lists each one, with the option it passes", () => {
    const ROOT = process.cwd();
    const found: Record<string, number> = {};
    for (const file of sources(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel === "src/lib/access/acting-workspace.ts") continue;
      const n = (readFileSync(file, "utf8").match(/\binWorkspaceWhere\(/g) ?? []).length;
      if (n > 0) found[rel] = n;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(CALLERS).map(([f, c]) => [f, c.count])));
    for (const [file, c] of Object.entries(CALLERS)) {
      const calls = [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/\binWorkspaceWhere\(([^)]*\)?)\)/g)].map((x) => x[1]);
      expect(calls, file).toHaveLength(c.count);
      for (const call of calls) {
        if (c.deactivatedToo === "default") expect(call, file).not.toContain("deactivatedToo");
        else expect(call, file).toContain(`{ deactivatedToo: ${c.deactivatedToo} }`);
      }
    }
  });
});

// Step 1 review M1 (D16): the one-time SQL step ends every membership of an
// ended account, each marked endedWithAccount, since that was the anchored
// workspace's decision, copied. Before the mark, a restore of the anchored
// seat brought back that workspace only, where the account-wide restore had
// brought back every one.
describe("seats the one-time step ended with the account", () => {
  const before = new Date("2026-09-15T08:00:00Z");

  it("come back with a restore of the anchored seat, unchecked, and nothing else does", async () => {
    person("p", "a", { status: "INACTIVE", deletedAt: before });
    seat("p", "a", { status: "INACTIVE", removedAt: before, endedWithAccount: true }); // the anchored workspace's own stale row
    seat("p", "b", { status: "INACTIVE", removedAt: before, endedWithAccount: true });
    seat("p", "c", { status: "INACTIVE", removedAt: null, endedWithAccount: true });
    seat("p", "held", { status: "INACTIVE", removedAt: new Date("2026-10-20") }); // ended by its own workspace, after the deploy
    const r = await restoreSeat(T, { userId: "p", organizationId: "a", kind: "restored" });
    expect(r).toMatchObject({ outcome: "restored", seat: "anchor", anchoredIn: "a" });
    expect(r.outcome === "restored" && [...r.alsoRestoredIn].sort()).toEqual(["b", "c"]);
    for (const org of ["b", "c"]) expect(m("p", org)).toMatchObject({ status: "ACTIVE", removedAt: null, endedWithAccount: false });
    expect(m("p", "held")).toMatchObject({ status: "INACTIVE", endedWithAccount: false });
    // The anchored workspace's own row is not a seat while anchored there: left as it was.
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", endedWithAccount: true });
    expect(invariantHolds("p")).toBe(true);
  });

  it("a reactivation brings back the copied deactivations at ACTIVE, and leaves a copied removal for a restore", async () => {
    person("p", "a", { status: "INACTIVE", accessLevel: "MANAGER" });
    seat("p", "b", { status: "INACTIVE", endedWithAccount: true });
    seat("p", "c", { status: "INACTIVE", removedAt: before, endedWithAccount: true });
    const r = await restoreSeat(T, { userId: "p", organizationId: "a", kind: "reactivated", status: "ON_LEAVE" });
    expect(r).toMatchObject({ outcome: "restored", alsoRestoredIn: ["b"] });
    // The HR status is the anchored workspace's: B comes back ACTIVE.
    expect(u("p").status).toBe("ON_LEAVE");
    expect(m("p", "b")).toMatchObject({ status: "ACTIVE", removedAt: null, endedWithAccount: false });
    expect(m("p", "c")).toMatchObject({ status: "INACTIVE", removedAt: before, endedWithAccount: true });
  });

  it("a workspace's own decision clears the mark, so the anchored restore leaves that seat ended", async () => {
    person("p", "a", { status: "INACTIVE" });
    seat("p", "b", { status: "INACTIVE", endedWithAccount: true });
    seat("p", "c", { status: "INACTIVE", endedWithAccount: true });
    seat("p", "d", { status: "INACTIVE", endedWithAccount: true });
    st.orgs.set("d", "ACTIVE");
    // B deactivates them itself (already ended: nothing else written, the mark goes).
    expect(await endSeat(T, { userId: "p", organizationId: "b", kind: "deactivated", now: NOW })).toEqual({ outcome: "already_ended", anchoredIn: "a" });
    expect(m("p", "b")).toMatchObject({ status: "INACTIVE", removedAt: null, endedWithAccount: false });
    // C removes them itself.
    expect((await endSeat(T, { userId: "p", organizationId: "c", kind: "removed", now: NOW })).outcome).toBe("membership_ended");
    expect(m("p", "c")).toMatchObject({ status: "INACTIVE", removedAt: NOW, endedWithAccount: false });
    // A reactivates them: only D, still carrying the copied decision, comes back with A.
    expect(await restoreSeat(T, { userId: "p", organizationId: "a", kind: "reactivated" })).toMatchObject({ alsoRestoredIn: ["d"] });
    expect(m("p", "b")?.status).toBe("INACTIVE");
    expect(m("p", "c")?.status).toBe("INACTIVE");
    expect(m("p", "d")).toMatchObject({ status: "ACTIVE", endedWithAccount: false });
  });

  it("a restore of the membership itself clears its mark, and so does the seat a move leaves", async () => {
    person("p", "a", { status: "INACTIVE" });
    seat("p", "b", { status: "INACTIVE", endedWithAccount: true });
    seat("p", "a", { status: "INACTIVE", endedWithAccount: true });
    // B brings them back itself: its mark goes, and the ended anchor moves to B (D6), the seat it leaves unmarked.
    expect(await restoreSeat(T, { userId: "p", organizationId: "b", kind: "reactivated" })).toMatchObject({ outcome: "restored", movedFrom: "a", alsoRestoredIn: [] });
    expect(m("p", "b")?.endedWithAccount).toBe(false);
    expect(m("p", "a")).toMatchObject({ status: "INACTIVE", endedWithAccount: false });
  });
});

// Step 1 review L5: a usable seat the account cannot move to (an account
// with the same email is anchored there) was hidden behind account_ended.
describe("endSeat names the seats a same-email account strands", () => {
  it("answers account_ended with the workspaces whose usable seat it could not move to", async () => {
    person("p", "a");
    seat("p", "b");
    seat("p", "c", { status: "INACTIVE" });
    person("twin", "b", { email: "p@x.test" });
    expect(await endSeat(T, { userId: "p", organizationId: "a", kind: "removed", now: NOW })).toEqual({ outcome: "account_ended", anchoredIn: "a", strandedIn: ["b"] });
    expect(u("p")).toMatchObject({ status: "INACTIVE", deletedAt: NOW, tokenVersion: 1 });
  });
});
