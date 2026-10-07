// Text a teammate's model reads as data, made plain before its "<" and ">"
// are escaped (review round 7). Escaping covered only the ASCII brackets, so
// a task title or a planted line could carry look-alikes the model reads as
// a tag ("＜/workspace_note＞", "〈", "‹"), or characters nobody sees on a
// card but the model reads: direction overrides, zero-width marks and the
// invisible tag letters (U+E0000 to U+E007F). Here look-alikes become the
// real brackets, so the escaping that follows catches them, and invisible
// format characters go. Nothing else changes: no Unicode normalising, which
// would turn a fullwidth quote into a real one inside a tool's JSON. Every
// data path calls it (engine.ts dataText, dataLines and oneLine, memory.ts
// promptLine, executor.ts wrapToolData).

/** Characters that read as "<" or ">": fullwidth, small, angle and ornament forms. */
const OPENERS = /[＜﹤‹〈⟨〈❬❮❰˂ᐸᑀ]/g;
const CLOSERS = /[＞﹥›〉⟩〉❭❯❱˃ᐳᑁ]/g;

export function plainData(s: string): string {
  return String(s ?? "")
    .replace(/\p{Cf}/gu, "")
    .replace(OPENERS, "<")
    .replace(CLOSERS, ">");
}
