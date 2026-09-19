// The ONE way anything in this product creates "a task for a person".
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 4 (W4) and
// scripts/MIGRATIONS.md section 4.
//
// WHY THIS FILE EXISTS. Phase 2 W4 moved every row of the legacy `Task` table
// onto `Item` and deleted the seven pages that were the only UI over `Task`.
// The migration (scripts/migrate-legacy-tasks.ts) is a one-shot script the
// founder runs, so it can only move rows that exist when it runs. Eight
// server-side code paths still called `prisma.task.create` after it, and every
// row they wrote from that moment on was content the product had no surface
// for: not on My work, not on the Personal list, not on the ICS feed, not on
// the Planner calendar, not openable at /item/<id>, and not forwarded by
// /tasks/<id> because no `LegacyRedirect` row is ever written for it. It was
// user work that reported success and then disappeared.
//
// Every one of those callers meant the same thing: "put a task on this
// person's own list". That is exactly the destination the migration chose, so
// this helper writes what the migration writes, which keeps the two halves of
// the move telling the same story.
//
// WHAT IT DOES NOT COVER. src/services/googleCalendarSync.ts still writes
// `Task` rows on purpose. Those are not authored work: they are a local mirror
// of somebody's Google Calendar, keyed on `externalId`, updated and deleted by
// the same service as the remote calendar changes, and the ICS feed
// deliberately skips them (they are already on the subscriber's calendar,
// coming from Google). Turning that mirror into Items is the Planner unit's
// call, not a side effect of this one. scripts/MIGRATIONS.md section 4 records
// this as the one surviving writer and why.

import { prisma } from "@/lib/prisma";
import { getOrCreatePersonalBoard } from "@/lib/board";
import { createBoardItem } from "@/lib/board-items";
import { getBoardStatuses } from "@/lib/board-items-shared";

export interface PersonalTaskInput {
  organizationId: string;
  /** The person the task is FOR. Their Personal list is the destination. */
  assigneeId: string;
  title: string;
  description?: string | null;
  /** The day the work is due. The legacy `Task.date` column mapped here. */
  dueAt?: Date | string | null;
  startAt?: Date | string | null;
  /** URGENT | HIGH | NORMAL | LOW, case-insensitive; anything else = NORMAL. */
  priority?: string | null;
  /**
   * The legacy columns that have no first-class home on `Item`, kept verbatim
   * under `metadata.legacyTask` — the SAME bag, with the same name, that
   * scripts/migrate-legacy-tasks.ts writes for a migrated row, so a task made
   * by an integration today and one migrated from 2024 read identically.
   * Keys with a null or undefined value are dropped rather than stored.
   */
  legacy?: Record<string, unknown>;
  /** Written to the activity feed. Null for genuinely system-made rows. */
  actorId?: string | null;
}

export interface PersonalTaskResult {
  /** The Item id. This is what /item/<id> opens. */
  id: string;
  boardId: string;
  title: string;
  status: string | null;
  dueAt: Date | null;
  priority: string | null;
  assigneeId: string;
}

/**
 * The first status in the destination List's own set that is not a done or
 * cancelled column, so a brand-new task never lands in "Shipped".
 *
 * A List whose owner deleted every ACTIVE status falls back to the set's first
 * entry, and a List with no set at all falls back to `createBoardItem`'s own
 * default. Both are better than inventing a status value the List does not
 * have, which is what puts a row in the board view's "Unset" column for ever.
 */
function openingStatus(board: { statuses?: unknown } | null): string | undefined {
  const statuses = getBoardStatuses(board);
  if (statuses.length === 0) return undefined;
  return (statuses.find((s) => s.group === "ACTIVE") ?? statuses[0]).value;
}

/** Drop null and undefined so an empty bag is never stored as `legacyTask: {}`. */
function compact(bag: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!bag) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Create a task on a person's Personal list and return it.
 *
 * Throws when the assignee is not in the organization, which is the one thing
 * every caller already checked for itself and the one thing that must never be
 * guessed at: a task written into the wrong org is a data leak, not a bug.
 */
export async function createPersonalTask(input: PersonalTaskInput): Promise<PersonalTaskResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  const assignee = await prisma.user.findFirst({
    where: { id: input.assigneeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!assignee) throw new Error("Assignee is not in this organization");

  const board = await getOrCreatePersonalBoard(input.organizationId, input.assigneeId);

  const metadata: Record<string, unknown> = {};
  // `metadata.description` is where the task body lives on an Item
  // (spec-task-detail section 3). The legacy column was `Task.description`.
  if (input.description) metadata.description = input.description;
  const legacy = compact(input.legacy);
  if (Object.keys(legacy).length > 0) metadata.legacyTask = legacy;

  const created = await createBoardItem({
    organizationId: input.organizationId,
    boardId: board.id,
    title: title.slice(0, 280),
    status: openingStatus(board),
    ownerId: input.assigneeId,
    assigneeIds: [input.assigneeId],
    dueAt: input.dueAt ?? null,
    startAt: input.startAt ?? null,
    priority: input.priority ?? null,
    metadata,
    actorId: input.actorId ?? null,
  });

  return {
    id: created.id,
    boardId: board.id,
    title: created.title,
    status: created.status ?? null,
    dueAt: created.dueAt ? new Date(created.dueAt) : null,
    priority: created.priority ?? null,
    assigneeId: input.assigneeId,
  };
}
