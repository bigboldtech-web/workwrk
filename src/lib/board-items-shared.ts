// Client-safe slice of board-items — types + constants only.
// Anything imported by a "use client" component MUST live here (or in
// another no-server-deps module), not in `board-items.ts`, because
// board-items.ts pulls in Prisma + pg + node:fs/net/tls/dns which
// can't bundle for the browser.
//
// The server-side helpers (createBoardItem, updateBoardItem, etc.)
// stay in board-items.ts and continue to import this file for the
// shared types so the API surface stays unified.

export const DEFAULT_STATUS_OPTIONS = [
  { value: "TO_DO",       label: "To Do",        color: "#94a3b8" },
  { value: "IN_PROGRESS", label: "In Progress",  color: "#3b82f6" },
  { value: "DONE",        label: "Done",         color: "#10b981" },
] as const;

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
export const STATUS_LOOKUP: Record<string, { value: string; label: string; color: string }> =
  Object.fromEntries(DEFAULT_STATUS_OPTIONS.map((o) => [o.value, o]));
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
  /** Task-system phase 2 — workspace Tags applied to this item via
   *  TagAssignment(BOARD_ITEM). Optional: cheaper fetch paths skip it. */
  tags?: ItemTag[];
  /** Phase 67 — counts surfaced by listBoardItems for inline badges
   *  on the Name cell. Optional because cheaper item-fetch paths may
   *  skip the groupBy queries. */
  commentCount?: number;
  attachmentCount?: number;
  /** Phase 72 — subtask self-relation. null = top-level item. */
  parentItemId?: string | null;
  /** Phase 72 — count of direct children. 0 for leaf items. */
  subtaskCount?: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Surfaced by GET /api/items/[id] so the drawer can tag attachments
   *  to the right Space (Phase 20). Optional because other surfaces
   *  may pass through a BoardItemRow without including it. */
  spaceId?: string | null;
  owner?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
}
