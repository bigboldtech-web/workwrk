// Find & Replace text primitives (Tables · Sheets' Cmd+F / Cmd+H).
//
// The sheet page owns WHAT text a cell exposes to find (the same sources
// its search filter reads) and WHICH cells replace may touch; this module
// owns the two pure decisions underneath, so they can be pinned by tests
// without mounting the page:
//
//   * matchesFindQuery — the one matching rule: case-insensitive substring.
//     The query is LITERAL text, never a pattern: a user searching "1.5"
//     must not match "125", and "(" must not throw.
//   * replaceAllOccurrences — every occurrence in one cell's text, matched
//     case-insensitively, replaced with the LITERAL replacement (a "$&" the
//     user types is two characters, not a regex backreference).
//
// REPLACE_SKIP_TYPES is the shared skip list: column types find COUNTS but
// replace never writes — computed cells (formula/lookup/rollup: the value
// is derived, writing text over it would be destruction, not replacement)
// and shapes with no text encoding a substring surgery could rebuild
// (link/person/attachment ids, checkbox booleans, multi_select arrays,
// whose match text is a JOINED projection that cannot map back to
// elements). Per-cell formulas ({"=": src} in an open column) are the
// page's half of the same rule — it has the stored shape, this list only
// speaks for column TYPES.

/** Literal-text escape: the find query as a RegExp source that matches
 *  exactly itself. Every ECMAScript pattern metacharacter is covered. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive LITERAL substring test — the single matching rule the
 *  find scan applies to every cell. An empty query matches nothing: the
 *  bar with no text highlights no cells (matching "" everywhere would
 *  tint the whole sheet). */
export function matchesFindQuery(text: string, query: string): boolean {
  if (query === "") return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

/** Replace EVERY occurrence of `query` in `text` (case-insensitive,
 *  literal) with `replacement`, itself literal: the function-replacement
 *  form keeps "$&"/"$1" in the replacement as typed characters. An empty
 *  query returns the text untouched — there is no occurrence of nothing.
 *  Matches are found left to right and never overlap (the regex engine's
 *  rule: "aaa" with query "aa" replaces one occurrence, the trailing "a"
 *  survives), which is exactly what Sheets does. */
export function replaceAllOccurrences(text: string, query: string, replacement: string): string {
  if (query === "") return text;
  return text.replace(new RegExp(escapeLiteral(query), "gi"), () => replacement);
}

/** Column types replace SKIPS (still counted by find — the honest note in
 *  the card reports how many matches were skipped). String-keyed so the
 *  page's ColType union stays page-local. */
export const REPLACE_SKIP_TYPES: ReadonlySet<string> = new Set([
  "formula", "lookup", "rollup", "link", "person", "attachment", "checkbox", "multi_select",
]);
