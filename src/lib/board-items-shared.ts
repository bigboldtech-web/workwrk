// Client-safe slice of board-items — types + constants only.
// Anything imported by a "use client" component MUST live here (or in
// another no-server-deps module), not in `board-items.ts`, because
// board-items.ts pulls in Prisma + pg + node:fs/net/tls/dns which
// can't bundle for the browser.
//
// The server-side helpers (createBoardItem, updateBoardItem, etc.)
// stay in board-items.ts and continue to import this file for the
// shared types so the API surface stays unified.

import type { RecurrenceRule } from "@/lib/recurrence";

// ── Per-List statuses (ClickUp parity backbone #1) ─────────────────
//
// Every status belongs to a group that drives completion logic:
//   ACTIVE → open work (overdue checks, "hide closed" keep these)
//   DONE   → completed
//   CLOSED → terminal-but-not-done (cancelled, closed-lost, churned)
// A Board stores its own set in Board.statuses (Json); null means
// "use the canonical default trio" below.

export type StatusGroup = "ACTIVE" | "DONE" | "CLOSED";

export interface StatusOption {
  value: string;
  label: string;
  color: string;
  group: StatusGroup;
}

/**
 * The three statuses a List has before anybody edits them.
 *
 * These are DATA, not styling: a List owner picks a hex per status and it is
 * stored on `Board.statuses`, so the renderers have to take a colour value
 * here rather than a class name. What they may not be is a colour vocabulary
 * of their own. The three defaults were #94a3b8 / #3b82f6 / #10b981, which is
 * Tailwind's slate, blue and emerald: a blue that is not the product's blue
 * (#0073EA) and a green that is not the product's green, arriving on rows
 * beside chips that use the real tokens. They are now the token values, so
 * the seeded product ships one palette.
 *
 * Renderers still owe the other half of the rule: the pill is PALE (a tint of
 * this colour behind the colour as text), never a solid block, because a
 * saturated fill on a row makes a status shout louder than the task.
 */
export const DEFAULT_STATUS_OPTIONS: readonly StatusOption[] = [
  // --os-ink-3: not started is quiet.
  { value: "TO_DO",       label: "To Do",        color: "#98A2B3", group: "ACTIVE" },
  // --os-brand: the one blue, and the only status that carries it.
  { value: "IN_PROGRESS", label: "In Progress",  color: "#0073EA", group: "ACTIVE" },
  // --os-success-solid.
  { value: "DONE",        label: "Done",         color: "#15803D", group: "DONE" },
] as const;

const STATUS_GROUPS = new Set<string>(["ACTIVE", "DONE", "CLOSED"]);

/** Validate a raw Board.statuses blob into a usable set, or null when
 *  absent/malformed. Accepts `key` as an alias for `value` so the Space
 *  wizard's StatusDef shape round-trips unchanged. */
export function parseBoardStatuses(raw: unknown): StatusOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: StatusOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const value = typeof e.value === "string" && e.value ? e.value : typeof e.key === "string" ? e.key : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: typeof e.label === "string" && e.label ? e.label : value,
      color: typeof e.color === "string" && e.color ? e.color : "#94a3b8",
      group: STATUS_GROUPS.has(e.group as string) ? (e.group as StatusGroup) : "ACTIVE",
    });
  }
  return out.length > 0 ? out : null;
}

/** The board's own status set, or the canonical default when the board
 *  has none (statuses null/malformed). Server pages and client views
 *  share this so the same set renders everywhere. */
export function getBoardStatuses(board: { statuses?: unknown } | null | undefined): StatusOption[] {
  return parseBoardStatuses(board?.statuses) ?? [...DEFAULT_STATUS_OPTIONS];
}

/** Pre-built value→option map for a board's set. */
export function makeStatusLookup(statuses: readonly StatusOption[]): Record<string, StatusOption> {
  return Object.fromEntries(statuses.map((o) => [o.value, o]));
}

// ── The ONE cross-surface done rule ────────────────────────────────
//
// Cross-board surfaces (/api/me/items, /team/workload) can't consult a
// single board's status set, so they fall back to this name heuristic.
// Board-scoped callers resolve through the status group first; the
// heuristic only decides values missing from the set. One definition,
// every caller — a task can't read "done" on /today and "open" on the
// workload grid.
const DONE_STATUS_NAMES: ReadonlySet<string> = new Set([
  "done", "complete", "completed", "closed", "resolved",
]);

/** Cross-board done check by status NAME alone (no status set in scope).
 *  Shared by /api/me/items and isDoneStatus's unknown-value fallback. */
export function isDoneStatusName(value: string | null | undefined): boolean {
  if (!value) return false;
  return DONE_STATUS_NAMES.has(value.trim().toLowerCase());
}

/** Completion check driven by the status group — replaces hardcoded
 *  `status === "DONE"` comparisons. Values missing from the set fall
 *  back to the shared cross-board name heuristic: a custom board's
 *  "COMPLETED" row evaluated against the default trio still counts as
 *  done, while genuinely unknown statuses stay open so stale rows never
 *  silently drop out of overdue logic. */
export function isDoneStatus(statuses: readonly StatusOption[], value: string | null | undefined): boolean {
  if (!value) return false;
  const opt = statuses.find((o) => o.value === value);
  return opt ? opt.group !== "ACTIVE" : isDoneStatusName(value);
}

// First-class priority. Order matters: it is the URGENT to LOW display order
// and the group-by bucket order.
//
// `color` exists for the CHARTS (board-chart-view, board-pivot-view,
// board-dashboard-view), where a series genuinely needs a colour value and a
// class name is no use. It is the token palette, not a rainbow: the blue is
// the product's blue and the red and amber are the semantic trio's.
export const PRIORITY_OPTIONS = [
  { value: "URGENT", label: "Urgent", color: "#D92D20" },
  { value: "HIGH",   label: "High",   color: "#854D0E" },
  { value: "NORMAL", label: "Normal", color: "#5C6779" },
  { value: "LOW",    label: "Low",    color: "#98A2B3" },
] as const;

export type PriorityValue = (typeof PRIORITY_OPTIONS)[number]["value"];

/**
 * How a priority READS on a task row, which is not the same question as what
 * colour a chart draws it in.
 *
 * Principle 1 keeps blue off icons at rest and principle 7 says colour never
 * travels alone, so only the semantic trio carries red, amber and green. A
 * red, amber and blue set of flags with no word beside them broke both: it
 * asked the reader to learn a colour code, and it spent the product's accent
 * on a field that is not an action.
 *
 * So there is exactly one hue in the whole scale, on the one value that is an
 * alarm, and the rest separate by weight: filled for high, outline for the
 * two below it. The WORD is always rendered next to the flag, which is what
 * actually makes the field readable, and what makes it read the same on
 * /everything, /my-work and a List.
 */
export const PRIORITY_TONE: Readonly<Record<string, { text: string; filled: boolean }>> = {
  URGENT: { text: "text-danger-text", filled: true },
  HIGH:   { text: "text-ink",         filled: true },
  NORMAL: { text: "text-ink-2",       filled: false },
  LOW:    { text: "text-ink-3",       filled: false },
};

// Pre-built value→option lookups so consumers stop re-running
// Object.fromEntries(DEFAULT_STATUS_OPTIONS.map(...)) in every view.
// NOTE: this is the DEFAULT set's lookup — board-scoped views should
// build their own via makeStatusLookup(getBoardStatuses(board)).
export const STATUS_LOOKUP: Record<string, StatusOption> = makeStatusLookup(DEFAULT_STATUS_OPTIONS);
export const PRIORITY_LOOKUP: Record<string, { value: string; label: string; color: string }> =
  Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o]));

export interface ItemTag {
  id: string;
  name: string;
  color: string | null;
}

// ── Adding a subtask ────────────────────────────────────────────────────────
//
// Type-first, everywhere. A view that POSTs a placeholder title and then drops
// the new row into rename writes that placeholder to the database the moment
// anything interrupts the rename (a click elsewhere, a reload, a dropped
// request), and the List is left holding a task called "New subtask". One
// builder, so no surface can invent a title again: the user's own text is the
// only thing that ever becomes one.
export interface SubtaskCreateBody {
  title: string;
  status: string | null;
  parentItemId: string;
}

/**
 * The POST body for a new subtask, or null when there is nothing to save.
 *
 * `null` for an empty (or whitespace-only) title is the point: the caller must
 * not fall back to a placeholder, it must keep the cursor in the input.
 */
export function buildSubtaskBody(args: {
  title: string;
  parentId: string;
  parentStatus?: string | null;
  fallbackStatus?: string | null;
}): SubtaskCreateBody | null {
  const title = args.title.trim();
  if (!title) return null;
  return {
    title,
    status: args.parentStatus ?? args.fallbackStatus ?? null,
    parentItemId: args.parentId,
  };
}

// ── Bulk fan-out helpers (2026-08-12) ───────────────────────────────────────
// The board views run bulk actions as one request per id (no server bulk
// endpoint yet). fetch() only REJECTS on network failure: an HTTP 404/403
// resolves fulfilled, so a handler that checks rejections alone treats a
// failed request as a win and mutates/removes a row that is unchanged on the
// server. Split ids into genuine successes (fulfilled AND res.ok) vs failures
// so the optimistic update can be scoped to what actually happened.
export async function splitBulkResults(
  ids: string[],
  run: (id: string) => Promise<Response>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const results = await Promise.allSettled(ids.map((id) => run(id)));
  const succeeded: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.ok) succeeded.push(ids[i]);
    else failed.push(ids[i]);
  });
  return { succeeded, failed };
}

/** User-facing copy for a partial bulk failure: names the count and up to
 *  three failing row titles (cheap: resolved from the rows already in local
 *  state) so the user knows exactly which tasks kept their previous state. */
export function bulkFailureMessage(
  verb: string,
  failedIds: string[],
  total: number,
  rows: readonly Pick<BoardItemRow, "id" | "title">[],
): string {
  const titleById = new Map(rows.map((r) => [r.id, r.title]));
  const titles = failedIds
    .map((id) => titleById.get(id))
    .filter((t): t is string => !!t)
    .slice(0, 3);
  const names = titles.length > 0
    ? ` (${titles.map((t) => `"${t}"`).join(", ")}${failedIds.length > titles.length ? `, +${failedIds.length - titles.length} more` : ""})`
    : "";
  return `Couldn't ${verb} ${failedIds.length} of ${total} task${total === 1 ? "" : "s"}${names}. They're unchanged and still selected.`;
}

export interface BoardItemRow {
  id: string;
  title: string;
  status: string | null;
  /** Primary assignee (DRI) — always equals assigneeIds[0]. */
  ownerId: string | null;
  /** Multi-assignee: the full set of assignee user ids (incl. the primary).
   *  Optional so the many hand-built BoardItemRow objects don't all have to set
   *  it; rowFrom() always populates it, so read it as `?? []` when consuming. */
  assigneeIds?: string[];
  groupKey: string | null;
  position: number;
  metadata: Record<string, unknown>;
  /** Phase 58 — first-class date columns. Either may be null. */
  startAt?: Date | string | null;
  dueAt?: Date | string | null;
  /** Task-system phase 2 — first-class priority (URGENT|HIGH|NORMAL|LOW),
   *  null = none. */
  priority?: string | null;
  /** Task Types — the ItemType this row is re-skinned as. null = the
   *  org's default type, resolved at render time. */
  itemTypeId?: string | null;
  /** Task-system phase 2 — workspace Tags applied to this item via
   *  TagAssignment(BOARD_ITEM). Optional: cheaper fetch paths skip it. */
  tags?: ItemTag[];
  /** Phase 67 — counts surfaced by listBoardItems for inline badges
   *  on the Name cell. Optional because cheaper item-fetch paths may
   *  skip the groupBy queries. */
  commentCount?: number;
  attachmentCount?: number;
  /** Fields-panel "Properties" aggregates (surfaced by listBoardItems).
   *  Optional — cheaper item-fetch paths skip the extra groupBy queries. */
  timeTrackedMs?: number;
  linkedDocCount?: number;
  linkedTaskCount?: number;
  linkedSopCount?: number;
  /** Resolved creator (from the CREATED ItemActivity). Mirrors `owner`. */
  createdBy?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  /** Phase 72 — subtask self-relation. null = top-level item. */
  parentItemId?: string | null;
  /** Phase 72 — count of direct children. 0 for leaf items. */
  subtaskCount?: number;
  /** Recurring tasks — the series rule on the anchor task, or null. Set only
   *  on the anchor; spawned copies carry null. */
  recurRule?: RecurrenceRule | null;
  /** When the cron spawns the next copy (anchor only). */
  recurNextAt?: Date | string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Surfaced by GET /api/items/[id] so the drawer can tag attachments
   *  to the right Space (Phase 20). Optional because other surfaces
   *  may pass through a BoardItemRow without including it. */
  spaceId?: string | null;
  /** Parent board id — surfaced by GET /api/items/[id] so the detail
   *  view can list/create subtasks against the board. */
  boardId?: string | null;
  owner?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  /** Resolved assignees (primary first), when the fetch path provides them.
   *  ownerId/owner is always assignees[0]. */
  assignees?: { id: string; firstName: string; lastName: string; avatar: string | null; email?: string | null }[];
}

// ── Owner-only assignee patches (data-loss fix) ────────────────────
//
// A PATCH that carries ownerId and NOT assigneeIds used to run through
// resolveAssignees(undefined, ownerId), which returns [ownerId]. So changing
// the owner from a list row replaced the whole assignee set with one person:
// a task with three assignees silently lost two. This helper is the rule that
// replaces it, and it never drops anyone.
//
//   ownerId = a person → that person is the owner and moves to the FRONT of
//                        the existing set; everybody else keeps their order.
//   ownerId = null     → the CURRENT owner leaves the set and the next
//                        assignee is promoted. The rest survive.
//
// Clearing everyone is still possible, but only through an explicit
// `assigneeIds: []` patch, which says so out loud.
export function applyOwnerOnlyPatch(
  existingAssigneeIds: readonly string[] | null | undefined,
  existingOwnerId: string | null | undefined,
  nextOwnerId: string | null,
): { assigneeIds: string[]; ownerId: string | null } {
  const base = Array.from(
    new Set(
      (existingAssigneeIds ?? []).filter(
        // `.length > 0` let a whitespace-only id through and, under the merge
        // rule below, made it permanent. Nothing that is not a real id may be
        // carried forward.
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      ),
    ),
  );
  // Legacy rows predate assigneeIds, so the stored owner can be missing from
  // the set. Treat it as the first assignee rather than losing it.
  if (existingOwnerId && !base.includes(existingOwnerId)) base.unshift(existingOwnerId);

  if (nextOwnerId === null) {
    // No stored owner means there is nobody to remove; promoting base[0]
    // repairs the row instead of deleting a real assignee.
    const next = existingOwnerId ? base.filter((id) => id !== existingOwnerId) : base;
    return { assigneeIds: next, ownerId: next[0] ?? null };
  }

  const next = [nextOwnerId, ...base.filter((id) => id !== nextOwnerId)];
  return { assigneeIds: next, ownerId: nextOwnerId };
}

/**
 * The assignee set a task should carry after an OFFBOARDING HANDOVER.
 *
 * The handover route used to write `ownerId` alone, which broke the one
 * invariant every other writer holds and applyOwnerOnlyPatch now depends on:
 * `ownerId === assigneeIds[0]`. A row left with the offboarded person still at
 * the front of its assignee set reads as a "legacy row", and the repair runs
 * the wrong way: the next unassign drops the RECIPIENT and promotes the leaver
 * back to owner, silently reverting the handover.
 *
 * So the set is rewritten alongside the owner. The recipient goes to the
 * front, the leaver comes out (they are being offboarded; leaving them on open
 * work is what the handover exists to undo), and every OTHER assignee stays
 * exactly where they were. Nobody who was working on this task loses it.
 */
export function applyHandoverAssignees(
  existingAssigneeIds: readonly string[] | null | undefined,
  leaverId: string,
  recipientId: string,
): string[] {
  const rest = (existingAssigneeIds ?? []).filter(
    (x): x is string =>
      typeof x === "string" && x.trim().length > 0 && x !== leaverId && x !== recipientId,
  );
  return Array.from(new Set([recipientId, ...rest]));
}

/**
 * Normalise an assignee set. Every WRITE path runs through this: create, the
 * multi-picker, /api/items/bulk.
 *
 * The rule: ownerId IS assigneeIds[0], and nobody the caller listed is ever
 * dropped on the way in. An explicit ownerId sent ALONGSIDE assigneeIds used
 * to be ignored whenever the array was non-empty, so
 * `{ assigneeIds: ["b","c"], ownerId: "c" }` answered 200 and quietly made "b"
 * the DRI. /api/items/bulk forwards both fields together, so that shape
 * reaches the writer for real. The named owner moves to the FRONT of the set;
 * if they are not in it they are ADDED, never swapped in for somebody, so no
 * assignee the caller listed is lost either way.
 *
 * Lives here, not in board-items.ts, because it is pure: that module imports
 * the Prisma client, and a unit test importing it through there failed on a
 * clean checkout where src/generated/prisma has not been generated yet.
 */
export function resolveAssignees(
  assigneeIds: string[] | undefined,
  ownerId: string | null | undefined,
): { assigneeIds: string[]; ownerId: string | null } {
  const clean = (xs: string[]) =>
    xs.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  let ids = Array.isArray(assigneeIds) ? clean(assigneeIds) : undefined;
  if (ids === undefined) ids = ownerId ? clean([ownerId]) : [];
  if (ownerId && ids.length > 0) ids = [ownerId, ...ids];
  ids = Array.from(new Set(ids));
  return { assigneeIds: ids, ownerId: ids[0] ?? null };
}
