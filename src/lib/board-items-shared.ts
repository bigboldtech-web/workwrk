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

export const DEFAULT_STATUS_OPTIONS: readonly StatusOption[] = [
  { value: "TO_DO",       label: "To Do",        color: "#94a3b8", group: "ACTIVE" },
  { value: "IN_PROGRESS", label: "In Progress",  color: "#3b82f6", group: "ACTIVE" },
  { value: "DONE",        label: "Done",         color: "#10b981", group: "DONE" },
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

/** Completion check driven by the status group — replaces hardcoded
 *  `status === "DONE"` comparisons. Unknown/unset statuses count as
 *  open so stale rows never silently drop out of overdue logic. */
export function isDoneStatus(statuses: readonly StatusOption[], value: string | null | undefined): boolean {
  if (!value) return false;
  const opt = statuses.find((o) => o.value === value);
  return opt ? opt.group !== "ACTIVE" : false;
}

// Task-system phase 2 — first-class priority. Order matters: it's the
// URGENT→LOW display + group-by bucket order (ClickUp flag palette).
export const PRIORITY_OPTIONS = [
  { value: "URGENT", label: "Urgent", color: "#ef4444" },
  { value: "HIGH",   label: "High",   color: "#f59e0b" },
  { value: "NORMAL", label: "Normal", color: "#3b82f6" },
  { value: "LOW",    label: "Low",    color: "#9ca3af" },
] as const;

export type PriorityValue = (typeof PRIORITY_OPTIONS)[number]["value"];

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

export interface BoardItemRow {
  id: string;
  title: string;
  status: string | null;
  ownerId: string | null;
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
}
