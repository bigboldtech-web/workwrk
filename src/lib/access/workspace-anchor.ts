// Moving a person from one workspace to another: the org switcher
// (POST /api/me/switch-org), the sign-in and session fallbacks that move
// someone out of a suspended or cancelled workspace (src/lib/auth.ts), and
// the hard delete, which moves out everyone who also belongs elsewhere
// before their home is deleted for good (moveHomesOutOf).
//
// Two things went wrong before. The person's access level (one column on
// User, meaning their level in the workspace they are anchored to) was
// carried into the next workspace unchanged, so someone who was an Admin at
// home arrived as an Admin wherever they went, and someone who created a new
// workspace arrived there as whatever they were at home. And the workspace
// they left kept no membership row, while the switcher lists memberships only,
// so a person who switched away from their company had no way back to it.
//
// So every move records the workspace being left as a membership carrying the
// level held there now (the first one becomes the primary, their home), and
// takes the level the target membership holds. One transaction, so the
// person is never anchored somewhere with the wrong level.

import { prisma } from "@/lib/prisma";
import type { AccessLevel, Prisma } from "@/generated/prisma";

type Db = typeof prisma | Prisma.TransactionClient;

export interface Reanchor {
  userId: string;
  /** Where they go, and the role their membership there holds. Where they
   *  are now, and the level they hold there, is read in the transaction. */
  to: { organizationId: string; role: AccessLevel };
}

/** Whether the membership kept for the workspace being left becomes the
 *  primary one: only when the person has no primary membership yet. */
export function leavingIsPrimary(hasPrimary: boolean): boolean {
  return !hasPrimary;
}

/** Moves the person; false when they were already anchored there (or are
 *  not found), so nothing changed. */
export async function reanchorUser(move: Reanchor, db?: Db): Promise<boolean> {
  const run = async (tx: Db): Promise<boolean> => {
    const now = await tx.user.findUnique({ where: { id: move.userId }, select: { organizationId: true, accessLevel: true, adminScopes: true } });
    if (!now || now.organizationId === move.to.organizationId) return false;
    const from = { organizationId: now.organizationId, accessLevel: now.accessLevel };
    const [primary, there] = await Promise.all([
      tx.organizationMembership.findFirst({ where: { userId: move.userId, isPrimary: true }, select: { id: true } }),
      tx.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: move.userId, organizationId: move.to.organizationId } },
        select: { adminScopes: true },
      }),
    ]);
    // The Admin scopes are a grant of one workspace: they stay on its
    // membership, and the account takes the ones held where it goes
    // (prisma/sql/2026-10-05-membership-admin-scopes.sql).
    const leavingScopes = now.adminScopes ?? [];
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: move.userId, organizationId: from.organizationId } },
      create: {
        userId: move.userId,
        organizationId: from.organizationId,
        role: from.accessLevel,
        isPrimary: leavingIsPrimary(!!primary),
        adminScopes: leavingScopes,
      },
      update: { role: from.accessLevel, adminScopes: leavingScopes },
    });
    await tx.user.update({
      where: { id: move.userId },
      data: { organizationId: move.to.organizationId, accessLevel: move.to.role, adminScopes: there?.adminScopes ?? [] },
    });
    return true;
  };
  if (db && db !== prisma) return run(db);
  return prisma.$transaction(async (tx) => run(tx));
}

/** Which of the other workspaces a person belongs to is worth moving into
 *  when their home is deleted for good: a working one first, else one that is
 *  suspended or closed, which may yet come back. Any of them keeps the
 *  account; deleting it would take everything it did there with it. */
const KEEP_RANK: Record<string, number> = { ACTIVE: 0, TRIAL: 0, SUSPENDED: 1, CANCELLED: 2 };

export interface MembershipElsewhere {
  userId: string;
  organizationId: string;
  role: AccessLevel;
  /** That workspace's status. */
  status: string;
}

/** Per person, the membership to move into: the best status, and within it
 *  the first in the order given (primary first, then oldest, as sign-in picks). */
export function homesElsewhere(rows: readonly MembershipElsewhere[]): Map<string, Reanchor["to"]> {
  const best = new Map<string, { rank: number; to: Reanchor["to"] }>();
  for (const r of rows) {
    const rank = KEEP_RANK[r.status] ?? 3;
    const had = best.get(r.userId);
    if (!had || rank < had.rank) best.set(r.userId, { rank, to: { organizationId: r.organizationId, role: r.role } });
  }
  return new Map([...best].map(([userId, b]) => [userId, b.to]));
}

/** Thrown when someone who belongs to another workspace cannot be moved
 *  into any of them, so their company is not deleted on this run. */
export class AccountCannotMove extends Error {
  constructor(readonly userIds: string[]) {
    super(
      `${userIds.length} account(s) here also belong to other workspaces, but each of those already has an account with the same email, so they cannot move there. Merge those accounts first; until then this company is kept. Account ids: ${userIds.join(", ")}`,
    );
    this.name = "AccountCannotMove";
  }
}

/** Inside the transaction that deletes a company for good
 *  (/api/cron/org-hard-delete), before the delete: everyone whose home it is
 *  but who also belongs to another workspace is moved there, at the level
 *  held there, so their account outlives it. The delete cascades every User
 *  anchored to the company, and the anchor is only where the person last
 *  was: someone who deleted a test workspace while working in their company
 *  on another device would otherwise lose their account, their place in that
 *  company and what cascades from it there (their conversations, say).
 *
 *  A workspace that already has an account with the same email cannot take
 *  this one (an account is unique by email and workspace), so the next one
 *  is tried. When none can, AccountCannotMove: deleting the account would
 *  take what it did in those workspaces with it, so the company is kept
 *  until the accounts are merged. Returns how many moved. */
export async function moveHomesOutOf(organizationId: string, tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.organizationMembership.findMany({
    where: { user: { organizationId }, organizationId: { not: organizationId } },
    select: { userId: true, organizationId: true, role: true, organization: { select: { status: true } }, user: { select: { email: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) return 0;
  const sameEmail = await tx.user.findMany({
    where: { OR: rows.map((r) => ({ organizationId: r.organizationId, email: r.user.email })) },
    select: { organizationId: true, email: true },
  });
  const taken = new Set(sameEmail.map((u) => `${u.organizationId}\n${u.email}`));
  const open = rows.filter((r) => !taken.has(`${r.organizationId}\n${r.user.email}`));
  const homes = homesElsewhere(open.map((r) => ({ userId: r.userId, organizationId: r.organizationId, role: r.role, status: r.organization.status })));
  const stuck = [...new Set(rows.map((r) => r.userId))].filter((id) => !homes.has(id));
  if (stuck.length > 0) throw new AccountCannotMove(stuck);
  let moved = 0;
  for (const [userId, to] of homes) {
    if (await reanchorUser({ userId, to }, tx)) moved += 1;
  }
  return moved;
}
