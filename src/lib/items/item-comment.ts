// POST /api/items/[id]/updates, as a function of WHO is commenting.
//
// AI teammates (docs/plans/ai-teammates.md 3.15) comment on tasks AS the person
// they work for, who is not at the keyboard. A teammate's comment has to be
// the comment that person would post: the same "comment" gate on the item ref,
// the same vetting of attachments and mentions, the same auto-watch, the same
// Inbox rows and realtime nudge, in the same order. So the route's body lives
// here, moved verbatim, and both callers come through it:
//
//   POST /api/items/[id]/updates   reads the session (itemCtx) and the JSON
//                                  body, then hands both here
//   the teammate tools             build the person's ItemCtx (the plan's
//                                  3.2) and hand it here with the tool's body
//
// The caller answers only "who is calling". Whether that person may comment
// on this task is decided below, by gateItem for the ItemCtx it is given. The
// answer is the route's own NextResponse.
//
// Server-only: imports prisma.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createUpdate, logActivity } from "@/lib/item-thread";
import { filterNotifyUsers } from "@/lib/notify-prefs";
import { notifyItemCommented, taskReaders } from "@/lib/notify-item";
import { publishItemChanged } from "@/lib/notify-realtime";
import { autoWatch, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { gateItem, type ItemCtx } from "@/lib/item-gate";
import { createEntityLink } from "@/lib/entity-link";
import { readableFileIds } from "@/lib/file-access";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  body: z.string().min(1).max(10_000),
  // @mentions picked in the composer — fan out "mention" Inbox
  // notifications to these users (author excluded server-side).
  mentionedUserIds: z.array(z.string()).max(50).optional(),
  // FileEntry ids already uploaded through /api/files. Linked to the comment
  // AND to the task, so a file outlives the comment it arrived on.
  attachmentIds: z.array(z.string().min(1)).max(20).optional(),
});

/**
 * The mentioned people the COMMENT BODY actually names.
 *
 * `mentionedUserIds` arrives from the client and nothing checked it against the
 * text, while Phase 2 also feeds that list into `autoWatch`, so any org member
 * could be subscribed to a task they were never mentioned on and would then
 * receive every future comment until they found the Unwatch control. The
 * composer writes "@First Last", so a claimed mention is honoured only when the
 * body contains an "@" followed by that person's name.
 */
async function resolveMentions(args: {
  organizationId: string;
  body: string;
  claimed: string[];
}): Promise<string[]> {
  const ids = [...new Set(args.claimed)];
  if (ids.length === 0) return [];
  const people = await prisma.user
    .findMany({
      where: { id: { in: ids }, organizationId: args.organizationId },
      select: { id: true, firstName: true, lastName: true },
    })
    .catch(() => []);
  const haystack = args.body.toLowerCase();
  return people
    .filter((p) => {
      const first = (p.firstName ?? "").trim().toLowerCase();
      const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim().toLowerCase();
      if (full && haystack.includes(`@${full}`)) return true;
      return Boolean(first) && haystack.includes(`@${first}`);
    })
    .map((p) => p.id);
}

/** Best-effort mention fan-out — never fails the comment post. */
async function notifyMentions(args: {
  organizationId: string;
  authorId: string;
  itemId: string;
  itemTitle: string;
  mentionedUserIds: string[];
  /** The comment the mention is in, so the row deep-links to it. */
  updateId?: string | null;
}): Promise<string[]> {
  try {
    const ids = [...new Set(args.mentionedUserIds)].filter((uid) => uid !== args.authorId);
    if (ids.length === 0) return [];
    // Only notify real members of the author's org — ids come from the client.
    const [members, author] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids }, organizationId: args.organizationId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: args.authorId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (members.length === 0) return [];
    // Only people who can open the task: the row names it, so a mention of
    // someone the task is hidden from never tells them its title.
    const readers = await taskReaders(args.organizationId, args.itemId, members.map((m) => m.id));
    if (readers.size === 0) return members.map((m) => m.id);
    // Honors the "Mentions" toggle in /settings/notifications.
    const wanted = await filterNotifyUsers([...readers], "mentions");
    if (wanted.size === 0) return [];
    const authorName = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "Someone";
    await prisma.notification.createMany({
      data: [...wanted].map((userId) => ({
        userId,
        type: "mention",
        title: args.itemTitle,
        message: `${authorName} mentioned you in a comment`,
        link: args.updateId ? `/item/${args.itemId}?comment=${args.updateId}` : `/item/${args.itemId}`,
      })),
    });
    // Returned so the comment fan-out below does not tell the same person
    // twice about the same comment in two different rows.
    return members.map((m) => m.id);
  } catch {
    // Swallow — notifications are best-effort; the comment already saved.
    return [];
  }
}

/**
 * Post one comment on task `id` as `c`, exactly as POST
 * /api/items/[id]/updates does. `body` is the request's JSON (null when it did
 * not parse); the answer is the route's response, status and body included.
 */
export async function postItemCommentAs(c: ItemCtx, id: string, body: unknown): Promise<NextResponse> {
  // Posting a comment is CONTENT, so it gates at "comment": an assignee may,
  // a read-only viewer may not, and a Personal-list owner always may.
  const gate = await gateItem(id, c, "comment");
  if ("error" in gate) return gate.error;

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    // Vetted before the write: only files this caller can actually READ
    // (src/lib/file-access.ts: org membership was the only check, so a file id
    // from a Space the caller is not on could be attached and then read back
    // out of the thread), and only the mentions the body really names.
    const attachmentIds = parsed.data.attachmentIds?.length
      ? await readableFileIds({ ids: parsed.data.attachmentIds, viewer: c })
      : [];
    const mentionedUserIds = parsed.data.mentionedUserIds?.length
      ? await resolveMentions({
          organizationId: c.organizationId,
          body: parsed.data.body,
          claimed: parsed.data.mentionedUserIds,
        })
      : [];

    const update = await createUpdate({
      organizationId: c.organizationId,
      itemId: id,
      authorId: c.userId,
      body: parsed.data.body,
      attachmentIds,
    });

    // A file attached to a comment is also an attachment OF THE TASK, so it
    // stays in the Attachments section if the comment is later deleted.
    for (const fileId of attachmentIds) {
      await createEntityLink({
        organizationId: c.organizationId,
        source: { type: "BOARD_ITEM", id },
        target: { type: "FILE", id: fileId },
        createdById: c.userId,
      }).catch(() => {});
      // Same row the /api/entity-links POST writes, so `?kind=attachments`
      // holds every attachment however it arrived.
      await logActivity({
        organizationId: c.organizationId,
        itemId: id,
        actorId: c.userId,
        action: "ATTACHMENT_ADDED",
        meta: { targetType: "FILE", targetId: fileId, viaUpdateId: update.id },
      });
    }

    // Rule 1 of the watcher contract: commenting subscribes you, unless you
    // explicitly unwatched. One metadata write, merged, never a replace of the
    // whole blob with a stale copy: the row is read again under its lock and
    // only the watcher lists change, so a field edit saved since the gate read
    // the task (a person and their AI teammate at once, say) is kept.
    let metadata: unknown = gate.item.metadata;
    let next = autoWatch(readWatchers(metadata), [c.userId, ...mentionedUserIds]);
    await prisma
      .$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
          SELECT "metadata" FROM "Item" WHERE "id" = ${id} FOR UPDATE`;
        if (rows.length === 0) return;
        metadata = rows[0].metadata;
        const state = readWatchers(metadata);
        next = autoWatch(state, [c.userId, ...mentionedUserIds]);
        if (next.watchers.length !== state.watchers.length) {
          await tx.item.update({ where: { id }, data: { metadata: writeWatchers(metadata, next) as object } });
        }
      })
      .catch(() => {});

    let mentioned: string[] = [];
    if (mentionedUserIds.length) {
      mentioned = await notifyMentions({
        organizationId: c.organizationId,
        authorId: c.userId,
        itemId: id,
        itemTitle: gate.item.title,
        mentionedUserIds,
        updateId: update.id,
      });
    }

    // Watchers and assignees hear about the comment, minus anyone the mention
    // row already told and minus anyone who unwatched.
    await notifyItemCommented({
      organizationId: c.organizationId,
      item: { id, title: gate.item.title, dueAt: gate.item.dueAt },
      metadata: writeWatchers(metadata, next),
      assigneeIds: gate.item.assigneeIds,
      actorId: c.userId,
      preview: parsed.data.body,
      excludeUserIds: mentioned,
      // The Inbox row lands ON the comment, not at the top of the thread.
      updateId: update.id,
    });

    void publishItemChanged({
      itemId: id,
      boardId: gate.item.boardId,
      organizationId: c.organizationId,
      actorId: c.userId,
    });

    return NextResponse.json({ update }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post comment" },
      { status: 400 },
    );
  }
}
