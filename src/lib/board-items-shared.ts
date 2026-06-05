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
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Surfaced by GET /api/items/[id] so the drawer can tag attachments
   *  to the right Space (Phase 20). Optional because other surfaces
   *  may pass through a BoardItemRow without including it. */
  spaceId?: string | null;
  owner?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
}
