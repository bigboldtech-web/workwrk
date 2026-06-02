// Item thread — comments (ItemUpdate) + activity log (ItemActivity)
// for any Board Item. Both models are polymorphic on
// (entityType, entityId); for Board Items we use:
//   entityType = "BOARD_ITEM"
//   entityId   = item.id (the canonical Item.id)
//
// Activity rows are written by board-items.ts as a side effect of
// create / patch / archive, and by the comment APIs themselves on
// post. The renderer reads activity to render a human-friendly log
// (e.g. "Mai changed status from To Do → In Progress").

import { prisma } from "@/lib/prisma";

export const BOARD_ITEM_ENTITY_TYPE = "BOARD_ITEM" as const;

export interface ThreadUpdate {
  id: string;
  body: string;
  authorId: string | null;
  author: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadActivity {
  id: string;
  actorId: string | null;
  actor: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  action: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export async function listUpdates(itemId: string, opts: { limit?: number } = {}): Promise<ThreadUpdate[]> {
  const rows = await prisma.itemUpdate.findMany({
    where: { entityType: BOARD_ITEM_ENTITY_TYPE, entityId: itemId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 200,
  });
  const authorIds = Array.from(new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x)));
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const byId = new Map(authors.map((a) => [a.id, a] as const));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorId: r.authorId,
    author: r.authorId ? byId.get(r.authorId) ?? null : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createUpdate(args: {
  organizationId: string;
  itemId: string;
  authorId: string;
  body: string;
}): Promise<ThreadUpdate> {
  const trimmed = args.body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");

  const created = await prisma.itemUpdate.create({
    data: {
      organizationId: args.organizationId,
      entityType: BOARD_ITEM_ENTITY_TYPE,
      entityId: args.itemId,
      authorId: args.authorId,
      body: trimmed,
    },
  });

  // Mirror as an activity row so the activity log shows comments inline
  // alongside status/title changes.
  await prisma.itemActivity.create({
    data: {
      organizationId: args.organizationId,
      entityType: BOARD_ITEM_ENTITY_TYPE,
      entityId: args.itemId,
      actorId: args.authorId,
      action: "COMMENTED",
      meta: { updateId: created.id, preview: trimmed.slice(0, 120) } as object,
    },
  });

  const author = await prisma.user.findUnique({
    where: { id: args.authorId },
    select: { id: true, firstName: true, lastName: true, avatar: true },
  });
  return {
    id: created.id,
    body: created.body,
    authorId: created.authorId,
    author,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

export async function deleteUpdate(updateId: string): Promise<void> {
  // Soft-delete via archivedAt so threads keep their structure if
  // someone restores; hard-delete only if the API decides to.
  await prisma.itemUpdate.update({
    where: { id: updateId },
    data: { archivedAt: new Date() },
  });
}

export async function getUpdate(updateId: string) {
  return prisma.itemUpdate.findUnique({
    where: { id: updateId },
    include: { organization: { select: { id: true } } },
  });
}

export async function listActivity(itemId: string, opts: { limit?: number } = {}): Promise<ThreadActivity[]> {
  const rows = await prisma.itemActivity.findMany({
    where: { entityType: BOARD_ITEM_ENTITY_TYPE, entityId: itemId },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 200,
  });
  const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x)));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const byId = new Map(actors.map((a) => [a.id, a] as const));
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actor: r.actorId ? byId.get(r.actorId) ?? null : null,
    action: r.action,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: r.createdAt,
  }));
}

/**
 * Write an activity row for a Board Item. Called from board-items.ts
 * after mutating an item. Failure here should NOT roll back the
 * caller's update — we catch internally so analytics never blocks
 * real work.
 */
export async function logActivity(args: {
  organizationId: string;
  itemId: string;
  actorId: string | null;
  action: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.itemActivity.create({
      data: {
        organizationId: args.organizationId,
        entityType: BOARD_ITEM_ENTITY_TYPE,
        entityId: args.itemId,
        actorId: args.actorId,
        action: args.action,
        meta: (args.meta ?? {}) as object,
      },
    });
  } catch {
    // Swallow — activity is best-effort; we don't want it breaking edits.
  }
}
