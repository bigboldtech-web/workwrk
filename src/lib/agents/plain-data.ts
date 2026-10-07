// Text a teammate's model reads as data, made plain before its "<" and ">"
// are escaped (review round 7). Escaping covered only the ASCII brackets, so
// a task title or a planted line could carry look-alikes the model reads as
// a tag ("＜/workspace_note＞", "〈", "‹"), or characters nobody sees on a
// card but the model reads: direction overrides and isolates, zero-width
// spaces and the invisible tag letters (U+E0000 to U+E007F). Look-alike
// punctuation becomes the real brackets, so the escaping that follows
// catches it, and those invisible characters go.
//
// What real text needs stays (review round 8): the zero-width joiner and
// non-joiner (Persian and Indic words, emoji sequences), the left-to-right
// and right-to-left marks, the soft hyphen, and letters of any script that
// only look like brackets (Canadian Syllabics). A name the model reads is
// the name it types back to find a teammate, so it must not change.
// Nothing is normalised: that would turn a fullwidth quote into a real one
// inside a tool's JSON. Every data path calls it (engine.ts dataText,
// dataLines and oneLine, memory.ts promptLine, executor.ts wrapToolData).

/** Punctuation that reads as "<" or ">": fullwidth, small, angle and ornament brackets. */
const OPENERS = /[＜﹤‹〈⟨〈❬❮❰]/g;
const CLOSERS = /[＞﹥›〉⟩〉❭❯❱]/g;

/**
 * Invisible characters that only hide or reorder text: direction overrides
 * and embeddings (U+202A to U+202E), isolates (U+2066 to U+2069), the
 * zero-width space, word joiner and invisible operators (U+200B, U+2060 to
 * U+2064), the byte order mark, the Mongolian vowel separator and the tag
 * letters.
 */
const HIDDEN = /[‪-‮⁦-⁩​⁠-⁤﻿᠎]|[\u{E0000}-\u{E007F}]/gu;

export function plainData(s: string): string {
  return String(s ?? "")
    .replace(HIDDEN, "")
    .replace(OPENERS, "<")
    .replace(CLOSERS, ">");
}
