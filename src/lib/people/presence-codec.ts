// The person's own status as ONE server value (User.presenceStatus), so it
// follows them to every device (settings-architecture 7.3: presence moves
// off localStorage). The shell's status is { emoji, label, expiresAt }; the
// column is text, so an emoji rides at the front: "📅 In a meeting". Every
// other reader (presence.ts presenceDot, the Directory, the Org chart) reads
// the text as it is, and the emoji simply shows there too.
//
// Pure; tested.

export interface PresenceValue {
  emoji: string | null;
  label: string;
  expiresAt: string | null;
}

/** "Online" (or empty) clears the dot: the server stores null. */
export function encodePresence(v: PresenceValue): string | null {
  const label = v.label.trim();
  if (!label || label === "Online" || label === "Active") return null;
  const emoji = v.emoji?.trim();
  return (emoji ? `${emoji} ${label}` : label).slice(0, 60);
}

// A leading run of non-letter, non-digit, non-space symbols followed by a
// space is the emoji ("📅 In a meeting", "🏖️ Vacation").
const LEADING_EMOJI = /^([^\p{L}\p{N}\s]+)\s+(.+)$/u;

export function decodePresence(status: string | null | undefined, until: string | null | undefined): PresenceValue | null {
  if (!status || typeof status !== "string" || !status.trim()) return null;
  const m = status.trim().match(LEADING_EMOJI);
  return {
    emoji: m ? m[1] : null,
    label: m ? m[2] : status.trim(),
    expiresAt: until ?? null,
  };
}
