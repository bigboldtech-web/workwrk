// logItemActivity — fire-and-forget activity row.
//
// PATCH handlers + workflows call this after mutating an entity. The
// activity feed in the right-drawer reads from ItemActivity, so the
// drawer's history grows automatically as the user works.
//
// Errors are swallowed: a failed activity log must never block the
// user's actual action. The activity surface is for context, not a
// system of record (Postgres is, via the entity table itself).

import { writeItemActivity } from "@/lib/item-thread";
import { prisma } from "@/lib/prisma";

export interface LogActivityInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  action: string;
  meta?: Record<string, unknown>;
}

export function logItemActivity(input: LogActivityInput): void {
  // No await — fire-and-forget. The catch keeps unhandled rejections
  // from poisoning the request.
  // Written through item-thread.ts, the one ItemActivity writer (its header).
  writeItemActivity(prisma, {
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    action: input.action,
    meta: input.meta ?? {},
  }).catch((err) => {
    console.warn("[itemActivity] log failed", err);
  });
}
