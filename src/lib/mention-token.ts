// The two pure halves of the @-mention contract.
//
// They live here rather than inside the typeahead component for one reason:
// both are rules, not rendering, and both are the kind of rule that is wrong
// in a way nobody notices until somebody gets a notification for a message
// that never names them.
//
// Pure module: no imports, so vitest loads it in the node environment.

export interface MentionRef {
  id: string;
  /** The exact "First Last" that was inserted, so it can be checked later. */
  name: string;
}

/**
 * Find an active "@query" token ending at the caret, if any.
 *
 * "@" must start the text or follow whitespace or "(", which is what keeps an
 * email address from opening the typeahead every time somebody types one.
 */
export function detectMention(value: string, caret: number): { start: number; query: string } | null {
  const at = value.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  if (at > 0 && !/[\s(]/.test(value[at - 1])) return null;
  const token = value.slice(at + 1, caret);
  if (token.length > 40 || /[\n@]/.test(token)) return null;
  return { start: at, query: token };
}

/**
 * What a keystroke or caret move opens, given the "@" the list was last closed
 * on (a person picked, or Esc): that "@" stays closed. A pick leaves "@First
 * Last " right before the caret, which is a token by the rule above, so the
 * key-up after Enter would open the list again over the name just chosen, and
 * Esc would last only until the key came back up. Any other "@", or none, is
 * a fresh start.
 */
export function afterClosedToken<T extends { start: number }>(
  found: T | null,
  closedAt: number | null,
): { token: T | null; closedAt: number | null } {
  if (found && found.start === closedAt) return { token: null, closedAt };
  return { token: found, closedAt: null };
}

/**
 * The ids still named in a body, for the POST.
 *
 * Only mentions whose "@First Last" token survived editing are sent: taking a
 * name out of a draft has to un-invite that person.
 */
export function surviving(mentions: readonly MentionRef[], body: string): string[] {
  return [...new Set(mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id))];
}
