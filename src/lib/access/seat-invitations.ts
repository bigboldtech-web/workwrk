// A seat that ends takes its workspace's open invitations for the person's
// address with it (docs/plans/workspace-status.md, the step 2 review H1).
//
// An ended membership is not "already a member" (D13): an invitation brings
// it back on acceptance. So an invitation that was still open when the seat
// ended (one an Admin sent before, or a Space editor's Space invitation)
// would let the person, or whoever resends it, undo the workspace's decision
// with no Admin deciding. Every write that ends a seat therefore ends those
// invitations in the same transaction (endSeat, the seat a move leaves
// ended, the erasure, the one-time SQL step). An invitation made after that
// is a fresh decision, and only an Admin may make or resend one for an
// address whose seat here is ended (sendInvitation, v1/people, PATCH
// /api/invitations).
//
// "Ended" the way an invitation already ends by itself: its expiresAt is set
// to now (Revoke deletes the row; an expired row stays listed under Pending
// invites, where an Admin can resend it). Only invitations still open are
// touched, so one that expired long ago keeps its date. The address is
// matched in any case, as every invitation read matches it.
//
// A leaf: it imports no access module, so workspace-anchor.ts and
// workspace-status.ts can both use it.

import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** Ends this address's open invitations in these workspaces (see the header). Returns how many ended. */
export async function endOpenInvitations(
  db: Db,
  input: { organizationIds: readonly string[]; email: string | null | undefined; now?: Date },
): Promise<number> {
  const email = input.email?.trim();
  const organizationIds = [...new Set(input.organizationIds)].filter(Boolean);
  if (!email || organizationIds.length === 0) return 0;
  const now = input.now ?? new Date();
  const r = await db.invitation.updateMany({
    where: { organizationId: { in: organizationIds }, accepted: false, expiresAt: { gt: now }, email: { equals: email, mode: "insensitive" } },
    data: { expiresAt: now },
  });
  return r.count;
}
