// Who hears about a comment on a doc (pen test 2026-11-28, V-45).
//
// A block or page comment was only a row: nobody was told, not the doc's
// owner, not the people already talking in that thread, not the person the
// comment named with "@". Now, like a task's comment:
//   - each person the comment @mentions (picked in the composer and still
//     named in the text, resolveMentions) hears "mentioned you";
//   - the doc's owner and everyone who already commented in this thread hear
//     "commented" (minus anyone already told as a mention);
// never the author, and only people who can open the doc themselves (the one
// node-access resolver decides), because the row names the doc and quotes the
// comment. Each honours that person's notification switches. Best-effort: a
// failure here never fails the comment, which is already saved.
//
// Server-only.

import { prisma } from "@/lib/prisma";
import { filterNotifyUsers } from "@/lib/notify-prefs";
import { usersWhoCanRead } from "@/lib/access/node-access";
import { addressHref } from "@/lib/nav/object-href";
import { resolveMentions } from "@/lib/items/item-mentions";

/** A page-level thread's block id: the comment is on the doc, not on one block. */
export const PAGE_THREAD = "__page__";

/** The link a doc comment's notification opens: the doc, at the block when there is one. */
export function docCommentLink(docId: string, blockId: string): string {
  const doc = addressHref("doc", docId, { scope: "work" });
  return blockId && blockId !== PAGE_THREAD ? `${doc}#b-${encodeURIComponent(blockId)}` : doc;
}

export async function notifyDocComment(args: {
  organizationId: string;
  docId: string;
  blockId: string;
  actorId: string;
  body: string;
  updateId: string;
  /** Who the composer says the comment @mentions; honoured only while the text still names them. */
  mentionedUserIds?: string[];
}): Promise<{ mentioned: string[]; commented: string[] }> {
  const none = { mentioned: [], commented: [] };
  try {
    const doc = await prisma.doc.findFirst({
      where: { id: args.docId, organizationId: args.organizationId },
      select: { id: true, title: true, createdById: true, archivedAt: true },
    });
    if (!doc || doc.archivedAt) return none;

    const [claimed, earlier, author] = await Promise.all([
      args.mentionedUserIds?.length
        ? resolveMentions({ organizationId: args.organizationId, body: args.body, claimed: args.mentionedUserIds })
        : Promise.resolve([] as string[]),
      prisma.itemUpdate.findMany({
        where: {
          organizationId: args.organizationId,
          entityType: "DOC_BLOCK",
          entityId: `${args.docId}:${args.blockId}`,
          archivedAt: null,
          id: { not: args.updateId },
          authorId: { not: null },
        },
        select: { authorId: true },
        distinct: ["authorId"],
        take: 100,
      }),
      prisma.user.findUnique({ where: { id: args.actorId }, select: { firstName: true, lastName: true } }),
    ]);

    const mentioned = [...new Set(claimed)].filter((id) => id !== args.actorId);
    const followers = [...new Set([doc.createdById, ...earlier.map((e) => e.authorId)])].filter(
      (id): id is string => !!id && id !== args.actorId && !mentioned.includes(id),
    );
    if (mentioned.length === 0 && followers.length === 0) return none;

    const readers = await usersWhoCanRead(args.organizationId, { kind: "doc", id: doc.id }, { among: [...mentioned, ...followers] });
    const [toMention, toFollow] = await Promise.all([
      filterNotifyUsers(mentioned.filter((id) => readers.has(id)), "mentions"),
      filterNotifyUsers(followers.filter((id) => readers.has(id)), "comments"),
    ]);

    const who = `${author?.firstName ?? ""} ${author?.lastName ?? ""}`.trim() || "Someone";
    const snippet = args.body.replace(/\s+/g, " ").trim().slice(0, 140);
    const title = doc.title || "Untitled doc";
    const link = docCommentLink(doc.id, args.blockId);
    const rows = [
      ...[...toMention].map((userId) => ({ userId, type: "mention", title, message: `${who} mentioned you in a comment`, link })),
      ...[...toFollow].map((userId) => ({ userId, type: "doc_comment", title, message: snippet ? `${who} commented: ${snippet}` : `${who} commented on this doc`, link })),
    ];
    if (rows.length > 0) await prisma.notification.createMany({ data: rows });
    return { mentioned: [...toMention], commented: [...toFollow] };
  } catch (err) {
    console.error("[doc-comment-notify] failed", err);
    return none;
  }
}
