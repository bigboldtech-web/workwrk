// The rules behind POST /api/kudos/[id]/react, kept pure so they can be
// tested without a database.
//
// The route used to be a toggle only: every POST flipped the reaction. That
// made a Try again after a save that DID land but answered 500 undo the very
// reaction the person asked for. A client now says what it wants
// ({ emoji, on }) and the route makes it so, however many times it is sent.
// A body with no `on` is an older client and keeps the toggle it expects.

export const KUDOS_REACTION_EMOJIS: ReadonlySet<string> = new Set([
  "🙌", "🔥", "💚", "💯", "🎯", "👏", "🪔", "❤️", "🚀", "✨", "💪", "🎉",
]);

export type ReactionRequest =
  | { ok: true; emoji: string; /** null: an older client, flip it. */ on: boolean | null }
  | { ok: false; error: string };

export function parseReactionRequest(body: unknown): ReactionRequest {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const emoji = typeof b.emoji === "string" ? b.emoji.trim() : "";
  if (!emoji || !KUDOS_REACTION_EMOJIS.has(emoji)) return { ok: false, error: "Invalid emoji" };
  // Absent (or null) is the old toggle body. Anything else must be a real
  // boolean: guessing what "yes" or 1 meant could remove a reaction the
  // person meant to keep.
  if (b.on === undefined || b.on === null) return { ok: true, emoji, on: null };
  if (typeof b.on !== "boolean") return { ok: false, error: "on must be true or false" };
  return { ok: true, emoji, on: b.on };
}

/** What the route writes given whether my reaction exists now and what the
 *  client asked for. An explicit state that is already true writes nothing,
 *  so a repeated request never undoes itself. */
export function reactionWrite(exists: boolean, on: boolean | null): "create" | "delete" | "none" {
  const want = on ?? !exists;
  if (want === exists) return "none";
  return want ? "create" : "delete";
}
