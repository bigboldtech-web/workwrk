// Whether an account was erased by its own person (POST /api/me/delete),
// whatever later happened to its User row (review round 8 of Phase 3).
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
// Every path that can change an erased account's identity or bring it back
// refuses with ACCOUNT_ERASED (SCIM answers as for an unknown user).
//
// Server-only: callers pass their database client.

import type { Prisma } from "@/generated/prisma";

/** The erasure's own consent record (POST /api/me/delete): the legal record of the request. */
export const ERASURE_METHOD = "erasure";

/** The answer of a refused change to an erased account (409, People and the avatar route). */
export const ACCOUNT_ERASED = {
  error: "This person deleted their own account, so it can't be changed or restored. Invite them again if they're coming back.",
  code: "account_erased",
} as const;

/** True when the account's own person erased it: their erasure's provenance record exists. */
export async function isErasedAccount(db: Pick<Prisma.TransactionClient, "consentRecord">, userId: string): Promise<boolean> {
  const record = await db.consentRecord.findFirst({
    where: { userId, method: ERASURE_METHOD, withdrawnAt: { not: null } },
    select: { id: true },
  });
  return record !== null;
}
