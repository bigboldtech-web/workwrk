// legacy-task-map.ts: the pure mapping from the legacy `Task` world onto the
// `Item` world, and from the legacy `Idea` world onto the seeded Ideas list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 4, W4 and W5.
//
// WHY IT IS A SEPARATE FILE. The two migration scripts and the `/tasks/[id]`
// resolver all have to agree about what a legacy row becomes. A mapping that
// lives inside a script is a mapping nobody can test and nobody can read back
// when a row looks wrong six months later. Everything here is pure: no Prisma,
// no dates from `new Date()`, no environment. The scripts supply the rows.
//
// TOTALITY. Every function returns a value for every input, including inputs
// the enums do not have today. A migration that throws on an unexpected string
// has turned somebody's task into an error; a migration that maps it to a
// named fallback AND reports it is one a person can act on.

import type { StatusOption } from "../board-items-shared";

// ── Status ─────────────────────────────────────────────────────────

/** The three members of the legacy `TaskStatus` enum, plus whatever else a row carries. */
export type LegacyTaskStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | (string & {});

export interface StatusMapping {
  /** The status value to write on the Item. Never null: the fallback is the
   *  first status the List has, and a List always has at least one. */
  value: string;
  /** True when the mapping landed on a status whose group is DONE, which is
   *  what makes the script stamp `completedAt` into the Item's metadata. */
  done: boolean;
  /** Set when the legacy value was not one this table knows. The row still
   *  migrates; the dry-run report names it so a person can decide. */
  unmapped?: boolean;
}

/** Words that mean "work is under way", in the order we would rather match them. */
const PROGRESS_WORDS = ["progress", "doing", "active", "started", "working", "review"];

/**
 * Map a legacy task status onto one of the destination List's own statuses.
 *
 * The rule is spec-work-home W4, by NAME and by GROUP rather than by string
 * equality, because the destination List is a Personal list whose status set
 * its owner may have renamed:
 *
 *   PLANNED      -> the List's first ACTIVE status
 *   IN_PROGRESS  -> the List's first ACTIVE status whose value or label reads
 *                   as progress; else the SECOND active status; else the first
 *   COMPLETED    -> the List's first DONE status; else its first CLOSED one;
 *                   else (a List with no terminal status at all) the last one
 *
 * `statuses` must be non-empty. Callers get it from `getBoardStatuses`, which
 * falls back to the canonical default trio, so it never is.
 */
export function mapLegacyStatus(
  status: LegacyTaskStatus | null | undefined,
  statuses: readonly StatusOption[],
): StatusMapping {
  if (statuses.length === 0) {
    // Defensive only: getBoardStatuses cannot return an empty set. Returning a
    // value rather than throwing keeps a malformed Board.statuses blob from
    // aborting an org's whole migration.
    return { value: "TO_DO", done: false, unmapped: true };
  }
  const active = statuses.filter((s) => s.group === "ACTIVE");
  const done = statuses.filter((s) => s.group === "DONE");
  const closed = statuses.filter((s) => s.group === "CLOSED");
  const firstActive = active[0] ?? statuses[0];

  const raw = (status ?? "").trim().toUpperCase();

  if (raw === "COMPLETED" || raw === "DONE" || raw === "COMPLETE") {
    const target = done[0] ?? closed[0] ?? statuses[statuses.length - 1];
    return { value: target.value, done: target.group !== "ACTIVE" };
  }

  if (raw === "IN_PROGRESS" || raw === "IN PROGRESS" || raw === "INPROGRESS") {
    const byWord = active.find((s) => readsAsProgress(s));
    const target = byWord ?? active[1] ?? firstActive;
    return { value: target.value, done: false };
  }

  if (raw === "PLANNED" || raw === "TODO" || raw === "TO_DO" || raw === "TO DO") {
    return { value: firstActive.value, done: firstActive.group !== "ACTIVE" };
  }

  // Anything else: the row keeps moving, onto the first active status, and the
  // report names the value so somebody can look at it. An ABSENT status is not
  // an unmapped one, so the key is only present when there was a value nobody
  // could place.
  return raw.length > 0
    ? { value: firstActive.value, done: false, unmapped: true }
    : { value: firstActive.value, done: false };
}

function readsAsProgress(s: StatusOption): boolean {
  const hay = `${s.value} ${s.label}`.toLowerCase();
  return PROGRESS_WORDS.some((w) => hay.includes(w));
}

// ── Priority ───────────────────────────────────────────────────────

/** The `Item.priority` vocabulary (src/lib/board-items-shared.ts PRIORITY_OPTIONS). */
export type ItemPriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

/**
 * Map a legacy priority onto the Item vocabulary.
 *
 * The live `TaskPriority` enum is already LOW | NORMAL | HIGH | URGENT, so most
 * rows are a pass-through. The spec names "Critical" and "Medium" as well,
 * which were the labels an earlier iteration of the task UI printed; rows that
 * carry those strings (an import, a seeded row, a restored backup) map the way
 * the spec says rather than falling through to null.
 *
 * Returns null for a missing or unreadable value, which is the Item default
 * ("no priority"), not an error.
 */
export function mapLegacyPriority(priority: string | null | undefined): ItemPriority | null {
  const raw = (priority ?? "").trim().toUpperCase();
  if (!raw) return null;
  switch (raw) {
    case "URGENT":
    case "CRITICAL":
    case "P0":
      return "URGENT";
    case "HIGH":
    case "P1":
      return "HIGH";
    case "NORMAL":
    case "MEDIUM":
    case "P2":
      return "NORMAL";
    case "LOW":
    case "P3":
      return "LOW";
    default:
      return null;
  }
}

// ── Dates ──────────────────────────────────────────────────────────

export interface LegacyDates {
  date: Date | null;
  startAt: Date | null;
  endAt: Date | null;
}

/**
 * Resolve the three legacy date columns into the Item's two.
 *
 * The legacy model carried `date` (a day-level anchor), `startAt` and `endAt`.
 * Item carries `startAt` and `dueAt`. The rule keeps every timestamp a person
 * set and never invents one:
 *
 *   dueAt   = endAt, else date, else startAt's day (a task that starts and has
 *             no end is due when it starts), else null
 *   startAt = startAt, else null. `date` is NOT copied into startAt: it was a
 *             deadline anchor on every surface that read it, so copying it into
 *             the start would turn every dated legacy task into a same-day span
 *             that renders as a bar on the Gantt where there was a point.
 */
export function mapLegacyDates(t: LegacyDates): { startAt: Date | null; dueAt: Date | null } {
  const dueAt = t.endAt ?? t.date ?? t.startAt ?? null;
  return { startAt: t.startAt ?? null, dueAt };
}

// ── Ideas ──────────────────────────────────────────────────────────

/** The six members of the legacy `IdeaStatus` enum. */
export type LegacyIdeaStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "IMPLEMENTED"
  | "REWARDED"
  | (string & {});

/**
 * The Ideas list's status values are the enum's own names (prisma/seed-templates.ts
 * IDEAS), so this is an identity map with a named fallback rather than a table
 * of translations. It is still a function and still tested, because the seeded
 * template and the enum are two files that can drift apart, and the day they do
 * this is where the drift is caught.
 */
export function mapIdeaStatus(
  status: LegacyIdeaStatus | null | undefined,
  statuses: readonly StatusOption[],
): StatusMapping {
  const raw = (status ?? "").trim().toUpperCase();
  const hit = statuses.find((s) => s.value.toUpperCase() === raw);
  if (hit) return { value: hit.value, done: hit.group !== "ACTIVE" };
  const first = statuses[0];
  if (!first) return { value: "SUBMITTED", done: false, unmapped: true };
  const fallback = { value: first.value, done: first.group !== "ACTIVE" };
  return raw.length > 0 ? { ...fallback, unmapped: true } : fallback;
}

// ── Where a legacy row lands ───────────────────────────────────────

/**
 * Which person's Personal list a legacy task belongs in.
 *
 * spec-work-home W4: the assignee's, else the creator's, else the org's first
 * Owner's. `assigneeId` is non-null in the schema, so the second and third arms
 * exist for rows whose assignee has since been deleted from the org, which the
 * script detects by resolving the id against live members before calling this.
 *
 * Returns null only when the org has no live member at all, in which case the
 * row is reported as unresolved and nothing is written for it.
 */
export function resolveLegacyOwner(input: {
  assigneeId: string | null;
  createdById: string | null;
  liveUserIds: ReadonlySet<string>;
  fallbackOwnerId: string | null;
}): { userId: string | null; via: "assignee" | "creator" | "org-owner" | "none" } {
  if (input.assigneeId && input.liveUserIds.has(input.assigneeId)) {
    return { userId: input.assigneeId, via: "assignee" };
  }
  if (input.createdById && input.liveUserIds.has(input.createdById)) {
    return { userId: input.createdById, via: "creator" };
  }
  if (input.fallbackOwnerId && input.liveUserIds.has(input.fallbackOwnerId)) {
    return { userId: input.fallbackOwnerId, via: "org-owner" };
  }
  return { userId: null, via: "none" };
}

// ── The forwarding address ─────────────────────────────────────────

/** The `LegacyRedirect.kind` values these two migrations write. */
export const LEGACY_REDIRECT_KINDS = {
  task: "task",
  taskComment: "task_comment",
  idea: "idea",
  // Per-comment marker for the Ideas migration, the twin of `taskComment`.
  // Without it an idea's comments have no idempotence key of their own: a
  // comment written after that idea migrated (and /ideas stays live and
  // writable until the production run, so this is the normal case rather than
  // a corner) would be counted as already moved and never written.
  ideaComment: "idea_comment",
} as const;

/** Where a migrated row now lives, as an in-app path. */
export function legacyTarget(itemId: string): string {
  return `/item/${itemId}`;
}
