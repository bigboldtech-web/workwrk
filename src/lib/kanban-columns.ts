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
  /**
   * The status a card has ON THIS BOARD. Absent: its own `status`, exactly as
   * before. A card shown here through a link (Phase 5b) stores a value of its
   * home List's set, so the canvas passes the remap into this board's set
   * (list-link-rows.ts boardStatusFor) and the card lands in the column that
   * means the same thing here.
   */
  statusOf?: (row: T) => string | null,
  /**
   * The person picked "Separate" in the Board's Subtasks control: every
   * subtask is a card of its own, in the column of its own status, and the
   * card says whose subtask it is (lib/work/subtask-display.ts). Rule 1 is
   * theirs to turn off; rule 2 always holds.
   */
  opts: { separate?: boolean } = {},
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const s of statusOrder) map.set(s, []);
  const present = new Set(items.map((r) => r.id));
  for (const row of items) {
    // Rule 1: a child of a card on this board belongs to that card.
    if (!opts.separate && row.parentItemId && present.has(row.parentItemId)) continue;
    // Rule 2 plus the unknown-status fallback: never lose a row.
    const status = statusOf ? statusOf(row) : row.status;
    const bucket = status && map.has(status) ? status : statusOrder[0];
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

/**
 * Each card's subtasks, for the list a card opens in place. Built over the
 * same set as the count, so the list always holds exactly the number the
 * card says, in the order `order` gives (the List's one order).
 */
export function subtasksByParent<T extends KanbanRow>(
  items: readonly T[],
  order: (a: T, b: T) => number,
): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    if (!it.parentItemId) continue;
    const list = m.get(it.parentItemId);
    if (list) list.push(it);
    else m.set(it.parentItemId, [it]);
  }
  for (const list of m.values()) list.sort(order);
  return m;
}

/**
 * The order inside a column under "Separate": every card at the place of its
 * top-most ancestor on the board, a subtask straight after the task it hangs
 * under, so the cards a person arranges keep their order and a subtask reads
 * next to its parent. A parent that is not on the board leaves the subtask at
 * its own place. A loop in the data (never written, but never trusted) stops
 * the walk instead of spinning.
 */
export function treeOrder<T extends KanbanRow>(
  items: readonly T[],
  order: (a: T, b: T) => number,
): (a: T, b: T) => number {
  const byId = new Map(items.map((r) => [r.id, r] as const));
  const chains = new Map<string, T[]>();
  const chainOf = (row: T): T[] => {
    const known = chains.get(row.id);
    if (known) return known;
    const out: T[] = [];
    const seen = new Set<string>();
    let cur: T | undefined = row;
    while (cur && !seen.has(cur.id)) {
      out.unshift(cur);
      seen.add(cur.id);
      cur = cur.parentItemId ? byId.get(cur.parentItemId) : undefined;
    }
    chains.set(row.id, out);
    return out;
  };
  return (a, b) => {
    const ca = chainOf(a);
    const cb = chainOf(b);
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      if (ca[i].id !== cb[i].id) return order(ca[i], cb[i]);
    }
    // One holds the other: the task before what hangs under it.
    return ca.length - cb.length;
  };
}
