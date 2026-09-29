// Moving a person from one workspace to another: the org switcher
// (POST /api/me/switch-org) and the sign-in and session fallbacks that move
// someone out of a suspended or cancelled workspace (src/lib/auth.ts).
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
    const now = await tx.user.findUnique({ where: { id: move.userId }, select: { organizationId: true, accessLevel: true } });
    if (!now || now.organizationId === move.to.organizationId) return false;
    const from = { organizationId: now.organizationId, accessLevel: now.accessLevel };
    const primary = await tx.organizationMembership.findFirst({
      where: { userId: move.userId, isPrimary: true },
      select: { id: true },
    });
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: move.userId, organizationId: from.organizationId } },
      create: {
        userId: move.userId,
        organizationId: from.organizationId,
        role: from.accessLevel,
        isPrimary: leavingIsPrimary(!!primary),
      },
      update: { role: from.accessLevel },
    });
    await tx.user.update({
      where: { id: move.userId },
      data: { organizationId: move.to.organizationId, accessLevel: move.to.role },
    });
    return true;
  };
  if (db && db !== prisma) return run(db);
  return prisma.$transaction(async (tx) => run(tx));
}
