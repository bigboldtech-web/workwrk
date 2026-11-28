// Prisma's `contains` and `startsWith` become SQL LIKE without escaping, so a
// `%` or `_` someone typed was a wildcard: "%%" matched everything and "_"
// any one character (the staff console first; the app's own search in pen
// test 2026-11-28, V-53). Backslash is Postgres's default LIKE escape.
//
// Pure module.

export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
