// Item thread, comments (ItemUpdate) + activity log (ItemActivity)
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
import { activityActionFilter, type ItemActivityKind } from "@/lib/item-activity-kinds";

export const BOARD_ITEM_ENTITY_TYPE = "BOARD_ITEM" as const;

export interface ThreadAttachment {
  id: string;
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

/** One emoji and everyone who put it there (spec-task-detail section 2). */
export interface ThreadReaction {
  emoji: string;
  userIds: string[];
}

export interface ThreadUpdate {
  id: string;
  body: string;
  authorId: string | null;
  author: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  /** Phase 2. Empty for every comment written before attachments existed. */
  attachments: ThreadAttachment[];
  /** Phase 2. Empty when nobody has reacted, and empty for one release if the
   *  table has not been created yet, a missing table degrades the feature,
   *  never the thread. */
  reactions: ThreadReaction[];
}

export interface ThreadActivity {
  id: string;
  actorId: string | null;
  actor: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  action: string;
  meta: Record<string, unknown>;
  createdAt: Date;
  /**
   * User id to display name for every person id that appears INSIDE `meta`
   * (ASSIGNEES_CHANGED added/removed, OWNER_CHANGED from/to).
   *
   * Resolved here rather than in each renderer because only the server can do
   * it, and because the alternative is what shipped: a row that read "added
   * cmu6xikt5xvupmpvmw499cz5r as an assignee". The same map object is shared by
   * every row in one response, so it costs one query and no duplication.
   * Optional so a caller that predates it still type-checks.
   */
  people?: Record<string, string>;
}

/**
 * Attachments and reactions for a page of comments.
 *
 * Both tables landed in Phase 2 and both reads are guarded: a database that
 * has not had `prisma/sql/2026-09-18-task-detail-phase2.sql` applied yet
 * returns empty lists instead of throwing, so the thread still renders. That
 * is the "every reader tolerates a new table being absent for one release"
 * rule, and it is why these are two small queries rather than an `include`.
 */
async function decorate(updateIds: string[]): Promise<{
  attachments: Map<string, ThreadAttachment[]>;
  reactions: Map<string, ThreadReaction[]>;
}> {
  const attachments = new Map<string, ThreadAttachment[]>();
  const reactions = new Map<string, ThreadReaction[]>();
  if (updateIds.length === 0) return { attachments, reactions };

  const [links, reactionRows] = await Promise.all([
    prisma.itemUpdateAttachment
      .findMany({ where: { updateId: { in: updateIds } }, orderBy: { createdAt: "asc" } })
      .catch(() => [] as { id: string; updateId: string; fileId: string }[]),
    prisma.itemUpdateReaction
      .findMany({ where: { updateId: { in: updateIds } }, orderBy: { createdAt: "asc" } })
      .catch(() => [] as { updateId: string; userId: string; emoji: string }[]),
  ]);

  const fileIds = Array.from(new Set(links.map((l) => l.fileId)));
  const files = fileIds.length
    ? await prisma.fileEntry
        .findMany({
          where: { id: { in: fileIds } },
          select: { id: true, name: true, mimeType: true, size: true, url: true },
        })
        .catch(() => [])
    : [];
  const fileById = new Map(files.map((f) => [f.id, f] as const));

  for (const link of links) {
    const file = fileById.get(link.fileId);
    // A file that has been deleted leaves no ghost row in the thread.
    if (!file) continue;
    const list = attachments.get(link.updateId) ?? [];
    list.push({
      id: link.id,
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      url: file.url,
    });
    attachments.set(link.updateId, list);
  }

  for (const r of reactionRows) {
    const list = reactions.get(r.updateId) ?? [];
    const existing = list.find((x) => x.emoji === r.emoji);
    if (existing) existing.userIds.push(r.userId);
    else list.push({ emoji: r.emoji, userIds: [r.userId] });
    reactions.set(r.updateId, list);
  }

  return { attachments, reactions };
}

async function hydrate(
  rows: { id: string; body: string; authorId: string | null; createdAt: Date; updatedAt: Date }[],
): Promise<ThreadUpdate[]> {
  const authorIds = Array.from(new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x)));
  const [authors, extra] = await Promise.all([
    authorIds.length
      ? prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, firstName: true, lastName: true, avatar: true },
        })
      : Promise.resolve([]),
    decorate(rows.map((r) => r.id)),
  ]);
  const byId = new Map(authors.map((a) => [a.id, a] as const));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorId: r.authorId,
    author: r.authorId ? byId.get(r.authorId) ?? null : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    attachments: extra.attachments.get(r.id) ?? [],
    reactions: extra.reactions.get(r.id) ?? [],
  }));
}

export async function listUpdates(itemId: string, opts: { limit?: number } = {}): Promise<ThreadUpdate[]> {
  const rows = await prisma.itemUpdate.findMany({
    where: { entityType: BOARD_ITEM_ENTITY_TYPE, entityId: itemId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 200,
  });
  return hydrate(rows);
}

/** How many comments a `?around=` page carries before the anchor. */
export const AROUND_BEFORE = 25;

export interface AroundPage {
  updates: ThreadUpdate[];
  /** The oldest comment id in this page, for "load older". */
  cursorBefore: string | null;
  /** The newest comment id in this page, for "load newer". */
  cursorAfter: string | null;
  /**
   * True when the requested comment is not on this task: deleted, or a wrong
   * id in a stale link. The response is still a 200 with an empty list, so a
   * dead `?comment=` degrades to one line in the thread rather than killing
   * the whole task page (spec-task-detail section 4 step 1).
   */
  missing: boolean;
}

/**
 * The page containing one comment, plus the 25 before it.
 *
 * Never throws for a bad id and never 404s: `missing: true` is the answer, and
 * the caller shows "That comment was deleted".
 */
export async function listUpdatesAround(itemId: string, updateId: string): Promise<AroundPage> {
  const anchor = await prisma.itemUpdate.findUnique({ where: { id: updateId } });
  if (
    !anchor ||
    anchor.entityType !== BOARD_ITEM_ENTITY_TYPE ||
    anchor.entityId !== itemId ||
    anchor.archivedAt
  ) {
    return { updates: [], cursorBefore: null, cursorAfter: null, missing: true };
  }
  // The id is the tiebreak, at both ends. Paging on `createdAt` alone dropped
  // or duplicated comments written in the same millisecond (a paste of two, an
  // import, a test) whenever the page edge fell between them.
  const before = await prisma.itemUpdate.findMany({
    where: {
      entityType: BOARD_ITEM_ENTITY_TYPE,
      entityId: itemId,
      archivedAt: null,
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AROUND_BEFORE,
  });
  const rows = [...before.reverse(), anchor];
  const updates = await hydrate(rows);
  return {
    updates,
    cursorBefore: updates.length > 0 ? updates[0].id : null,
    cursorAfter: updates.length > 0 ? updates[updates.length - 1].id : null,
    missing: false,
  };
}

export async function createUpdate(args: {
  organizationId: string;
  itemId: string;
  authorId: string;
  body: string;
  /**
   * FileEntry ids already uploaded through /api/files. They are linked to the
   * comment here AND to the task as EntityLink FILE rows by the route, so a
   * file survives its comment being deleted and still shows in Attachments.
   */
  attachmentIds?: string[];
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

  if (args.attachmentIds?.length) {
    // Org-scoped, so a client cannot attach a file from another tenant, and
    // best effort, so a missing table cannot lose the comment that just saved.
    try {
      const files = await prisma.fileEntry.findMany({
        where: { id: { in: [...new Set(args.attachmentIds)] }, organizationId: args.organizationId },
        select: { id: true },
      });
      if (files.length > 0) {
        await prisma.itemUpdateAttachment.createMany({
          data: files.map((f) => ({
            organizationId: args.organizationId,
            updateId: created.id,
            fileId: f.id,
          })),
          skipDuplicates: true,
        });
      }
    } catch {
      // The comment is already written; an attachment row is not worth losing it.
    }
  }

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

  return (await hydrate([created]))[0];
}

export async function editUpdate(updateId: string, body: string): Promise<ThreadUpdate> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");
  const updated = await prisma.itemUpdate.update({
    where: { id: updateId },
    data: { body: trimmed },
  });
  return (await hydrate([updated]))[0];
}

// ── Reactions (spec-task-detail section 4 step 1) ──────────────────

/**
 * Add one emoji from one person to one comment.
 *
 * Idempotent through the unique key: reacting twice with the same emoji is a
 * no-op rather than a duplicate, so a double-click cannot double-count.
 * Returns the comment's whole reaction set so the caller answers with truth
 * rather than with an optimistic guess.
 */
export async function addReaction(args: {
  organizationId: string;
  updateId: string;
  userId: string;
  emoji: string;
}): Promise<ThreadReaction[]> {
  // Guarded like every READ of this table: a database that has not had
  // prisma/sql/2026-09-18-task-detail-phase2.sql applied degrades the feature
  // (the click does nothing) instead of answering an unhandled 500. That is the
  // "a missing table degrades the feature, never the page" rule, and the writer
  // was the one place it was not held.
  await prisma.itemUpdateReaction
    .upsert({
      where: {
        updateId_userId_emoji: { updateId: args.updateId, userId: args.userId, emoji: args.emoji },
      },
      create: {
        organizationId: args.organizationId,
        updateId: args.updateId,
        userId: args.userId,
        emoji: args.emoji,
      },
      update: {},
    })
    .catch(() => null);
  return listReactions(args.updateId);
}

/** Remove one person's one emoji. Removing a reaction that is not there is a no-op. */
export async function removeReaction(args: {
  updateId: string;
  userId: string;
  emoji: string;
}): Promise<ThreadReaction[]> {
  // Guarded like its two siblings: a database that has not had
  // prisma/sql/2026-09-18-task-detail-phase2.sql applied yet degrades the
  // feature rather than answering an unhandled 500. Without this, POST
  // /reactions degraded quietly and DELETE /reactions threw, on exactly the
  // deploy window the README's own order creates.
  await prisma.itemUpdateReaction
    .deleteMany({ where: { updateId: args.updateId, userId: args.userId, emoji: args.emoji } })
    .catch(() => ({ count: 0 }));
  return listReactions(args.updateId);
}

export async function listReactions(updateId: string): Promise<ThreadReaction[]> {
  const rows = await prisma.itemUpdateReaction
    .findMany({ where: { updateId }, orderBy: { createdAt: "asc" } })
    .catch(() => [] as { userId: string; emoji: string }[]);
  const out: ThreadReaction[] = [];
  for (const r of rows) {
    const existing = out.find((x) => x.emoji === r.emoji);
    if (existing) existing.userIds.push(r.userId);
    else out.push({ emoji: r.emoji, userIds: [r.userId] });
  }
  return out;
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

export async function listActivity(
  itemId: string,
  opts: { limit?: number; kind?: ItemActivityKind | null } = {},
): Promise<ThreadActivity[]> {
  // The filter is an explicit action predicate rather than a prefix match, so
  // a row written by an older release or an automation can never be silently
  // excluded by a pattern nobody meant it to match: `lifecycle` is the
  // complement of the six named kinds, so every stored row is reachable.
  const actionWhere = opts.kind ? activityActionFilter(opts.kind) : null;
  const rows = await prisma.itemActivity.findMany({
    where: {
      entityType: BOARD_ITEM_ENTITY_TYPE,
      entityId: itemId,
      ...(actionWhere ? { action: actionWhere } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 200,
  });
  // Everyone this page of rows names: the actors, plus the people ids buried
  // inside `meta` (an assignee that was added, the owner it was handed to). One
  // query for both, because a renderer that cannot resolve a meta id prints the
  // raw cuid at a person.
  const actorIds = rows.map((r) => r.actorId).filter((x): x is string => !!x);
  const metaIds = rows.flatMap((r) => personIdsInMeta(r.action, (r.meta as Record<string, unknown>) ?? {}));
  const everyone = Array.from(new Set([...actorIds, ...metaIds]));
  const users = everyone.length
    ? await prisma.user.findMany({
        where: { id: { in: everyone } },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const byId = new Map(users.map((a) => [a.id, a] as const));
  // One shared map for the whole response, same object on every row.
  const people: Record<string, string> = {};
  for (const u of users) {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    if (name) people[u.id] = name;
  }
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actor: r.actorId ? byId.get(r.actorId) ?? null : null,
    action: r.action,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: r.createdAt,
    people,
  }));
}

/**
 * The user ids stored INSIDE one activity row's meta.
 *
 * Only the two actions that carry people are read, and only the keys those
 * actions write, so a meta blob from an automation cannot turn an arbitrary
 * string into a user lookup.
 */
function personIdsInMeta(action: string, meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x) out.push(x);
  };
  if (action === "ASSIGNEES_CHANGED") {
    push(meta.added);
    push(meta.removed);
  } else if (action === "OWNER_CHANGED" || action === "ASSIGNED") {
    push(meta.from);
    push(meta.to);
  }
  return out;
}

/**
 * Write an activity row for a Board Item. Called from board-items.ts
 * after mutating an item. Failure here should NOT roll back the
 * caller's update, we catch internally so analytics never blocks
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
    // Swallow, activity is best-effort; we don't want it breaking edits.
  }
}
