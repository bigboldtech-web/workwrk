// Who of these people holds NO live seat in a workspace (docs/plans/workspace-status.md
// D2; the final review): anchored there and neither deactivated nor
// removed (the account row, never the anchored workspace's own stale
// membership row), or a membership there neither deactivated nor removed.
// No account, or no membership there, is no seat. The rule the API key check
// applies to a key's maker (seat-api-keys.ts creatorsWithoutLiveSeat), and
// Talk to who is rung and who reads a teammate's answer (talk-post.ts,
// agents/talk-turn.ts): someone a workspace ended through their membership
// is no one there, whatever their account's state where it is anchored.
//
// A leaf over the seat rule's own leaf (workspace-seat.ts): it reads, so it
// lives beside it rather than in it. Two reads at most.

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { seatIsLive } from "./workspace-seat";

type Db = PrismaClient | Prisma.TransactionClient;

export async function withoutLiveSeatIn(db: Db, organizationId: string, userIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Set();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true, status: true, deletedAt: true } });
  const live = new Set<string>();
  const elsewhere: string[] = [];
  for (const u of users) {
    if (u.organizationId === organizationId) {
      if (seatIsLive({ status: String(u.status), removedAt: u.deletedAt })) live.add(u.id);
    } else elsewhere.push(u.id);
  }
  if (elsewhere.length > 0) {
    const seats = await db.organizationMembership.findMany({ where: { organizationId, userId: { in: elsewhere } }, select: { userId: true, status: true, removedAt: true } });
    for (const m of seats) if (seatIsLive({ status: String(m.status), removedAt: m.removedAt })) live.add(m.userId);
  }
  return new Set(ids.filter((id) => !live.has(id)));
}
