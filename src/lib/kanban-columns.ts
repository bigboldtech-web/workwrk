// Kanban column bucketing, pure.
//
// The board draws one column per status. What it must NOT draw is a subtask as
// a card of its own: a child sitting loose in a column beside its parent reads
// as a second, unrelated task, which is precisely how "the plus on a card makes
// a new task" was reported. The parent's subtask count is what tells you the
// child exists; opening the parent is what shows it.
//
// Two rules the bucketing keeps, in this order:
//
//   1. a row whose parent is ALSO on this board is a child: it is counted on
//      the parent and never bucketed as a card;
//   2. a row whose parent is NOT on this board (archived parent, a parent in
//      another List, a parent the viewer cannot see) is re-rooted to top level
//      rather than dropped. The List view and the hierarchy view use the same
//      rule, for the same reason: a live task must never become invisible
//      because of who its parent is.
//
// Pure module, no React: the rules above are the part worth testing.

export interface KanbanRow {
  id: string;
  status?: string | null;
  parentItemId?: string | null;
}

/**
 * Cards per status column, children folded away.
 *
 * Every declared status gets a bucket, in `statusOrder`. A row carrying a
 * status the board no longer declares lands in the first column so it stays
 * on screen; with no statuses at all the result is empty and the view renders
 * its "no statuses yet" state.
 */
export function groupCardsByStatus<T extends KanbanRow>(
  items: readonly T[],
  statusOrder: readonly string[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const s of statusOrder) map.set(s, []);
  const present = new Set(items.map((r) => r.id));
  for (const row of items) {
    // Rule 1: a child of a card on this board belongs to that card.
    if (row.parentItemId && present.has(row.parentItemId)) continue;
    // Rule 2 plus the unknown-status fallback: never lose a row.
    const bucket = row.status && map.has(row.status) ? row.status : statusOrder[0];
    if (bucket) map.get(bucket)!.push(row);
  }
  return map;
}

/**
 * How many children each card has. Counted over the WHOLE set, including rows
 * that were re-rooted or bucketed elsewhere, so the badge on a parent always
 * matches what opening it shows.
 */
export function countSubtasksByParent(items: readonly KanbanRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.parentItemId) m.set(it.parentItemId, (m.get(it.parentItemId) ?? 0) + 1);
  }
  return m;
}
