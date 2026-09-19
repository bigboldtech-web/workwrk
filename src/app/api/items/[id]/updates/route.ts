// GET  /api/items/[id]/updates: comments on a task, with their attachments
//                                 and reactions. `?around=<updateId>` returns
//                                 the page containing that comment.
// POST /api/items/[id]/updates: add a comment { body, mentionedUserIds?,
//                                 attachmentIds? }
//
// THE FIX THIS FILE CARRIES (spec-task-detail section 4 step 2). Until Phase 2
// both verbs resolved a SPACE before they would answer:
//
//     if (!item || !item.board.spaceId) return 404
//     if (!getSpaceForReader(item.board.spaceId, ...)) return 404
//
// which broke two whole populations, silently, because the client swallowed
// the non-ok response and rendered "No comments yet":
//
//   * an ASSIGNEE in a Space they are not a member of, who could open the task
//     and could not see or post a single comment on it; and
//   * EVERY PERSONAL-LIST TASK, because the personal board is space-less by
//     construction, so 100% of personal tasks had no thread at all.
//
// Gating on the ITEM ref fixes both at once. There is nothing to migrate and
// no new column. src/lib/item-gate.test-notes and the regression test in
// src/lib/item-gate.personal.test.ts pin the personal-list case, because this
// is exactly the kind of thing a future Space-scoped helper would break again.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createUpdate, listUpdates, listUpdatesAround, logActivity } from "@/lib/item-thread";
import { filterNotifyUsers } from "@/lib/notify-prefs";
import { notifyItemCommented } from "@/lib/notify-item";
import { publishItemChanged } from "@/lib/notify-realtime";
import { autoWatch, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { gateItem, itemCtx } from "@/lib/item-gate";
import { createEntityLink } from "@/lib/entity-link";
import { readableFileIds } from "@/lib/file-access";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  const gate = await gateItem(id, c, "view");
  if ("error" in gate) return gate.error;

  // What this viewer may DO in the thread, answered by the thread's own
  // endpoint. The composer and the per-comment trash icon used to be derived
  // from the host page's `canEdit`, so a Member saw a trash icon on everyone
  // else's comment and got a 403 every time (deleting another person's comment
  // is moderation: access section 1 gives it to Full access only, and Can edit
  // explicitly does not include it). Sending it here means every host, the
  // drawer, the page, the Inbox panel, is right without plumbing a new prop
  // through each one.
  const role = gate.decision.role;
  const can = {
    comment: role === "COMMENT" || role === "EDIT" || role === "FULL",
    /** Delete or hide SOMEONE ELSE'S comment. Your own is always yours. */
    moderate: role === "FULL",
  };

  const around = new URL(req.url).searchParams.get("around");
  if (around) {
    // A deep link to a comment that was deleted, or that belongs to another
    // task, answers 200 with `missing: true` and an empty list. A 404 here
    // would kill the whole task page over one dead anchor.
    const page = await listUpdatesAround(id, around);
    return NextResponse.json({ ...page, can });
  }
  const updates = await listUpdates(id);
  return NextResponse.json({ updates, can });
}

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
    // Honors the "Mentions" toggle in /settings/notifications.
    const wanted = await filterNotifyUsers(members.map((m) => m.id), "mentions");
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await itemCtx();
  if ("error" in c) return c.error;
  const { id } = await params;
  // Posting a comment is CONTENT, so it gates at "comment": an assignee may,
  // a read-only viewer may not, and a Personal-list owner always may.
  const gate = await gateItem(id, c, "comment");
  if ("error" in gate) return gate.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
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
    // whole blob with a stale copy.
    const state = readWatchers(gate.item.metadata);
    const next = autoWatch(state, [c.userId, ...mentionedUserIds]);
    if (next.watchers.length !== state.watchers.length) {
      await prisma.item
        .update({
          where: { id },
          data: { metadata: writeWatchers(gate.item.metadata, next) as object },
        })
        .catch(() => {});
    }

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
      metadata: writeWatchers(gate.item.metadata, next),
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
