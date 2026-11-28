// Who a task's text tags, and telling them.
//
// A new comment (src/lib/items/item-comment.ts) reports its mentions once. An
// edit is the other way a name gets into the text: a comment rewritten, a
// description saved, every two seconds while somebody types. Those go through
// announceAddedMentions, which tells only the people the saved text names and
// the text before it did not, so an autosave never tells anybody twice.
//
// Server-only: imports prisma.

import { filterNotifyUsers } from "@/lib/notify-prefs";
import { taskReaders } from "@/lib/notify-item";
import { autoWatch, readWatchers, writeWatchers } from "@/lib/item-watchers";
import { prisma } from "@/lib/prisma";
import { peopleHereAmong, seatedHereAmong } from "@/lib/access/seated-here";

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
export async function resolveMentions(args: {
  organizationId: string;
  body: string;
  claimed: string[];
}): Promise<string[]> {
  const ids = [...new Set(args.claimed)];
  if (ids.length === 0) return [];
  // People anchored here as before, and people here through a membership
  // whose seat here is live (docs/plans/workspace-status-2.md E12, step 6):
  // a mention watches the task and tells them of every comment after it,
  // which never reaches a seat this workspace ended.
  const people = await peopleHereAmong(args.organizationId, ids, { anchored: "any", membership: "live" })
    .then((m) => [...m.values()])
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
export async function notifyMentions(args: {
  organizationId: string;
  authorId: string;
  itemId: string;
  itemTitle: string;
  mentionedUserIds: string[];
  /** The comment the mention is in, so the row deep-links to it. */
  updateId?: string | null;
  /** Where the words are, for the row's sentence. A comment unless told. */
  where?: "comment" | "description";
}): Promise<string[]> {
  try {
    const ids = [...new Set(args.mentionedUserIds)].filter((uid) => uid !== args.authorId);
    if (ids.length === 0) return [];
    // Only notify real members of the author's org — ids come from the client.
    // A membership person only while their seat here is live (E12, step 6).
    const [members, author] = await Promise.all([
      seatedHereAmong(args.organizationId, ids, { anchored: "any", membership: "live" }).then((set) => [...set].map((id) => ({ id }))),
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
        message: `${authorName} mentioned you in ${args.where === "description" ? "a task description" : "a comment"}`,
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
 * Whether the text before this edit already held this person's whole tag.
 * resolveMentions accepts a bare "@first", right for a body someone wrote, and
 * wrong here: "@Ravi" autosaved halfway through typing, or "@Ravi Sharma"
 * already in the text, would pass for "@Ravi Kumar", who would never be told.
 * The whole name, ending where a word ends. After the first save that is
 * exactly what the text holds, so a later autosave tells nobody again.
 */
function taggedIn(text: string, person: { firstName: string | null; lastName: string | null }): boolean {
  const name = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim().toLowerCase();
  if (!name) return false;
  const haystack = text.toLowerCase();
  const tag = `@${name}`;
  for (let at = haystack.indexOf(tag); at !== -1; at = haystack.indexOf(tag, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(haystack.charAt(at + tag.length))) return true;
  }
  return false;
}

/**
 * Tell the people an edit newly tags, and have them watch the task, as a
 * mention in a new comment does. Best effort: the edit is already saved.
 */
export async function announceAddedMentions(args: {
  organizationId: string;
  authorId: string;
  item: { id: string; title: string };
  before: string;
  after: string;
  claimed: string[];
  where: "comment" | "description";
  updateId?: string | null;
}): Promise<void> {
  try {
    const { organizationId, authorId, item, claimed } = args;
    if (claimed.length === 0) return;
    const named = await resolveMentions({ organizationId, body: args.after, claimed });
    if (named.length === 0) return;
    const people = await peopleHereAmong(organizationId, named, { anchored: "any", membership: "live" });
    const added = named.filter((id) => {
      const person = people.get(id);
      return !person || !taggedIn(args.before, person);
    });
    if (added.length === 0) return;
    await prisma
      .$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
          SELECT "metadata" FROM "Item" WHERE "id" = ${item.id} FOR UPDATE`;
        if (rows.length === 0) return;
        const state = readWatchers(rows[0].metadata);
        const next = autoWatch(state, added);
        if (next.watchers.length !== state.watchers.length) {
          await tx.item.update({ where: { id: item.id }, data: { metadata: writeWatchers(rows[0].metadata, next) as object } });
        }
      })
      .catch(() => {});
    await notifyMentions({
      organizationId,
      authorId,
      itemId: item.id,
      itemTitle: item.title,
      mentionedUserIds: added,
      updateId: args.updateId ?? null,
      where: args.where,
    });
  } catch {
    // Swallow: the words are saved, and a missed notice never undoes that.
  }
}

/**
 * The people a comment @mentions who were NOT told because they cannot open
 * the task (pen test 2026-11-28, V-57): the comment posted with no hint and
 * the author believed they had pulled them in. People here only, by name, so
 * the author can share the task with them. Never throws.
 */
export async function mentionedWhoCannotOpen(organizationId: string, itemId: string, mentionedUserIds: string[]): Promise<Array<{ id: string; name: string }>> {
  try {
    const ids = [...new Set(mentionedUserIds)];
    if (ids.length === 0) return [];
    const here = [...(await seatedHereAmong(organizationId, ids, { anchored: "any", membership: "live" }))];
    if (here.length === 0) return [];
    const readers = await taskReaders(organizationId, itemId, here);
    const out = here.filter((id) => !readers.has(id));
    if (out.length === 0) return [];
    const people = await prisma.user.findMany({ where: { id: { in: out } }, select: { id: true, firstName: true, lastName: true } });
    return people.map((p) => ({ id: p.id, name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Someone" }));
  } catch {
    return [];
  }
}

