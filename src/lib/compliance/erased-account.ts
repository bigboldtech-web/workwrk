// Whether an account is erased: in the state its own person's erasure (POST
// /api/me/delete) left it (review rounds 8 and 9 of Phase 3).
//
// WHY. The erasure anonymises the User row (deleted-<id>@workwrk.anon,
// "Deleted User") and sets deletedAt, and the erasure sweep used to
// recognise an erased account by those two alone. But an identity provider's
// SCIM push could write the person's real address and names back onto the
// row, and an Admin's restore in People could set deletedAt back to null.
// After either, the account was named again, and the sweep's bridge never
// gave it an AccountErasure row, so the person's words stayed for good.
//
// THE PROVENANCE RECORD. Every version of the delete route, since it was
// added in April 2026, writes a ConsentRecord with method "erasure", the
// person's userId and withdrawnAt set, in the erasure's own transaction.
// POST /api/consent never sets withdrawnAt (and since review round 6 never
// stores the method "erasure"), and DELETE /api/consent writes "withdrawn".
// So that record marks a real erasure request and nothing else, and nothing
// rewrites it. Read through the consent records' userId index, or the
// partial index of prisma/sql/2026-10-11-ai-teammates-phase3-round7.sql.
//
// THE ERASED STATE (review round 9 of Phase 3). Round 8 called an account
// erased whenever that record existed, whatever happened to the account
// after. But an Admin could restore an erased account before round 8, and it
// may be in use again, with months of a person's new work. When an Admin then
// removed it, the sweep re-anonymised it and blanked all of that work, which
// nobody can undo, and People refused every edit while it lived. Now an
// account is erased only while it is in the state its erasure left it:
//   - the provenance record exists;
//   - the account's deletedAt is set;
//   - and that deletedAt is within ERASED_STATE_TOLERANCE_MS of the newest
//     such record's withdrawnAt.
// The delete route sets deletedAt and withdrawnAt in one transaction: from
// one `now` today, and before review round 5 from two `new Date()` calls
// inside one transaction of at most 20 seconds, so they were never more than
// 20 seconds apart. A restore sets deletedAt to null, and a removal after a
// restore sets a deletedAt far from the erasure's, so neither is in the
// erased state, and the account is an ordinary one in every path. An erasure
// asked again (after a restore) writes a newer record beside a new deletedAt,
// so the account is erased again.
//
// ONE RULE. inErasedState is the rule on values already read;
// isErasedAccount reads them for one account (People, SCIM and the avatar
// route); erasedStateSql is the same rule in SQL, for the erasure sweep's
// statements (src/lib/agents/erasure-sweep.ts).
//
// Every path that can change an erased account's identity or bring it back
// refuses with ACCOUNT_ERASED (SCIM answers as for an unknown user), and no
// path moves an erased account's deletedAt (People's removal sets it only
// where it is null), so the erased state is never broken by accident.
//
// Server-only: callers pass their database client.

import { Prisma } from "@/generated/prisma";

/** The erasure's own consent record (POST /api/me/delete): the legal record of the request. */
export const ERASURE_METHOD = "erasure";

/**
 * How far an erased account's deletedAt may be from its newest erasure
 * record's withdrawnAt (review round 9 of Phase 3). Both are written in the
 * erasure's one transaction, at most 20 seconds apart in any version of the
 * delete route; a restore or a later removal moves deletedAt much further.
 */
export const ERASED_STATE_TOLERANCE_MS = 60_000;

/** The answer of a refused change to an erased account (409, People and the avatar route). */
export const ACCOUNT_ERASED = {
  error: "This person deleted their own account, so it can't be changed or restored. Invite them again if they're coming back.",
  code: "account_erased",
} as const;

/**
 * The erased state on values already read: the account's deletedAt, and the
 * withdrawnAt of its newest erasure record (null when it has none).
 */
export function inErasedState(deletedAt: Date | null | undefined, newestErasureAt: Date | null | undefined): boolean {
  if (!deletedAt || !newestErasureAt) return false;
  return Math.abs(deletedAt.getTime() - newestErasureAt.getTime()) <= ERASED_STATE_TOLERANCE_MS;
}

/** True when the account is in the state its own person's erasure left it (see the header). */
export async function isErasedAccount(db: Pick<Prisma.TransactionClient, "consentRecord" | "user">, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
  // A live account is never erased: its records need no read.
  if (!user?.deletedAt) return false;
  const record = await db.consentRecord.findFirst({
    where: { userId, method: ERASURE_METHOD, withdrawnAt: { not: null } },
    orderBy: { withdrawnAt: "desc" },
    select: { withdrawnAt: true },
  });
  return inErasedState(user.deletedAt, record?.withdrawnAt ?? null);
}

/**
 * The erased state in SQL, for the User row aliased `alias` (review round 9
 * of Phase 3): true or false, never null, so NOT of it is safe. The newest
 * erasure record is read through the round 7 partial index ("userId",
 * "createdAt") WHERE "method" = 'erasure'; the method is a literal so the
 * planner can match that index. Every value in it is this module's own
 * constant, so it carries no parameter.
 */
export function erasedStateSql(alias: string): Prisma.Sql {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error(`erasedStateSql: "${alias}" is not a plain alias`);
  const near = `interval '${ERASED_STATE_TOLERANCE_MS} milliseconds'`;
  return Prisma.raw(
    `(${alias}."deletedAt" IS NOT NULL AND COALESCE((` +
      `SELECT max(ers."withdrawnAt") FROM "ConsentRecord" ers ` +
      `WHERE ers."userId" = ${alias}."id" AND ers."method" = '${ERASURE_METHOD}' AND ers."withdrawnAt" IS NOT NULL` +
      `) BETWEEN ${alias}."deletedAt" - ${near} AND ${alias}."deletedAt" + ${near}, false))`,
  );
}
