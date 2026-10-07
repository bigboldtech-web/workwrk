// Asking an AI teammate in Talk: the pure rules
// (docs/plans/ai-teammates-phase2.md step 6, Decisions 8 to 12 and 30).
//
// WHERE. Only where the person is a member, no member is a Guest, and the
// conversation is a direct message, a group or a PRIVATE channel that is
// not archived. Never a public channel: the answer posts without a card and
// carries what only the person can see, and a public channel is read by
// everyone (and by Owners and Admins who never joined). A Guest viewer asks
// no teammate.
//
// HOW. Only a teammate picked from the @ list: the message carries its slug,
// and its body must still hold "@<Name>". A typed or pasted "@Name" alone
// starts nothing, so no hidden model call is ever made.
//
// Pure: no imports with side effects.

export const TALK_TEAMMATE_LIMITS = {
  /** Asks per person per minute, on top of the shared AI limit (Decision 9). */
  perMinute: 5,
  /** Earlier messages read for context. */
  contextMessages: 30,
  contextChars: 12_000,
  messageChars: 500,
  /** The longest answer posted. */
  answerMax: 8000,
  /** A request still "running" after this reads as not answered (a restart mid-turn; Decision 30). */
  workingStaleMs: 10 * 60_000,
  /**
   * The most people a teammate can be asked in front of: its answer keeps
   * the list of who was there (talk-updates.ts TEAMMATE_ANSWER_KINDS), as an
   * AI update does, with the same bound (MAX_UPDATE_READERS).
   */
  maxReaders: 250,
} as const;

export type TalkAddressRefusal = "guest" | "public_channel" | "has_guests" | "not_member" | "archived" | "too_many_people";

/** Why a teammate can't be asked in this conversation, or null when it can, in this order. */
export function talkAddressRefusal(
  c: { type: "DM" | "GROUP" | "CHANNEL" | string; restricted: boolean; archivedAt: Date | string | null },
  viewer: { orgRole: string },
  facts: { isMember: boolean; hasGuests: boolean; tooManyPeople?: boolean },
): TalkAddressRefusal | null {
  if (viewer.orgRole === "GUEST") return "guest";
  if (c.archivedAt) return "archived";
  if (c.type === "CHANNEL" && !c.restricted) return "public_channel";
  if (c.type !== "CHANNEL" && c.type !== "GROUP" && c.type !== "DM") return "public_channel";
  if (!facts.isMember) return "not_member";
  if (facts.hasGuests) return "has_guests";
  if (facts.tooManyPeople) return "too_many_people";
  return null;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Whether the body addresses the teammate: "@<name>" without case, at a word's start, with no letter, digit or "_" after it. */
export function addressedIn(body: string, name: string): boolean {
  return addressedAt(body, name) >= 0;
}

/**
 * Where the body first addresses the name, by addressedIn's rule (a whole
 * "@<name>" at a word's start), or -1. The composer's pick reads the same
 * place, so "ops@triage.io" is never read as asking Triage (review round 2).
 */
export function addressedAt(body: string, name: string): number {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return -1;
  const lower = String(body ?? "").toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(`@${key}`, from);
    if (at < 0) return -1;
    from = at + 1;
    if (at > 0 && WORD_CHAR.test(lower.charAt(at - 1))) continue;
    if (WORD_CHAR.test(lower.charAt(at + 1 + key.length))) continue;
    return at;
  }
}

export type TalkRequestState = "running" | "answered" | "no_answer" | "failed" | "stale";

/** A request's state as its message's metadata.teammate holds it; a "running" one past the stale time reads "stale". */
export function teammateRequestState(meta: unknown, createdAt: string | Date, now: number): TalkRequestState | null {
  const m = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
  const t = m?.teammate && typeof m.teammate === "object" && !Array.isArray(m.teammate) ? (m.teammate as Record<string, unknown>) : null;
  if (!t) return null;
  const state = t.state;
  if (state === "answered" || state === "no_answer" || state === "failed") return state;
  if (state !== "running") return null;
  const at = new Date(createdAt).getTime();
  return Number.isFinite(at) && now - at > TALK_TEAMMATE_LIMITS.workingStaleMs ? "stale" : "running";
}
