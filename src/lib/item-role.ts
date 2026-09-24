// The task's role ladder and denial contract, pure.
//
// spec-task-detail.md section 1 (Access) resolves a task with no grants of its
// own through four signals, and this file is the whole of that resolution with
// none of the database in it:
//
//   rule 4  org Owner and Admin           -> FULL
//   rule 5  the creator                   -> FULL
//   rule 9  any assignee                  -> EDIT (assignment grants access)
//   rule 10 inheritance from the List     -> whatever the List gives
//   rule 12 caps                          -> Guest at most EDIT; an ARCHIVED
//                                            task at most VIEW unless FULL;
//                                            an Agent never `delete`
//
// The two denial rules that matter, because getting them backwards is how a
// product tells strangers which ids exist:
//
//   A task is NEVER DISCOVERABLE (access rule 14 grants discoverability to a
//   findable Space, to a container the viewer holds a role inside, and to the
//   List that holds a task assigned to the viewer — an Item is none of those).
//   So "no role" and "does not exist" are ONE state: 404, never a locked page,
//   never a 403 that confirms the id.
//
//   403 is reserved for the role-too-low WRITE: a stale tab that may still
//   read the task but may no longer edit it. A read never 403s.
//
// STATUS. The access engine under src/lib/access is still inert, so the server
// half (src/lib/item-gate.ts) feeds these signals from the existing board and
// space helpers, which already delegate through parity.ts's one transcription.
// This module is the shape `decision` takes on the wire either way, so the day
// the engine is switched on nothing above it changes.
//
// Pure module: no imports, so vitest loads it in the node environment.

export type ItemRole = "none" | "VIEW" | "COMMENT" | "EDIT" | "FULL";

/**
 * Why the viewer holds the role they hold, for the header chip and support.
 *
 * "linked-list" (Phase 5b, tasks in more than one List): the viewer reads a
 * List the task, or its top-level ancestor on the same home, is linked into.
 * Adding a task to a List is an explicit share, so that List's readers may
 * READ it; it never grants more than VIEW, because writing to a task is still
 * decided by its home List, its assignees and its creator.
 */
export type ItemVia = "org-admin" | "creator" | "assignee" | "list" | "linked-list" | "none";

export interface ItemDecision {
  /** What the viewer may do NOW, with every rule-12 cap applied. */
  role: ItemRole;
  via: ItemVia;
  /** The object the role came from, when it came from one (the List). */
  viaObject?: { type: string; id: string; name: string | null };
  /**
   * The role BEFORE the archived cap, and the reason it is here: `restore` is
   * the one action an archived task must still allow at Can edit, or a person
   * who archives their own task by accident can never undo it from the task
   * and has to go looking for Trash (work-tasks #11). Everything else on an
   * archived task reads `role`, which is capped at Can view.
   */
  roleBeforeArchive: ItemRole;
  /** True when the archived cap actually lowered the role. */
  archived: boolean;
}

const RANK: Readonly<Record<ItemRole, number>> = {
  none: 0,
  VIEW: 1,
  COMMENT: 2,
  EDIT: 3,
  FULL: 4,
};

export function rankOf(role: ItemRole): number {
  return RANK[role];
}

export function maxItemRole(a: ItemRole, b: ItemRole): ItemRole {
  return RANK[a] >= RANK[b] ? a : b;
}

export function minItemRole(a: ItemRole, b: ItemRole): ItemRole {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Every verb an item route gates on. */
export type ItemAction =
  | "view"
  | "comment"
  | "edit"
  | "archive"
  | "restore"
  | "duplicate"
  | "move"
  | "delete";

/** The floor each verb needs before the caps in `decideItem` are applied. */
export const ITEM_ACTION_FLOOR: Readonly<Record<ItemAction, ItemRole>> = {
  view: "VIEW",
  comment: "COMMENT",
  edit: "EDIT",
  archive: "EDIT",
  restore: "EDIT",
  duplicate: "EDIT",
  move: "EDIT",
  // Delete is the one verb whose floor is not the whole rule: access section 9
  // reads "creator with Can edit, or Full access", which `allowsItemAction`
  // spells out below.
  delete: "FULL",
};

export interface ItemSignals {
  /** Rule 4: the viewer is an org Owner or Admin. */
  orgAdmin: boolean;
  /** Rule 4 / 12: the viewer is a Guest, capped at EDIT. */
  guest: boolean;
  /** Rule 12: an acting Agent may never delete. */
  agent?: boolean;
  /** Rule 5: the viewer created this task. */
  creator: boolean;
  /** Rule 9: the viewer is the owner or one of the assignees. */
  assignee: boolean;
  /** Rule 10: what the parent List gives this viewer, already resolved. */
  listRole: ItemRole;
  /** Rule 12: an archived task is read-only for everyone but FULL. */
  archived: boolean;
  /** The List, for `viaObject`. */
  list?: { id: string; name: string | null };
  /**
   * A readable List the task is linked into (Phase 5b). Grants VIEW and
   * nothing more. It is considered right after the home List, so a home
   * reader keeps `via: "list"` (rule 11 keeps the first source to reach a
   * rank) and every other source outranks it: "linked-list" is the answer
   * only when that List is the one thing the viewer has.
   */
  linkedList?: { id: string; name: string | null } | null;
}

/**
 * Resolve the role, with rule 11 (maximum of every source) then rule 12 (caps
 * take the minimum) in that order, exactly as the access spec runs them.
 */
export function decideItem(s: ItemSignals): ItemDecision {
  let role: ItemRole = "none";
  let via: ItemVia = "none";
  let viaObject: ItemDecision["viaObject"];

  // Rule 11: the maximum wins, and `via` names whichever source produced it.
  const consider = (candidate: ItemRole, source: ItemVia, obj?: ItemDecision["viaObject"]) => {
    if (RANK[candidate] > RANK[role]) {
      role = candidate;
      via = source;
      viaObject = obj;
    }
  };

  if (s.listRole !== "none") {
    consider(s.listRole, "list", s.list ? { type: "list", id: s.list.id, name: s.list.name } : undefined);
  }
  if (s.linkedList) consider("VIEW", "linked-list", { type: "list", id: s.linkedList.id, name: s.linkedList.name });
  if (s.assignee) consider("EDIT", "assignee");
  if (s.creator) consider("FULL", "creator");
  if (s.orgAdmin) consider("FULL", "org-admin");

  if (role === "none") {
    return { role: "none", via: "none", roleBeforeArchive: "none", archived: !!s.archived };
  }

  // Rule 12, in order. A Guest is capped at Can edit.
  if (s.guest) role = minItemRole(role, "EDIT");
  const roleBeforeArchive = role;
  // An archived task is at most Can view unless the viewer holds Full access.
  if (s.archived && role !== "FULL") role = minItemRole(role, "VIEW");

  const out: ItemDecision = { role, via, roleBeforeArchive, archived: !!s.archived };
  if (viaObject) out.viaObject = viaObject;
  return out;
}

/**
 * Does this decision clear this verb?
 *
 * `delete` is the only verb that is not a plain floor: access section 9 allows
 * the CREATOR holding Can edit as well as anyone with Full access, and never
 * an Agent.
 */
export function allowsItemAction(
  decision: ItemDecision,
  action: ItemAction,
  s: Pick<ItemSignals, "creator" | "agent">,
): boolean {
  if (decision.role === "none") return false;
  if (action === "delete") {
    if (s.agent) return false;
    if (decision.role === "FULL") return true;
    return s.creator && RANK[decision.role] >= RANK["EDIT"];
  }
  // Restore is measured against the role BEFORE the archived cap, because the
  // cap exists to stop edits to an archived task, not to trap it there.
  if (action === "restore") return RANK[decision.roleBeforeArchive] >= RANK["EDIT"];
  return RANK[decision.role] >= RANK[ITEM_ACTION_FLOOR[action]];
}

/**
 * The status an item route answers with when an action is refused.
 *
 * 404 whenever the resolved role is none, because a task is never
 * discoverable; 403 only when a real role is simply too low for a write.
 * A refused READ is always 404 — a 403 on a read would confirm the id.
 */
export function denialStatusFor(decision: ItemDecision, action: ItemAction): 403 | 404 {
  if (decision.role === "none") return 404;
  if (action === "view") return 404;
  return 403;
}
