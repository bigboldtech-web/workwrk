// The words for one task-activity row, in ONE place.
//
// Two components render the same log — the Activity tab inside the task drawer
// (item-thread.tsx) and the standalone Activity drawer (item-activity-drawer.tsx)
// — and both ended in `default: return a.action.toLowerCase().replace(/_/g," ")`.
// Every action added after they were written therefore printed as a snake_case
// fragment with no from/to: "start changed", "due changed", "assignees changed".
// That is the same class of bug as the Inbox's grey-Bell fallback, and the way
// out is the same: one total table, and a completeness test over
// ITEM_ACTIVITY_ACTIONS so a new action cannot ship without its sentence.
//
// RULES
//
//   TOTALITY. Every name in ITEM_ACTIVITY_ACTIONS has a case here, asserted by
//   item-activity-describe.test.ts. The fallback still exists (a row written by
//   an older release or an automation must render as something) but it is now a
//   floor nothing in this product reaches, not the common path.
//
//   NO GLYPH COPY. "from A to B", never the arrow character
//   (docs/plans/ui-refresh/spec-task-detail.md). Renderers used to print "→"
//   which screen readers say nothing useful about.
//
//   NO FABRICATION. When meta does not carry a name, the sentence says what it
//   knows and stops. It never invents a person, a count or a date.
//
// Pure module: no imports beyond the action vocabulary, so both a client
// component and vitest's node environment can load it.

import { ITEM_ACTIVITY_ACTIONS, type ItemActivityAction } from "./item-activity-kinds";

export interface ActivityDescribeInput {
  action: string;
  meta?: Record<string, unknown> | null;
}

export interface ActivityDescribeOptions {
  /** Status value to its per-List label ("IN_PROGRESS" to "In progress"). */
  statusLabel?: (value: string) => string;
  /** User id to a display name. Returning null means "not resolvable". */
  personName?: (id: string) => string | null;
  /** Absolute instant to the reader's short date. */
  dateLabel?: (iso: string) => string;
}

const EMPTY = "nothing";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** "Ada", "Ada and Grace", "Ada, Grace and 2 others". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} ${names.length - 2 === 1 ? "other" : "others"}`;
}

/** Ids to names, dropping the ones that will not resolve. */
function peopleOf(ids: string[], opts: ActivityDescribeOptions): string {
  const named = ids.map((id) => opts.personName?.(id) ?? null).filter((n): n is string => !!n);
  // Some resolved, some not: name the ones we know and count the rest rather
  // than printing a raw cuid at a person.
  if (named.length === 0) return ids.length === 1 ? "someone" : `${ids.length} people`;
  if (named.length === ids.length) return joinNames(named);
  return `${joinNames(named)} and ${ids.length - named.length} more`;
}

function dateOf(v: unknown, opts: ActivityDescribeOptions): string {
  const iso = str(v);
  if (!iso) return EMPTY;
  return opts.dateLabel?.(iso) ?? iso.slice(0, 10);
}

function statusOf(v: unknown, opts: ActivityDescribeOptions): string {
  const value = str(v);
  if (!value) return EMPTY;
  return opts.statusLabel?.(value) ?? value;
}

/**
 * One activity row as a sentence, with the actor's name supplied separately by
 * the caller ("Ada " + this).
 */
export function describeItemActivity(
  row: ActivityDescribeInput,
  opts: ActivityDescribeOptions = {},
): string {
  const meta = row.meta ?? {};
  switch (row.action as ItemActivityAction) {
    case "CREATED":
      return "created this task";
    case "TITLE_CHANGED": {
      const from = str(meta.from);
      const to = str(meta.to);
      if (from && to) return `renamed it from "${from}" to "${to}"`;
      return to ? `renamed it to "${to}"` : "renamed it";
    }
    case "STATUS_CHANGED":
      return `changed status from ${statusOf(meta.from, opts)} to ${statusOf(meta.to, opts)}`;
    case "OWNER_CHANGED": {
      const to = str(meta.to);
      if (!to) return "cleared the assignee";
      return `made ${peopleOf([to], opts)} the assignee`;
    }
    case "PRIORITY_CHANGED": {
      const from = str(meta.from) ?? EMPTY;
      const to = str(meta.to) ?? EMPTY;
      return `changed priority from ${from.toLowerCase()} to ${to.toLowerCase()}`;
    }
    case "ASSIGNEES_CHANGED": {
      const added = strList(meta.added);
      const removed = strList(meta.removed);
      const parts: string[] = [];
      if (added.length) parts.push(`added ${peopleOf(added, opts)}`);
      if (removed.length) parts.push(`removed ${peopleOf(removed, opts)}`);
      if (parts.length === 0) return "changed the assignees";
      return `${parts.join(" and ")} ${added.length + removed.length === 1 ? "as an assignee" : "as assignees"}`;
    }
    case "DUE_CHANGED": {
      const from = dateOf(meta.from, opts);
      const to = dateOf(meta.to, opts);
      if (to === EMPTY) return "cleared the due date";
      if (from === EMPTY) return `set the due date to ${to}`;
      return `changed the due date from ${from} to ${to}`;
    }
    case "START_CHANGED": {
      const from = dateOf(meta.from, opts);
      const to = dateOf(meta.to, opts);
      if (to === EMPTY) return "cleared the start date";
      if (from === EMPTY) return `set the start date to ${to}`;
      return `changed the start date from ${from} to ${to}`;
    }
    case "TAGS_CHANGED": {
      const to = strList(meta.to);
      if (to.length === 0) return "removed every tag";
      return `set the tags to ${to.join(", ")}`;
    }
    case "TYPE_CHANGED": {
      const to = str(meta.to);
      return to ? "changed the task type" : "cleared the task type";
    }
    case "FIELDS_UPDATED": {
      const fields = strList(meta.fields);
      if (fields.length === 0) return "updated fields";
      return `updated ${joinNames(fields)}`;
    }
    case "SUBTASK_ADDED": {
      const title = str(meta.title);
      return title ? `added the subtask "${title}"` : "added a subtask";
    }
    case "ATTACHMENT_ADDED":
      return "attached a file";
    case "ATTACHMENT_REMOVED":
      return "removed an attached file";
    case "LINK_ADDED":
      return "linked something to this task";
    case "LINK_REMOVED":
      return "removed a link from this task";
    case "RECUR_SET":
      return "turned on repeat";
    case "RECUR_CLEARED":
      return "turned off repeat";
    case "MOVED": {
      const moved = typeof meta.subtasksMoved === "number" ? meta.subtasksMoved : 0;
      const tail = moved > 0 ? ` with ${moved} ${moved === 1 ? "subtask" : "subtasks"}` : "";
      const fromStatus = str(meta.fromStatus);
      const toStatus = str(meta.toStatus);
      const restatus =
        fromStatus && toStatus && fromStatus !== toStatus
          ? `, status ${statusOf(fromStatus, opts)} to ${statusOf(toStatus, opts)}`
          : "";
      return `moved this task to another List${tail}${restatus}`;
    }
    case "COMMENTED":
      return "commented";
    case "ARCHIVED":
      return "archived this task";
    case "RESTORED":
      return "restored this task";
    default:
      // Not reachable for anything this product writes (the completeness test
      // holds that), but a row from an older release or an automation must
      // still read as words.
      return row.action.toLowerCase().replace(/_/g, " ");
  }
}

/** Exported for the completeness test only. */
export const DESCRIBED_ACTIONS: readonly string[] = ITEM_ACTIVITY_ACTIONS;
