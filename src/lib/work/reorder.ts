// Dragging a task up or down: where it lands, as one number.
//
// A List's order is Item.position (and, for a task shown there through a
// link, that link's position, in the same number space). A drop puts the
// task between its new neighbours at their MIDPOINT, so one write moves it
// and nothing else is renumbered: the List view has done this since Phase 71.
//
// THE CASE MIDPOINTS CANNOT SERVE. Tasks made by some paths share a position
// (seeded or templated tasks can all sit at 0), and repeated drops into one
// gap halve it until two neighbours are equal in floating point. Then the
// midpoint IS a neighbour, the task lands tied with it, and the drop looks
// like it did nothing. So a drop between neighbours closer than MIN_GAP asks
// for the List to be renumbered instead (PUT /api/boards/[id]/order): the
// SERVER reads the whole List's order (a filtered view shows only some of
// it), puts the task between the same two neighbours and renumbers every
// task POSITION_STEP apart.
//
// Pure: the Board, the List and the subtask list all plan with it.

export const POSITION_STEP = 1024;

/** Neighbours closer than this are renumbered rather than split again. */
export const MIN_GAP = 1e-6;

export interface Ordered {
  id: string;
  position: number;
}

/** The order a List shows: position, then id, so tied rows sit still. */
export function byPosition(a: Ordered, b: Ordered): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export type DropPlan =
  /** Nothing moves: it is dropped where it already is (or into an empty column, where only its status changes). */
  | { kind: "none" }
  /** One write: the dragged task's new position. */
  | { kind: "position"; position: number }
  /** The neighbours have no room between them: the server renumbers the List with the task between them. */
  | { kind: "renumber"; afterId: string; beforeId: string };

/**
 * Where a dragged task lands when it is dropped into `group` (one column, one
 * group or the whole List, in display order, with or without the dragged
 * task in it) at `index`, counted among the group's OTHER tasks (0 = the top,
 * their count = the bottom).
 */
export function planDrop(group: readonly Ordered[], draggedId: string, index: number): DropPlan {
  const others = group.filter((t) => t.id !== draggedId);
  const at = Math.max(0, Math.min(index, others.length));
  const was = group.findIndex((t) => t.id === draggedId);
  // Dropped back between the very neighbours it already has.
  if (was !== -1 && was === at) return { kind: "none" };
  const prev = others[at - 1] ?? null;
  const next = others[at] ?? null;
  if (!prev && !next) return { kind: "none" };
  if (prev && next) {
    if (next.position - prev.position > MIN_GAP) return { kind: "position", position: (prev.position + next.position) / 2 };
    return { kind: "renumber", afterId: prev.id, beforeId: next.id };
  }
  if (next) return { kind: "position", position: next.position - POSITION_STEP };
  return { kind: "position", position: prev!.position + POSITION_STEP };
}

/**
 * A List's whole order with one task moved: before `beforeId` when it is
 * there, else after `afterId`, else null (the neighbours left the List, so
 * the person is shown it again rather than a guess). The server renumbers
 * with this, over every live task the List holds.
 */
export function moveInOrder(order: readonly Ordered[], movedId: string, afterId: string | null, beforeId: string | null): string[] | null {
  const rest = [...order].sort(byPosition).filter((t) => t.id !== movedId);
  if (rest.length === order.length) return null;
  let at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at === -1 && afterId) {
    const after = rest.findIndex((t) => t.id === afterId);
    at = after === -1 ? -1 : after + 1;
  }
  if (at === -1) return null;
  return [...rest.slice(0, at).map((t) => t.id), movedId, ...rest.slice(at).map((t) => t.id)];
}

/**
 * Where the server puts the moved task once it knows the List's true order
 * (`order`, with the task moved) and every task's stored number: between its
 * real neighbours when they have room (one write, nothing else moves), else
 * null, and the List is renumbered. A view that holds only some pages, or
 * numbers that are no longer current, never decides this.
 */
export function placeInOrder(order: readonly string[], positions: ReadonlyMap<string, number>, movedId: string): number | null {
  const i = order.indexOf(movedId);
  if (i === -1) return null;
  const prev = i > 0 ? positions.get(order[i - 1]) ?? null : null;
  const next = i < order.length - 1 ? positions.get(order[i + 1]) ?? null : null;
  if (prev !== null && next !== null) return next - prev > MIN_GAP ? (prev + next) / 2 : null;
  if (prev !== null) return prev + POSITION_STEP;
  if (next !== null) return next - POSITION_STEP;
  return POSITION_STEP;
}

/** The positions a renumber gives, by id. */
export function renumberedPositions(order: readonly string[]): Map<string, number> {
  return new Map(order.map((id, i) => [id, (i + 1) * POSITION_STEP] as const));
}

/**
 * Before or after the card under the pointer: the upper half of a card means
 * before it, the lower half after it.
 */
export function dropSide(pointerY: number, rect: { top: number; height: number }): "before" | "after" {
  return pointerY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * The drop index among a group's OTHER tasks for a drop before or after
 * `targetId` (display order, may include the dragged task). Let go on the
 * dragged task itself and it is where it already is, which planDrop reads as
 * no move (a drag that never left its place must never send it anywhere).
 */
export function indexFor(group: readonly Ordered[], draggedId: string, targetId: string, side: "before" | "after"): number {
  const others = group.filter((t) => t.id !== draggedId);
  if (targetId === draggedId) {
    const was = group.findIndex((t) => t.id === draggedId);
    return was === -1 ? others.length : was;
  }
  const at = others.findIndex((t) => t.id === targetId);
  if (at === -1) return others.length;
  return side === "before" ? at : at + 1;
}

/**
 * The drop index for a pointer at `y` over a column whose OTHER cards sit at
 * `boxes` (top to bottom, each with its place among them): before the first
 * card whose middle is below the pointer, else the bottom. The gaps between
 * cards belong to the card below them, so a drop between two cards lands
 * between them.
 */
export function indexAtPointer(y: number, boxes: ReadonlyArray<{ place: number; top: number; height: number }>, count: number): number {
  for (const b of boxes) if (y < b.top + b.height / 2) return b.place;
  return count;
}
