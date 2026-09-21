// Shared list-page query helpers for /canvas and /files (spec-docs-knowledge
// section 2): the sort direction default, the limit clamp, and the cursor
// slice the docs list uses too. Pure; vitest-covered through the two
// per-surface modules that call it.

export const LIST_DEFAULT_LIMIT = 40;
export const LIST_MAX_LIMIT = 100;

export function parseLimit(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(LIST_MAX_LIMIT, Math.floor(n)) : LIST_DEFAULT_LIMIT;
}

export function parseDir(raw: string | null, textSort: boolean): "asc" | "desc" {
  if (raw === "asc" || raw === "desc") return raw;
  return textSort ? "asc" : "desc";
}

export function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
}

/** Cursor = the id of the last row of the previous page; unknown cursors restart at 0. */
export function sliceByCursor<T extends { id: string }>(rows: T[], cursor: string | null, limit: number): { page: T[]; nextCursor: string | null; from: number } {
  let start = 0;
  if (cursor) {
    const i = rows.findIndex((r) => r.id === cursor);
    start = i >= 0 ? i + 1 : 0;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < rows.length && page.length > 0 ? page[page.length - 1].id : null;
  return { page, nextCursor, from: start };
}

export function textCompare(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

export function timeOf(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** True when any of the named params is present: the caller wants the paged envelope. */
export function wantsPaged(sp: URLSearchParams, keys: readonly string[]): boolean {
  return keys.some((k) => sp.has(k));
}
