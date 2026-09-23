// What a channel is called, and the one place that decides it.
//
// Channel names are lowercase and hyphenated, as every chat product's are,
// and the reason is not style: "#Sales Team" and "#sales-team" existing as two
// channels is a problem people only discover once they have both, and by then
// half the company is in the wrong one. The create endpoint already refuses a
// case-insensitive clash; this makes the two spellings the SAME name rather
// than two names that happen to collide.
//
// Pure, so the New channel dialog's live "It will be called #…" caption and
// any server-side normalisation can never disagree about the answer.

/** The longest a channel name may be, matching the create route's slice. */
export const CHANNEL_NAME_MAX = 60;

export function normaliseChannelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // A leading "#" is what people type when they mean "a channel", not part
    // of the name: the product renders the hash itself.
    .replace(/^#+/, "")
    // Keep letters, digits, spaces, underscore and hyphen. Everything else
    // goes, rather than being transliterated: a guess at what "café" should
    // become is a guess somebody has to live with.
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, CHANNEL_NAME_MAX)
    // Trailing punctuation left by the slice or by the input itself.
    .replace(/^-+|-+$/g, "");
}
