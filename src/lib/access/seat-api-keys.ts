// A seat that ends takes the API keys its person made in that workspace
// with it (docs/plans/workspace-status.md D15).
//
// Before, a key kept working after the person who made it was deactivated or
// removed: an ex-employee could hold a working key to the company's data.
// Now every end of a seat (endSeat: D3's move, D4's end of the account, D5's
// end of a membership) revokes, in the same transaction, the live keys that
// person created in THAT workspace (ApiKey.createdById and organizationId),
// the way Settings, API keys revokes one (revokedAt now), with an audit row
// for each in that workspace's log. Their keys in another workspace are that
// workspace's. Restoring or reactivating the seat brings none back: a new key
// is a fresh decision, made in Settings, API keys. The Deactivate and Remove
// dialogs say how many will stop working first (the handover summary's
// `apiKeys`).
//
// A leaf: it imports no access module, so workspace-status.ts can use it.

import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** Who ended the seat, for the audit rows: a person, or a system (SCIM). */
export interface SeatActor {
  id: string | null;
  type?: string;
  label?: string;
}

/** The live API keys this person created in this workspace (what the dialogs count). */
export async function liveKeysMadeHere(db: Db, organizationId: string, userId: string): Promise<number> {
  return db.apiKey.count({ where: { organizationId, createdById: userId, revokedAt: null } });
}

/**
 * Revokes the live API keys this person created in this workspace, and logs
 * each there, in the caller's transaction. Returns how many were revoked.
 */
export async function revokeKeysMadeHere(
  db: Db,
  input: { organizationId: string; userId: string; ends: "deactivated" | "removed"; now?: Date; actor?: SeatActor | null },
): Promise<number> {
  const { organizationId, userId } = input;
  const keys = await db.apiKey.findMany({
    where: { organizationId, createdById: userId, revokedAt: null },
    select: { id: true, name: true, prefix: true },
  });
  if (keys.length === 0) return 0;
  const now = input.now ?? new Date();
  await db.apiKey.updateMany({ where: { id: { in: keys.map((k) => k.id) }, revokedAt: null }, data: { revokedAt: now } });
  const actor = input.actor ?? null;
  await db.activityLog.createMany({
    data: keys.map((k) => ({
      type: "api_key_revoked",
      actorId: actor?.id ?? null,
      ...(actor?.type ? { actorType: actor.type } : actor?.id ? {} : { actorType: "system" }),
      ...(actor?.label ? { actorLabel: actor.label } : {}),
      organizationId,
      description: `Revoked API key "${k.name}" (prefix ${k.prefix}): the person who made it was ${input.ends} here`,
      targetId: k.id,
      targetType: "api_key",
      severity: "warning",
      metadata: { name: k.name, prefix: k.prefix, createdById: userId, seatEnded: input.ends },
    })),
  });
  return keys.length;
}
