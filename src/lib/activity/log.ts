// logItemActivity — fire-and-forget activity row.
//
// PATCH handlers + workflows call this after mutating an entity. The
// activity feed in the right-drawer reads from ItemActivity, so the
// drawer's history grows automatically as the user works.
//
// Errors are swallowed: a failed activity log must never block the
// user's actual action. The activity surface is for context, not a
// system of record (Postgres is, via the entity table itself).

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
  // Cast to Prisma's expected InputJsonValue — meta is genuinely JSON.
  const meta = (input.meta ?? {}) as unknown as object;
  prisma.itemActivity
    .create({
      data: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: input.actorId,
        action: input.action,
        meta,
      },
    })
    .catch((err) => {
      console.warn("[itemActivity] log failed", err);
    });
}
