// Moving a task between Lists — the status remap, pure.
//
// spec-task-detail.md section 4 step 1: `PATCH /api/items/[id] { boardId }`
// "re-parents the row, remaps `status` to the target List's status with the
// same group else its first Active status, keeps `position` at the end, writes
// `MOVED` activity on both Lists, requires Can edit on both".
//
// The remap is the only part with a judgement call in it, so it lives here on
// its own, with a test, rather than inline in the route. Data integrity is the
// reason: a task that lands in a List whose status set does not contain its
// stored value renders with no status chip and drops out of every group-by,
// which looks exactly like a lost task.
//
// Order of preference, first match wins:
//   1. the exact same status value exists on the target List (keep it);
//   2. a status on the target with the same LABEL, case-insensitive
//      ("In Progress" on one List, "in progress" on another);
//   3. the target's first status in the SAME GROUP as the source status;
//   4. the target's first ACTIVE status;
//   5. the target's first status of any group (a List with no Active status);
//   6. null (a List with no statuses at all — the caller stores null and the
//      row renders "No status" rather than a value the List cannot show).
//
// Pure module: imports only the client-safe status types.

import type { StatusOption } from "@/lib/board-items-shared";
import { isDoneStatusName } from "@/lib/board-items-shared";

export type StatusRemapReason =
  | "same-value"
  | "same-label"
  | "same-group"
  | "first-active"
  | "first-any"
  | "none";

export interface StatusRemap {
  /** The value to store on the moved row. */
  status: string | null;
  reason: StatusRemapReason;
}

function firstOfGroup(statuses: readonly StatusOption[], group: string): StatusOption | undefined {
  return statuses.find((s) => s.group === group);
}

/**
 * Pick the status a task should carry after a move.
 *
 * `from` is the SOURCE List's status set, used only to learn the group and
 * label of the stored value; a value the source no longer declares is treated
 * as an unknown Active status, which is what every other reader does.
 */
export function remapStatusOnMove(args: {
  status: string | null | undefined;
  from: readonly StatusOption[];
  to: readonly StatusOption[];
}): StatusRemap {
  const { status, from, to } = args;
  if (to.length === 0) return { status: null, reason: "none" };
  if (!status) {
    const active = firstOfGroup(to, "ACTIVE");
    return active ? { status: active.value, reason: "first-active" } : { status: to[0].value, reason: "first-any" };
  }

  // 1. the same value survives untouched.
  if (to.some((s) => s.value === status)) return { status, reason: "same-value" };

  const source = from.find((s) => s.value === status) ?? null;
  const sourceLabel = (source?.label ?? status).trim().toLowerCase();

  // 2. same words, different key.
  const byLabel = to.find((s) => s.label.trim().toLowerCase() === sourceLabel);
  if (byLabel) return { status: byLabel.value, reason: "same-label" };

  // 3. same group: a Done task stays done, a Closed task stays closed.
  const group = source?.group ?? "ACTIVE";
  const byGroup = firstOfGroup(to, group);
  if (byGroup) return { status: byGroup.value, reason: "same-group" };

  // 4 and 5.
  const active = firstOfGroup(to, "ACTIVE");
  if (active) return { status: active.value, reason: "first-active" };
  return { status: to[0].value, reason: "first-any" };
}

/**
 * The same remap, applied to every DESCENDANT of a moved task, grouped by the
 * status they end up with so the writer can issue one update per distinct
 * value rather than one per row.
 *
 * The subtasks travel with their parent, and they used to travel carrying a
 * status the target List may not declare. The reason at the top of this file
 * applies to a child exactly as it applies to a parent: a row whose status the
 * List does not know drops out of every group-by, which looks exactly like a
 * lost task. Kanban happens to bucket an unknown status into its first column,
 * so the gap only showed on a grouped List view, which is where most people
 * look.
 *
 * `to` empty means the target declares no statuses at all; every child lands
 * on null, which renders "No status" rather than a value nothing can show.
 */
export function remapDescendantStatuses(
  children: readonly { id: string; status: string | null }[],
  from: readonly StatusOption[],
  to: readonly StatusOption[],
): Map<string | null, string[]> {
  const byStatus = new Map<string | null, string[]>();
  for (const child of children) {
    const next = remapStatusOnMove({ status: child.status, from, to }).status;
    const bucket = byStatus.get(next);
    if (bucket) bucket.push(child.id);
    else byStatus.set(next, [child.id]);
  }
  return byStatus;
}

// ── Move destinations ───────────────────────────────────────────────
//
// The Personal list is one person's private surface. `PATCH /api/items/[id]`
// refuses it as a move target with 403 ("personal_list_not_a_move_target"), so
// the picker must not offer it: a destination the server will reject is a row
// that fails on click, which is exactly what "Move to" looked like in the
// field.
//
// The filter lives HERE rather than in `GET /api/boards?editable=1`, because
// that route also feeds the create-task location picker, where your own
// Personal list IS a valid destination. The route stays the superset and each
// caller narrows it.

/** Board.productSlug of the per-person Personal list (see lib/board.ts). */
export const PERSONAL_LIST_SLUG = "personal-list";

/**
 * The Lists a task may actually be moved into, from every List the viewer can
 * write to. Only the Personal list is dropped; nothing else is hidden, so
 * every destination the server would accept stays reachable.
 */
export function moveDestinations<T extends { productSlug?: string | null }>(lists: readonly T[]): T[] {
  return lists.filter((l) => l.productSlug !== PERSONAL_LIST_SLUG);
}

/**
 * A status someone asked for, as a status of THIS List (pen test 2026-11-28,
 * V-39, and its review). Never refused and never dropped silently: the value
 * itself when the List has it; else the List's status of the same name (case,
 * spaces and underscores aside: "In progress" for IN_PROGRESS); else, for a
 * done word ("Complete", "Done", "Shipped"...), the List's first done status;
 * else the List's first open status. A List with no set keeps the value.
 * Used for a create and for a status edit, so a picker that offered another
 * List's statuses (the create modal's Space workflow, My Work's bulk menu)
 * lands the meaning, never a value this List does not have.
 */
export function resolveListStatus(
  statuses: readonly StatusOption[],
  wanted: string,
  /** The group the value has in the Lists that declare it ("SHIPPED" is done in List B). */
  groupHint?: StatusOption["group"] | null,
): string {
  if (statuses.length === 0) return wanted;
  if (statuses.some((s) => s.value === wanted)) return wanted;
  const norm = (x: string) => x.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const w = norm(wanted);
  const byName = statuses.find((s) => norm(s.value) === w || norm(s.label) === w);
  if (byName) return byName.value;
  if (groupHint) {
    const same = firstOfGroup(statuses, groupHint) ?? (groupHint === "CLOSED" ? firstOfGroup(statuses, "DONE") : groupHint === "DONE" ? firstOfGroup(statuses, "CLOSED") : undefined);
    if (same) return same.value;
  }
  if (isDoneStatusName(wanted)) {
    const done = firstOfGroup(statuses, "DONE") ?? firstOfGroup(statuses, "CLOSED");
    if (done) return done.value;
  }
  return (firstOfGroup(statuses, "ACTIVE") ?? statuses[0]).value;
}
