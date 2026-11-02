// A person's name and sign-in address are ONE row (User) that every
// workspace they belong to reads (docs/plans/workspace-status.md, the final
// review, security H1). The address is how they sign in everywhere and where
// a password reset is mailed (src/app/api/auth/forgot-password/route.ts), so
// whoever may rewrite it may take the account over in every workspace.
//
// Before, the workspace an account was anchored to could rewrite them for
// anyone anchored there, through its identity provider (SCIM PUT and PATCH)
// or its Admins (PATCH /api/users/[id]). Since D3, D6, the D7 repair and the
// hard delete's moveHomesOutOf, an account lands in another workspace by
// someone else's action, so that workspace's identity provider (or anyone
// holding its SCIM token) could set the address of a person who also works
// for A and C to one it owns, mail itself a reset link and be them in A and C.
//
// So while the account holds ANY membership in another workspace, in any
// state (a removed one included: the person may be restored there, and a
// workspace that removed them still holds their history), only the person
// changes their name and address:
//   - SCIM (PUT, PATCH, the POST revive) never writes them, and still answers
//     success with the stored values, so the identity provider's sync does
//     not break (src/app/api/scim/v2/Users/[id]/route.ts, src/lib/scim-reactivate.ts);
//   - a workspace Admin's write of them for someone anchored here is refused
//     with SHARED_IDENTITY_REFUSAL (PATCH /api/users/[id]).
// Someone who works here through a membership was already never written
// (their account is their anchored workspace's). Staff console writes are a
// WorkwrK decision and out of this rule.
//
// A leaf: it imports no access module.

import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** The refusal a workspace Admin's write of a shared name or address gets (403 identity_shared). */
export const SHARED_IDENTITY_REFUSAL = "Their name and sign-in address are shared with another workspace, so only they can change them.";

/** The account's columns that are the person's identity everywhere: the sign-in address, its proof, and the names. */
export const IDENTITY_FIELDS = ["email", "emailVerifiedAt", "firstName", "lastName"] as const;

/**
 * Whether this account's name and address are shared with another workspace:
 * it holds an OrganizationMembership row in any workspace but this one, in
 * any state, removed included. The row of this workspace itself (stale while
 * the account is anchored here) never counts. One indexed count.
 */
export async function identityShared(db: Db, userId: string, organizationId: string): Promise<boolean> {
  const n = await db.organizationMembership.count({ where: { userId, organizationId: { not: organizationId } } });
  return n > 0;
}

/** Whether a write names any identity field. */
export function touchesIdentity(data: Record<string, unknown>): boolean {
  return IDENTITY_FIELDS.some((k) => data[k] !== undefined);
}

/** The write with every identity field left out (a copy; the rest kept as it is). */
export function withoutIdentity<T extends Record<string, unknown>>(data: T): T {
  const out = { ...data };
  for (const k of IDENTITY_FIELDS) delete out[k];
  return out;
}
