// Shared conversation shapes + display helpers for the Comms Hub UI.

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
