// Task activity: the action vocabulary and the `?kind=` filter, pure.
//
// spec-task-detail.md section 4 step 1 asks board-items.ts to log
// ASSIGNEES_CHANGED, DUE_CHANGED, START_CHANGED, TAGS_CHANGED, TYPE_CHANGED,
// SUBTASK_ADDED, ATTACHMENT_ADDED / REMOVED, LINK_ADDED / REMOVED, RECUR_SET /
// RECUR_CLEARED, MOVED and RESTORED beside the seven it already writes, and
// GET /api/items/[id]/activity to accept
// `?kind=status|assignees|dates|fields|comments|attachments`.
//
// Two rules this file exists to hold:
//
//   TOTALITY. Every action name maps to exactly one kind, and a name this
//   table has never seen falls into "lifecycle" rather than vanishing. An
//   activity row that no filter can reach is a row the Activity tab silently
//   loses, which is the same class of bug as the Inbox's grey-Bell fallback.
//
//   NO GLYPH COPY. The renderer says "from A to B", never the "→" character
//   (critic #15), so nothing here carries display strings at all: a kind is a
//   filter key, and the words live in the component.
//
// Pure module: no imports, so vitest loads it in the node environment.

/** Every `ItemActivity.action` this product writes for a task. */
export const ITEM_ACTIVITY_ACTIONS = [
  // The seven that were already live at Phase 2.
  "CREATED",
  "TITLE_CHANGED",
  "STATUS_CHANGED",
  "OWNER_CHANGED",
  "PRIORITY_CHANGED",
  "FIELDS_UPDATED",
  "ARCHIVED",
  "COMMENTED",
  // Added by this phase.
  "ASSIGNEES_CHANGED",
  "DUE_CHANGED",
  "START_CHANGED",
  "TAGS_CHANGED",
  "TYPE_CHANGED",
  "SUBTASK_ADDED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_REMOVED",
  "LINK_ADDED",
  "LINK_REMOVED",
  "RECUR_SET",
  "RECUR_CLEARED",
  "MOVED",
  "RESTORED",
] as const;

export type ItemActivityAction = (typeof ITEM_ACTIVITY_ACTIONS)[number];

/**
 * The filter keys. The first six are the spec's; `lifecycle` is the seventh
 * that makes the map total (created, archived, restored, moved, subtask added
 * are real rows and belong to a bucket a reader can name).
 */
export const ITEM_ACTIVITY_KINDS = [
  "status",
  "assignees",
  "dates",
  "fields",
  "comments",
  "attachments",
  "lifecycle",
] as const;

export type ItemActivityKind = (typeof ITEM_ACTIVITY_KINDS)[number];

const ACTION_KIND: Readonly<Record<ItemActivityAction, ItemActivityKind>> = {
  STATUS_CHANGED: "status",

  OWNER_CHANGED: "assignees",
  ASSIGNEES_CHANGED: "assignees",

  DUE_CHANGED: "dates",
  START_CHANGED: "dates",
  RECUR_SET: "dates",
  RECUR_CLEARED: "dates",

  TITLE_CHANGED: "fields",
  PRIORITY_CHANGED: "fields",
  TAGS_CHANGED: "fields",
  TYPE_CHANGED: "fields",
  FIELDS_UPDATED: "fields",

  COMMENTED: "comments",

  ATTACHMENT_ADDED: "attachments",
  ATTACHMENT_REMOVED: "attachments",
  LINK_ADDED: "attachments",
  LINK_REMOVED: "attachments",

  CREATED: "lifecycle",
  ARCHIVED: "lifecycle",
  RESTORED: "lifecycle",
  MOVED: "lifecycle",
  SUBTASK_ADDED: "lifecycle",
};

const KIND_SET: ReadonlySet<string> = new Set(ITEM_ACTIVITY_KINDS);

/** Is this a filter key the API accepts? */
export function isItemActivityKind(value: unknown): value is ItemActivityKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/**
 * The kind of one stored action. Total by construction: an action written by
 * an older release, an automation or a future phase reads as `lifecycle`
 * rather than disappearing from every filter.
 */
export function kindOfAction(action: string): ItemActivityKind {
  return ACTION_KIND[action as ItemActivityAction] ?? "lifecycle";
}

/** Every action name that belongs to a kind, for the API's `action IN (...)`. */
export function actionsForKind(kind: ItemActivityKind): ItemActivityAction[] {
  return ITEM_ACTIVITY_ACTIONS.filter((a) => ACTION_KIND[a] === kind);
}

/**
 * The database predicate for one `?kind=`, which is what actually keeps the
 * TOTALITY rule at the top of this file true.
 *
 * `kindOfAction` sends an action this table has never seen to "lifecycle", but
 * an `action IN (the five hard-coded lifecycle names)` filter cannot return
 * it — so a row written by an older release or an automation was reachable by
 * NO filter, which is the silent loss this module exists to prevent.
 * "lifecycle" is therefore the COMPLEMENT of the six named kinds, exactly the
 * way `kindOfAction` defines it, and not a list of its own.
 */
export function activityActionFilter(
  kind: ItemActivityKind,
): { in: string[] } | { notIn: string[] } {
  if (kind !== "lifecycle") return { in: actionsForKind(kind) };
  return { notIn: ITEM_ACTIVITY_ACTIONS.filter((a) => ACTION_KIND[a] !== "lifecycle") };
}

/**
 * Parse the `?kind=` query value. An unknown or absent value means "no
 * filter", never an error: an activity tab that 400s on a stale bookmark is
 * worse than one that shows everything.
 */
export function parseActivityKind(raw: string | null | undefined): ItemActivityKind | null {
  return isItemActivityKind(raw) ? raw : null;
}
