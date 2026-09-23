// One rule for "what did the person mean by that URL", shared by the message
// box's Link popover and anything else that takes a typed web address.
//
// The rule it replaces was `/^https?:\/\//.test(url)`, applied to the result of
// a window.prompt pre-filled with "https://". That rejected `example.com`,
// which is what people actually type, and accepted `javascript:` never because
// of the scheme test but only by accident of the prefix check running first.
//
// This is deliberately strict about schemes: http and https and mailto only.
// `javascript:` and `data:` in a message body are the two that turn a chat
// message into a way to run code in somebody else's session.

const SAFE_SCHEME = /^(https?|mailto):/i;

/**
 * Normalise a typed address, or null when there is nothing usable in it.
 *
 *   "example.com"           -> "https://example.com"
 *   "http://x.dev/a?b=1"    -> unchanged
 *   "mailto:a@b.com"        -> unchanged
 *   "javascript:alert(1)"   -> null
 *   ""                      -> null
 */
export function normaliseLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  // A scheme is present: accept only the safe ones, whatever they look like.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (!SAFE_SCHEME.test(value)) return null;
    return value;
  }

  // A bare email address is a mailto, which is what people mean by typing one.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;

  // Otherwise it is a host, and https is the assumption worth making in 2026.
  // One dot minimum, so a stray word does not become a link.
  if (!/^[^\s/]+\.[^\s/]+/.test(value)) return null;
  return `https://${value}`;
}
