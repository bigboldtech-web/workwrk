// The erased state (src/lib/compliance/erased-account.ts; review round 9 of
// Phase 3). Round 8 called an account erased whenever its erasure's
// provenance record existed, so an erased account an Admin restored before
// round 8, used again and then removed, was re-anonymised and blanked by the
// sweep, its new work with it, and People refused every edit while it lived.
// Now an account is erased only while its deletedAt is within a minute of its
// newest erasure record's withdrawnAt.

import { describe, expect, it } from "vitest";
import { ERASED_STATE_TOLERANCE_MS, erasedStateSql, inErasedState, isErasedAccount } from "./erased-account";

const AT = new Date("2026-10-01T09:00:00.000Z");
const plus = (ms: number) => new Date(AT.getTime() + ms);

describe("inErasedState", () => {
  it("is the erasure's moment, within a minute on either side, and nothing else", () => {
    expect(ERASED_STATE_TOLERANCE_MS).toBe(60_000);
    expect(inErasedState(AT, AT)).toBe(true);
    expect(inErasedState(plus(60_000), AT)).toBe(true);
    expect(inErasedState(plus(-60_000), AT)).toBe(true);
    expect(inErasedState(plus(60_001), AT)).toBe(false);
    expect(inErasedState(plus(-60_001), AT)).toBe(false);
    // Restored (deletedAt null), or no erasure record at all.
    expect(inErasedState(null, AT)).toBe(false);
    expect(inErasedState(AT, null)).toBe(false);
  });
});

/** A database double: the account's deletedAt, and its consent records, the newest first when asked. */
function db(deletedAt: Date | null, records: Array<{ method: string; withdrawnAt: Date | null }>) {
  const reads: unknown[] = [];
  return {
    reads,
    client: {
      user: { findUnique: async () => ({ deletedAt }) },
      consentRecord: {
        findFirst: async (a: { where: { method: string; withdrawnAt: unknown }; orderBy?: { withdrawnAt?: "desc" } }) => {
          reads.push(a);
          const hit = records.filter((r) => r.method === a.where.method && r.withdrawnAt !== null);
          if (a.orderBy?.withdrawnAt === "desc") hit.sort((x, y) => (y.withdrawnAt as Date).getTime() - (x.withdrawnAt as Date).getTime());
          return hit[0] ?? null;
        },
      },
    } as never,
  };
}

describe("isErasedAccount", () => {
  it("is false for an erased account an Admin restored, or removed after a restore; true while it is as its erasure left it", async () => {
    const erasure = { method: "erasure", withdrawnAt: AT };
    // Before: true for all three, the record alone.
    expect(await isErasedAccount(db(null, [erasure]).client, "u1")).toBe(false);
    expect(await isErasedAccount(db(plus(19 * 24 * 60 * 60_000), [erasure]).client, "u1")).toBe(false);
    expect(await isErasedAccount(db(plus(60_001), [erasure]).client, "u1")).toBe(false);
    expect(await isErasedAccount(db(AT, [erasure]).client, "u1")).toBe(true);
    expect(await isErasedAccount(db(plus(60_000), [erasure]).client, "u1")).toBe(true);
    // A deleted account with no erasure record, or only a forged one without withdrawnAt.
    expect(await isErasedAccount(db(AT, [{ method: "erasure", withdrawnAt: null }]).client, "u1")).toBe(false);
  });

  it("goes by the newest erasure: erased, restored, and erased again by its person", async () => {
    const later = plus(30 * 24 * 60 * 60_000);
    const d = db(later, [
      { method: "erasure", withdrawnAt: AT },
      { method: "erasure", withdrawnAt: later },
    ]);
    expect(await isErasedAccount(d.client, "u1")).toBe(true);
    expect(d.reads[0]).toMatchObject({ where: { userId: "u1", method: "erasure", withdrawnAt: { not: null } }, orderBy: { withdrawnAt: "desc" } });
  });

  it("reads no record for a live account", async () => {
    const d = db(null, [{ method: "erasure", withdrawnAt: AT }]);
    expect(await isErasedAccount(d.client, "u1")).toBe(false);
    expect(d.reads).toEqual([]);
  });
});

describe("erasedStateSql", () => {
  it("is the same rule, never null, with no parameter, for the alias it is given", () => {
    const frag = erasedStateSql("u");
    expect(frag.values).toEqual([]);
    const text = frag.sql.replace(/\s+/g, " ");
    expect(text).toContain('u."deletedAt" IS NOT NULL AND COALESCE((');
    expect(text).toContain(`SELECT max(ers."withdrawnAt") FROM "ConsentRecord" ers WHERE ers."userId" = u."id" AND ers."method" = 'erasure' AND ers."withdrawnAt" IS NOT NULL`);
    expect(text).toContain(`BETWEEN u."deletedAt" - interval '60000 milliseconds' AND u."deletedAt" + interval '60000 milliseconds', false))`);
    expect(() => erasedStateSql('u"; DROP TABLE "User"')).toThrow();
  });
});
