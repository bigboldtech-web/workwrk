// Shared conversation shapes and display helpers for the Talk UI.

export type ChatUserLite = {
  id: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
};

export type ConversationListRow = {
  id: string;
  type: "DM" | "GROUP" | "CHANNEL";
  name: string | null;
  lastMessageAt: string;
  unreadCount: number;
  /** How many of the unread are addressed to me. The sidebar shows a count
   *  for these and a plain dot for the rest (spec-talk section 1). Optional
   *  so a client reading an older server renders the dot and loses nothing. */
  unreadMentions?: number;
  myNotifyLevel?: string;
  myStarred?: boolean;
  members: { userId: string; user: ChatUserLite }[];
  lastMessage: { body: string; authorId: string; createdAt: string; metadata?: unknown } | null;
};

/** Display name: groups/channels use their name; DMs use the other
 *  person; fallbacks stay honest instead of showing blank rows. */
export function conversationTitle(
  row: { type: string; name: string | null; members: { userId: string; user: ChatUserLite }[] },
  meId: string | null,
): string {
  if (row.type !== "DM" && row.name) return row.name;
  const others = row.members.filter((m) => m.userId !== meId);
  if (others.length === 0) return "Just you";
  const names = others.map((m) => `${m.user.firstName} ${m.user.lastName}`.trim());
  if (row.type === "DM") return names[0] || "Direct message";
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

/** For DMs, the user whose avatar represents the conversation. */
export function conversationAvatarUser(
  row: { type: string; members: { userId: string; user: ChatUserLite }[] },
  meId: string | null,
): ChatUserLite | null {
  if (row.type !== "DM") return null;
  return row.members.find((m) => m.userId !== meId)?.user ?? null;
}

/** A feed row as the grouping reads it. */
type GroupedRow = { authorId: string; createdAt: string; metadata?: { kind?: string } | null };

/** How long one author's messages keep folding under the same head. */
const GROUP_GAP_MS = 5 * 60 * 1000;

/**
 * The kinds that say on their head that AI wrote them: an AI update (Batch
 * 8, src/lib/talk-updates.ts), "AI update", and a post an AI teammate made
 * for the person, "via {teammate}" (src/lib/agents/teammate-tools.ts
 * post_in_talk). An edited one is the person's own words and says neither.
 */
const AI_LABELLED_KINDS: ReadonlySet<string> = new Set(["ai_update", "ai_update_hidden", "agent_post"]);

function aiLabelled(m: GroupedRow): boolean {
  const kind = m.metadata?.kind;
  return typeof kind === "string" && AI_LABELLED_KINDS.has(kind);
}

/**
 * Whether a message heads its own group in the feed: its avatar, its
 * author's name, its label and its time. `prev` is the message just above
 * it on the same day (null for a day's first). A new author or a gap of more
 * than five minutes starts a group, and so does a message AI wrote and the
 * message after it, so the label is never folded into, or over, words the
 * person wrote themselves.
 */
export function startsGroup(prev: GroupedRow | null, m: GroupedRow): boolean {
  if (!prev || m.authorId !== prev.authorId) return true;
  if (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS) return true;
  return aiLabelled(m) || aiLabelled(prev);
}

/**
 * The kind a message takes once its author edits it, or null when it keeps
 * its own: an AI update or an AI teammate's post is the person's own words
 * from then on, so it stops saying AI wrote it. The edit route makes the
 * same change in the database
 * (src/app/api/conversations/[id]/messages/[messageId]/route.ts).
 */
export function editedKind(kind: string | null | undefined): string | null {
  if (kind === "ai_update") return "ai_update_edited";
  if (kind === "agent_post") return "agent_post_edited";
  return null;
}
