// When a person joined ONE workspace (docs/plans/workspace-status.md, the
// step 4 review H1): what the rule "the earliest Admin is an Owner" reads
// (companies-list.ts ownerIdsOf), and every "joined" a workspace shows of
// someone (Members, the Directory, the record), whichever row holds their
// seat there now.
//
// A person's own membership row for a workspace is the record of when they
// joined it, with one exception: the "home" row, the first workspace the
// account ever left (workspace-anchor.ts leavingIsPrimary marks it
// isPrimary), is the workspace the account was made in (or first anchored
// to), and that row was made at the moment of the move, too late. So:
//
//   no row here          the account's creation (anchored here, never left)
//   the primary row      the account's creation (made here, left, maybe back)
//   any other row        that row's creation (joined here then)
//
// Before, an anchored person was dated by the account and a membership
// person by the row, so the date flipped with every switch: a contractor
// whose account was made at her agency in 2019 became client B's earliest
// Admin, and so an Owner, the moment she opened B; B's founder, working in
// another workspace, stopped being A's Owner. Now the answer never depends
// on where the account is anchored. No row is rewritten (the coordinator's
// ruling: a code rule, no one-time SQL); reanchorUser's create branch is
// unchanged.
//
// A leaf: no reads of its own beyond joinRowsHere's one.

import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** What joinedHere reads of the person's own membership row for the workspace. */
export interface JoinRow {
  createdAt: Date;
  isPrimary: boolean;
}

/** When this person joined this workspace (see the header). */
export function joinedHere(row: JoinRow | null | undefined, account: { createdAt: Date }): Date {
  if (!row || row.isPrimary) return account.createdAt;
  return row.createdAt;
}

/** The select a JoinRow is read with. */
export const JOIN_ROW_SELECT = { createdAt: true, isPrimary: true } as const;

/**
 * These people's own membership rows for this workspace, by person: what
 * joinedHere reads for someone anchored here (the row of a workspace they
 * once left and came back to, or joined through a membership before they
 * switched in). One indexed read.
 */
export async function joinRowsHere(db: Db, organizationId: string, userIds: readonly string[]): Promise<Map<string, JoinRow>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db.organizationMembership.findMany({
    where: { organizationId, userId: { in: ids } },
    select: { userId: true, ...JOIN_ROW_SELECT },
  });
  return new Map(rows.map((r) => [r.userId, { createdAt: r.createdAt, isPrimary: r.isPrimary }]));
}
