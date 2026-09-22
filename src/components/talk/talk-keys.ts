// The Talk unit's per-device storage keys and window events, in one place.
//
// PHASE 4 RENAME (spec-talk.md section 1, Naming canon): "Old localStorage
// keys workwrk:room:* and the event workwrk:room:start-talktok are renamed
// workwrk:talk:*." The product has been called Room, Chat, TLK, TalkTok and
// Talk; the storage keys were the last place three of those names still
// lived, and they were read as string literals in four files.
//
// EVERY KEY HERE IS PER-DEVICE EPHEMERA, and that is a decision rather than
// an oversight (settings-architecture section 7.3 rules "Room sections" and
// "format bar" ephemera). None of them is rendered as a setting, none is
// worth a round trip, and none belongs in UserPreference: this unit adds no
// key under `UserPreference.sidebar.*`, so the .strict() preferences schema
// is untouched.
//
// `readTalkKey` reads the new name and falls back to the old one ONCE, so
// nobody's collapsed sections or formatting bar reset on deploy day. The
// next write lands on the new key and the old one simply goes stale; it is
// not deleted, because deleting somebody's storage to save 20 bytes is not
// a trade worth making.
//
// Every read and write is wrapped, because localStorage throws outright in
// a browser set to block site data, not just in a private window.

/** Which sidebar sections are collapsed: `{ channels, dms }`. */
export const TALK_SECTIONS_KEY = "workwrk:talk:sections";
/** Whether the message box shows its formatting bar. */
export const TALK_FMTBAR_KEY = "workwrk:talk:fmtbar";
/** Recently used emoji, for the picker's Recent row. */
export const TALK_EMOJI_RECENT_KEY = "workwrk:talk:emoji-recent";

/** The old names, read once so a rename costs nobody their state. */
const LEGACY: Readonly<Record<string, string>> = {
  [TALK_SECTIONS_KEY]: "workwrk:room:sections",
  [TALK_FMTBAR_KEY]: "workwrk:room:fmtbar",
  [TALK_EMOJI_RECENT_KEY]: "workwrk:room:emoji-recent",
};

/**
 * "I just left this conversation, do not re-join me into it."
 *
 * sessionStorage rather than localStorage on purpose: the guard is for the
 * navigation that follows the Leave click, and it should not outlive the
 * tab. A person who closes the tab and comes back has changed their mind,
 * and the 404 self-join is the right answer again.
 */
export function talkLeftKey(conversationId: string): string {
  return `workwrk:talk:left:${conversationId}`;
}

/** The pre-Phase-4 spelling of the leave guard, still honoured on read. */
export function legacyTalkLeftKey(conversationId: string): string {
  return `workwrk:chat-left:${conversationId}`;
}

/** The current value of a Talk key, falling back to its pre-rename name. */
export function readTalkKey(key: string): string | null {
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = LEGACY[key];
    return legacy ? window.localStorage.getItem(legacy) : null;
  } catch {
    // Private mode, or a browser set to block site data. No stored value is
    // a correct answer, and every caller renders correctly without one.
    return null;
  }
}

/** The leave guard, honouring the pre-rename key for one session. */
export function readTalkLeft(conversationId: string): boolean {
  try {
    return (
      window.sessionStorage.getItem(talkLeftKey(conversationId)) === "1" ||
      window.sessionStorage.getItem(legacyTalkLeftKey(conversationId)) === "1"
    );
  } catch {
    return false;
  }
}

/** The window event that starts a call in the conversation already open. */
export const TALK_START_CALL_EVENT = "workwrk:talk:start-call";
