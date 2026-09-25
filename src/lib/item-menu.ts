// The task "…" menu: ONE ordered list for all three hosts.
//
// spec-task-detail.md section 2 prints the canon once, seventeen rows, and
// says why: the task header menu and the list-row menu were two lists that had
// drifted (the row menu had Open / Open in new tab / Rename / Task type that
// the header did not; the header had Mark complete / Assign to me / Watch /
// Save as template that the row did not). Both lists are now this one list,
// and only THREE rows depend on the host:
//
//   Open              row only (you are already on the task in the other two)
//   Open in new tab   row and drawer (absent on the page, same reason)
//   Rename            focuses the body title in page and drawer, the row's
//                     Name cell in a row, same row, different target
//
// A row the role cannot use is ABSENT, never disabled (access section 5.4).
//
// Phase 5b (tasks in more than one List) adds two rows to the canon: "Add to
// another List…" right after Move, and "Remove from this List" at the head of
// the tail. Inside a List the task is only shown in, Archive is absent and
// Delete reads "Delete everywhere", because that is what it does.
//
// Pure module: no imports, so vitest loads it in the node environment and a
// client component can import it without pulling the server in.

import type { ItemRole } from "./item-role";

export const ITEM_MENU_KEYS = [
  "open",
  "open-new-tab",
  "complete",
  "assign-to-me",
  "rename",
  "copy-link",
  "copy-id",
  "duplicate",
  "move",
  "add-to-list",
  "type",
  "remind",
  "timer",
  "watch",
  "save-template",
  "share",
  "remove-from-list",
  "archive",
  "delete",
] as const;

export type ItemMenuKey = (typeof ITEM_MENU_KEYS)[number];

export type ItemMenuHost = "page" | "drawer" | "row";

export interface ItemMenuRow {
  key: ItemMenuKey;
  label: string;
  /** Destructive rows render in the danger colour. */
  destructive?: boolean;
  /** A separator renders above this row. */
  separatorBefore?: boolean;
  /** The row opens a submenu rather than acting. */
  submenu?: boolean;
}

export interface ItemMenuContext {
  host: ItemMenuHost;
  role: ItemRole;
  /** Is the viewer already an assignee? Hides "Assign to me". */
  isAssignee: boolean;
  /** Is the task in a DONE-group status? Flips Mark complete / Reopen. */
  isDone: boolean;
  /** Is the viewer watching? Flips Watch / Unwatch. */
  isWatching: boolean;
  /** More than one ItemType in the org? Otherwise the Type row is noise. */
  hasItemTypes: boolean;
  /** The Space's Time tracking module. */
  timeTrackingOn: boolean;
  /** Is a timer running on this task? Flips Start / Stop. */
  timerRunning: boolean;
  /** A Personal List task has no Space and nothing to share. */
  personalList: boolean;
  /** Does the viewer hold Can edit on any OTHER List? Move needs a target. */
  canMoveElsewhere: boolean;
  /** Rule 9 assignee with no role on the List: no Move, no Share. */
  assigneeOnly: boolean;
  /** access section 9 `tasks.delete`: the creator, or Full access. */
  isCreator: boolean;
  /** An Agent never deletes, and never saves a template it cannot own. */
  isAgent: boolean;
  /** Guests never reach Templates (access section 3.3). */
  isGuest: boolean;
  /** An archived task is capped at Can view unless the viewer is Full. */
  archived: boolean;
  // Phase 5b, tasks in more than one List. Every one of these is optional and
  // absent means exactly the rows above, so a host that knows nothing about
  // links renders today's menu.
  /** May this task be added to another List from here (contribute on its home)? */
  canAddToList?: boolean;
  /** The menu is open in a List the task is shown in through a link. */
  inSecondaryList?: boolean;
  /** Contribute on that List or on the home: the server's removal rule. */
  canRemoveFromList?: boolean;
  /** A subtask shown through its linked parent: never removed, moved or linked alone. */
  linkedSubtask?: boolean;
}

function rank(role: ItemRole): number {
  switch (role) {
    case "FULL": return 4;
    case "EDIT": return 3;
    case "COMMENT": return 2;
    case "VIEW": return 1;
    default: return 0;
  }
}

/**
 * The rows this viewer gets, in the canon order, with separators placed.
 *
 * Returns an empty list when the viewer holds no role at all, because a menu
 * on a task nobody may read is a menu that should not have been rendered.
 */
export function buildItemMenu(ctx: ItemMenuContext): ItemMenuRow[] {
  const r = rank(ctx.role);
  if (r === 0) return [];
  const canView = r >= 1;
  const canEdit = r >= 3;
  const isFull = r >= 4;
  const rows: ItemMenuRow[] = [];

  if (ctx.host === "row" && canView) rows.push({ key: "open", label: "Open" });
  if (ctx.host !== "page" && canView) rows.push({ key: "open-new-tab", label: "Open in new tab" });
  if (canEdit) rows.push({ key: "complete", label: ctx.isDone ? "Reopen" : "Mark complete" });
  if (canEdit && !ctx.isAssignee) rows.push({ key: "assign-to-me", label: "Assign to me" });
  if (canEdit) rows.push({ key: "rename", label: "Rename" });
  if (canView) rows.push({ key: "copy-link", label: "Copy link" });
  if (canView) rows.push({ key: "copy-id", label: "Copy task ID" });
  if (canEdit) rows.push({ key: "duplicate", label: "Duplicate" });
  // In a List the task only appears in, Move moves the LINK (the host passes
  // its link-move flag as canMoveElsewhere), and a subtask shown through its
  // parent has no link of its own to move.
  if (canEdit && !ctx.assigneeOnly && ctx.canMoveElsewhere && !ctx.linkedSubtask) rows.push({ key: "move", label: "Move to list…" });
  if (canEdit && ctx.canAddToList && !ctx.assigneeOnly && !ctx.personalList && !ctx.linkedSubtask) {
    rows.push({ key: "add-to-list", label: "Add to another List…" });
  }
  if (canEdit && ctx.hasItemTypes) rows.push({ key: "type", label: "Task type", submenu: true });
  // A reminder is personal, so Can view is enough to set one.
  if (canView) rows.push({ key: "remind", label: "Set reminder", submenu: true });
  if (canEdit && ctx.timeTrackingOn) rows.push({ key: "timer", label: ctx.timerRunning ? "Stop timer" : "Start timer" });
  if (canView) rows.push({ key: "watch", label: ctx.isWatching ? "Unwatch" : "Watch" });
  // Templates are a Can-edit thing and a Member thing: section 1's Can view
  // row lists "templates" among what it never renders, and row 14 of the canon
  // is Members-only (access section 3.3).
  if (canEdit && !ctx.isGuest) rows.push({ key: "save-template", label: "Save as template" });
  if (!ctx.personalList && !ctx.assigneeOnly && !ctx.isGuest) {
    rows.push({ key: "share", label: isFull || canEdit ? "Share" : "Who has access" });
  }

  const tail: ItemMenuRow[] = [];
  // Taking the task out of THIS List is the link's own rule (contribute on
  // this List or on the home), not a task role, so a reader who may remove it
  // gets the row whatever they may do to the task itself.
  if (ctx.inSecondaryList && ctx.canRemoveFromList && !ctx.linkedSubtask) {
    tail.push({ key: "remove-from-list", label: "Remove from this List" });
  }
  // An archived task caps everyone below Full at Can view, so Archive is gone
  // and Delete stays only for the people rule 12 does not cap. Inside a List
  // the task is only shown in, Archive is absent: archiving hides it from its
  // home and every other List, which is not what a click here should mean.
  if (canEdit && !ctx.archived && !ctx.inSecondaryList) tail.push({ key: "archive", label: "Archive" });
  // access section 9 tasks.delete: creator with Can edit, or Full access;
  // never an Agent. From a secondary List it says what it does: everywhere.
  if (!ctx.isAgent && (isFull || (canEdit && ctx.isCreator))) {
    tail.push({ key: "delete", label: ctx.inSecondaryList ? "Delete everywhere" : "Delete", destructive: true });
  }
  if (tail.length) {
    tail[0] = { ...tail[0], separatorBefore: rows.length > 0 };
    rows.push(...tail);
  }
  return rows;
}
