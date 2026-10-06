// Cutting text to a length without cutting a character in two. Pure.
//
// A JavaScript string counts UTF-16 units, and an emoji is two of them. A cut
// between the two leaves half of one: Postgres refuses it inside a JSON column
// ("Unicode low surrogate must follow a high surrogate"), so the whole write
// fails (an approval card, a memory, a turn's record), and a TEXT column
// stores a replacement mark instead. Every length limit on text a teammate
// writes goes through here.

/** At most `max` units of `s`, never ending on half a character. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const t = s.slice(0, Math.max(0, max));
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}
