// The viewer's recently opened docs, as stored in their Home preferences
// (home.recentDocViews), read back into ids in the stored order (newest first)
// plus when each was opened.
//
// The only writer, POST /api/me/recent-docs, stores { id, at }. An older
// shape stored { docId, at }, and an older one still stored a bare id string;
// all three are read so no view is ever dropped. Home's Recent docs card read
// ONLY the { docId } shape, so no stored view matched and the card was always
// empty; this is the one reader both it and any future caller use.
//
// Pure: no imports, so the test is node-only.

export interface RecentDocViews {
  /** Doc ids, newest first, each once. */
  ids: string[];
  /** docId -> ISO time it was last opened, when the view recorded one. */
  viewedAt: Map<string, string>;
}

export function parseRecentDocViews(raw: unknown): RecentDocViews {
  const ids: string[] = [];
  const viewedAt = new Map<string, string>();
  if (!Array.isArray(raw)) return { ids, viewedAt };
  const seen = new Set<string>();
  for (const v of raw as unknown[]) {
    let id: string | null = null;
    let at: unknown = undefined;
    if (typeof v === "string") {
      id = v;
    } else if (v && typeof v === "object") {
      const o = v as { id?: unknown; docId?: unknown; at?: unknown };
      id = typeof o.id === "string" ? o.id : typeof o.docId === "string" ? o.docId : null;
      at = o.at;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (typeof at === "string") viewedAt.set(id, at);
  }
  return { ids, viewedAt };
}
