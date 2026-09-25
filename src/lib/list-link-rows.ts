// Rows shown in a List THROUGH A LINK, on the client: every rule, pure.
//
// Decision 7 (docs/plans/competitor-gap-2026-09.md section 7), ClickUp's
// model. A task keeps its HOME List and may appear in more Lists; a List page
// asks for those rows with `?links=1` and receives them with `listLink` set
// (src/lib/board-items-view.ts). Each rule a List page applies to such a row
// lives here, so the table, the kanban, the calendar, the gantt and the canvas
// cannot each invent their own:
//
//   * what the row IS (home, a linked root, a subtask shown through its linked
//     parent). Detected by `listLink`, NEVER by `row.boardId`: a viewer who
//     cannot read the home gets `boardId` rewritten to the List they are in;
//   * which status it groups under here (its status belongs to its HOME set,
//     so it is remapped into this List's words for columns and filters, and
//     the reverse for a drop), and which set its picker offers;
//   * what a write from here carries (`contextBoardId`, so the server edits
//     this List's namespace and never re-homes or reorders the home);
//   * what the viewer may do to it (its role comes from the task, not from
//     the List shown);
//   * how an item event, a refetch and the poll change the held rows.
//
// Pure: type-only imports plus the pure item-role, item-move and list-links.

import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import { decideItem, rankOf, type ItemRole } from "@/lib/item-role";
import { remapStatusOnMove } from "@/lib/item-move";
import { LIST_LINK_CANVAS_LIVE, MAX_LISTS_PER_ITEM } from "@/lib/list-links";

export type LinkedRowKind = "home" | "linked-root" | "linked-subtask";

/** The role a linked row carries: a link always grants at least VIEW. */
export type LinkedRole = Exclude<ItemRole, "none">;

/**
 * What this row is in the List shown.
 *
 * A row whose link names another List is not linked into THIS one, so it is
 * read as a home row, which is the conservative answer: it writes with no
 * context, exactly as every row did before links existed.
 */
export function linkedRowKind(row: Pick<BoardItemRow, "listLink">, boardId: string): LinkedRowKind {
  const link = row.listLink;
  if (!link || link.boardId !== boardId) return "home";
  return link.position === null ? "linked-subtask" : "linked-root";
}

function isLinkedHere(row: Pick<BoardItemRow, "listLink">, boardId: string): boolean {
  return linkedRowKind(row, boardId) !== "home";
}

/**
 * The status this row groups, columns and filters under in THIS List.
 *
 * A linked task's status is a value of its home set. Shown in B it is
 * remapped into B's set the way a move remaps it (same value, same label,
 * same group, first Active), so a home "Shipped" in the DONE group sits in
 * B's Done column although B has no "Shipped". A subtask shown through its
 * parent carries no home set, so its value is remapped from nothing: kept
 * when B has it, else read as an Active status.
 */
export function boardStatusFor(row: BoardItemRow, boardId: string, statuses: readonly StatusOption[]): string | null {
  if (!isLinkedHere(row, boardId)) return row.status;
  const link = row.listLink!;
  const value = link.homeStatus?.value ?? row.status;
  if (!value) return null;
  const from = link.homeStatuses ?? (link.homeStatus ? [link.homeStatus] : []);
  return remapStatusOnMove({ status: value, from, to: statuses }).status;
}

/**
 * The HOME value a drop into B's `target` column (or a bulk status) writes.
 *
 * Null when the home set is not known here (a viewer who cannot read the
 * home, or a subtask shown through its parent): then nothing may be dragged
 * or written, because the server refuses any value outside the home set.
 */
export function homeStatusForBoardStatus(row: BoardItemRow, target: string, statuses: readonly StatusOption[]): string | null {
  if (!row.listLink) return target;
  const homeStatuses = row.listLink.homeStatuses;
  if (!homeStatuses || homeStatuses.length === 0) return null;
  return remapStatusOnMove({ status: target, from: statuses, to: homeStatuses }).status;
}

/** Which statuses a row's picker offers, and whether it may be changed at all. */
export function statusPickerFor(
  row: BoardItemRow,
  boardId: string,
  statuses: readonly StatusOption[],
): { options: StatusOption[]; editable: boolean } {
  if (!isLinkedHere(row, boardId)) return { options: [...statuses], editable: true };
  const homeStatuses = row.listLink?.homeStatuses;
  if (homeStatuses && homeStatuses.length > 0) return { options: [...homeStatuses], editable: true };
  return { options: [...statuses], editable: false };
}

/**
 * What every write from this List adds to its body.
 *
 * A home row writes as it always has, with no context. Every linked row,
 * root and subtask alike, names the List it is edited in, so its values land
 * in that List's namespace and a reorder or a group change can never be
 * applied to its home.
 */
export function writeContext(row: BoardItemRow | undefined | null, boardId: string): { contextBoardId?: string } {
  if (!row || !isLinkedHere(row, boardId)) return {};
  return { contextBoardId: boardId };
}

/** The List read a canvas makes: the union of home and linked rows while the switch is on. */
export function itemsUrl(boardId: string): string {
  return `/api/boards/${boardId}/items${LIST_LINK_CANVAS_LIVE ? "?links=1" : ""}`;
}

// ── Access ───────────────────────────────────────────────────────────

/**
 * The role a viewer holds on a task shown through a link, and what they may
 * do to the link itself. The SAME ladder gateItem runs (item-role.ts): org
 * admin and creator FULL, assignee EDIT, the home List's own role, and the
 * List shown granting VIEW. Called by board-items-view.ts on the server with
 * the signals it reads, and nowhere else decides it.
 *
 *   canRemove  contribute on the List shown OR on the home (or org admin):
 *              decideLinkRemoval's rule in list-links.ts.
 *   canShare   contribute on the home (or org admin): the home half of the
 *              add rule. The target half is the picker's `writable=1`.
 */
export function linkedRowAccess(i: {
  orgAdmin: boolean;
  homeRole: ItemRole;
  assignee: boolean;
  creator: boolean;
  archived: boolean;
  contextContribute: boolean;
}): { role: LinkedRole; canRemove: boolean; canShare: boolean } {
  const decision = decideItem({
    orgAdmin: i.orgAdmin,
    guest: false,
    creator: i.creator,
    assignee: i.assignee,
    listRole: i.homeRole,
    archived: i.archived,
    linkedList: { id: "context", name: null },
  });
  const role: LinkedRole = decision.role === "none" ? "VIEW" : decision.role;
  const writesHome = i.orgAdmin || i.homeRole === "EDIT" || i.homeRole === "FULL";
  return {
    role,
    canRemove: i.contextContribute || writesHome,
    // An archived task is refused by the add route (item_archived), so it is
    // never offered.
    canShare: writesHome && !i.archived,
  };
}

/**
 * May this row be edited in place in the List shown?
 *
 * A home row: the List's own contribute flag, exactly as before. A linked
 * row: that flag AND a task role of at least EDIT. Contributing to List B
 * says nothing about a task B only borrows, which is how a view-only reader
 * of a shared task used to be handed a row full of editors that all 403'd.
 */
export function linkedRowEditable(row: BoardItemRow, canContribute: boolean): boolean {
  if (!row.listLink) return canContribute;
  const role = row.listLink.role;
  return canContribute && !!role && rankOf(role) >= rankOf("EDIT");
}

export interface LinkedMenuFlags {
  /** The task role for the menu; null means "keep the host's own". */
  role: ItemRole | null;
  isCreator: boolean;
  inSecondaryList: boolean;
  linkedSubtask: boolean;
  canRemoveFromList: boolean;
  canLinkMove: boolean;
  canAddToList: boolean;
}

/** The task menu's link-related flags for one row. */
export function linkedMenuFlags(
  row: BoardItemRow,
  boardId: string,
  canContribute: boolean,
  currentUserId: string | null,
  opts: { personalList?: boolean } = {},
): LinkedMenuFlags {
  const isCreator = Boolean(currentUserId && row.createdBy?.id === currentUserId);
  const kind = linkedRowKind(row, boardId);
  if (kind === "home") {
    return {
      role: null,
      isCreator,
      inSecondaryList: false,
      linkedSubtask: false,
      canRemoveFromList: false,
      canLinkMove: false,
      // A subtask is shared with its parent, never alone, and a Personal
      // List task is its owner's alone.
      canAddToList: canContribute && !row.parentItemId && !opts.personalList,
    };
  }
  const link = row.listLink!;
  const root = kind === "linked-root";
  return {
    role: link.role ?? "VIEW",
    isCreator,
    inSecondaryList: true,
    linkedSubtask: !root,
    canRemoveFromList: root && !!link.canRemove,
    canLinkMove: root && !!link.canRemove && !!link.canShare,
    canAddToList: root && !!link.canShare,
  };
}

// ── Keeping the held rows true ───────────────────────────────────────

export interface ItemEventLike {
  gone?: boolean;
  boardId?: string | null;
  listIds?: string[];
  leftListIds?: string[];
}

/**
 * What a canvas does with one `item` event.
 *
 *   ignore   not on screen and not arriving here
 *   drop     it left this List (archived, deleted, unlinked, moved away)
 *   refetch  re-read that one task in this List's context
 *   reload   re-read the List (a task newly shown here, or one whose kind
 *            here changed)
 *
 * A linked row is NEVER dropped because `boardId` names its home: that field
 * is the home, and a linked row's home is by definition another List.
 */
export function itemEventAction(
  ev: ItemEventLike,
  canvasBoardId: string,
  row: BoardItemRow | undefined,
): "ignore" | "drop" | "refetch" | "reload" {
  const leaving = !!ev.leftListIds?.includes(canvasBoardId);
  const arriving = !!ev.listIds?.includes(canvasBoardId);
  if (!row) return arriving && !ev.gone && !leaving ? "reload" : "ignore";
  if (ev.gone || leaving) return "drop";
  const kind = linkedRowKind(row, canvasBoardId);
  if (kind === "linked-subtask") return "refetch";
  if (kind === "linked-root") return !ev.listIds || arriving ? "refetch" : "drop";
  if (ev.boardId && ev.boardId !== canvasBoardId) return arriving ? "reload" : "drop";
  return "refetch";
}

/** The part of GET /api/items/[id] a canvas merges. */
export interface RefetchedTask {
  item: Partial<BoardItemRow> & { id: string };
  context: {
    boardId: string;
    kind: "home" | "linked";
    homeStatus?: StatusOption | null;
    homeStatuses?: StatusOption[];
  };
  decision?: { role: ItemRole } | null;
}

/**
 * A write route's response row (PATCH /api/items/[id], a create) read as a
 * refetch body, so one merge rule serves both.
 */
export function refetchedFromRow(row: BoardItemRow): RefetchedTask {
  const link = row.listLink;
  return {
    // A linked root's place in this List is its LINK position; the server
    // already writes it into `position`, and this says so rather than trusting
    // every producer to.
    item: link && link.position !== null ? { ...row, position: link.position } : row,
    context: link
      ? {
          boardId: link.boardId,
          kind: "linked",
          ...(link.homeStatus !== undefined ? { homeStatus: link.homeStatus } : {}),
          ...(link.homeStatuses ? { homeStatuses: link.homeStatuses } : {}),
        }
      : { boardId: row.boardId ?? "", kind: "home" },
    decision: link?.role ? { role: link.role } : null,
  };
}

/**
 * Fold a re-read task into the row a canvas holds.
 *
 * A 404, or an answer for another List (it left this one, and the body is its
 * home or some other List), drops the row. A linked row keeps its own
 * `boardId` and `listLink` (the answer's `boardId` may be the home, which is
 * not what this List draws), takes the answer's position, and refreshes the
 * home status pill, the home set and the role from the answer's context and
 * decision. A row whose kind here changed is not patched in place: the List
 * is re-read.
 */
export function mergeRefetchedRow(
  prev: BoardItemRow,
  fresh: RefetchedTask | null,
  canvasBoardId: string,
): { action: "merge"; row: BoardItemRow } | { action: "drop" } | { action: "reload" } {
  if (!fresh) return { action: "drop" };
  if (fresh.context.boardId !== canvasBoardId) return { action: "drop" };
  const prevKind = linkedRowKind(prev, canvasBoardId);
  const freshLinked = fresh.context.kind === "linked";
  if ((prevKind === "home") === freshLinked) return { action: "reload" };
  if (!freshLinked) return { action: "merge", row: { ...prev, ...fresh.item } as BoardItemRow };

  const prevLink = prev.listLink!;
  const root = prevKind === "linked-root";
  const listLink: NonNullable<BoardItemRow["listLink"]> = { ...prevLink };
  if (root) {
    if (typeof fresh.item.position === "number") listLink.position = fresh.item.position;
    if (fresh.context.homeStatus !== undefined) listLink.homeStatus = fresh.context.homeStatus;
    if (fresh.context.homeStatuses) listLink.homeStatuses = fresh.context.homeStatuses;
    else delete listLink.homeStatuses;
  }
  if (fresh.decision?.role && fresh.decision.role !== "none") listLink.role = fresh.decision.role;
  const merged: BoardItemRow = {
    ...prev,
    ...(fresh.item as Partial<BoardItemRow>),
    boardId: prev.boardId,
    listLink,
    ...(root
      ? { position: typeof fresh.item.position === "number" ? fresh.item.position : prev.position, groupKey: null }
      : {}),
  };
  return { action: "merge", row: merged };
}

function updatedTs(r: BoardItemRow): number {
  return r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
}

/**
 * Fold one poll of the List into the held rows. Null when nothing changed.
 *
 * Today's rule, kept: a row the server holds strictly newer replaces the held
 * one, a new row is appended, and a HOME row is never dropped by a poll (that
 * is what keeps an optimistic add alive until the server has it). Two rules
 * for linked rows, which a link change moves without touching the task:
 * a held linked row the answer no longer names has left this List and goes,
 * and a linked row whose link position or home status changed is replaced
 * even at an equal updatedAt.
 */
export function reconcilePoll(prev: BoardItemRow[], fresh: BoardItemRow[]): BoardItemRow[] | null {
  const freshById = new Map(fresh.map((r) => [r.id, r] as const));
  const prevIds = new Set(prev.map((r) => r.id));
  let changed = false;
  const next: BoardItemRow[] = [];
  for (const r of prev) {
    const f = freshById.get(r.id);
    if (!f) {
      if (r.listLink) {
        changed = true;
        continue;
      }
      next.push(r);
      continue;
    }
    if (updatedTs(f) > updatedTs(r)) {
      changed = true;
      next.push(f);
      continue;
    }
    if (
      r.listLink &&
      f.listLink &&
      (r.listLink.position !== f.listLink.position || (r.listLink.homeStatus?.value ?? null) !== (f.listLink.homeStatus?.value ?? null))
    ) {
      changed = true;
      next.push(f);
      continue;
    }
    next.push(r);
  }
  for (const f of fresh) {
    if (!prevIds.has(f.id)) {
      next.push(f);
      changed = true;
    }
  }
  return changed ? next : null;
}

/** The optimistic twin of a linked status write: the value and its home pill. */
export function optimisticLinkedStatus(row: BoardItemRow, homeValue: string): BoardItemRow {
  if (!row.listLink) return { ...row, status: homeValue };
  const link = row.listLink;
  const opt =
    link.homeStatuses?.find((s) => s.value === homeValue) ??
    (link.homeStatus?.value === homeValue ? link.homeStatus : null) ??
    { value: homeValue, label: homeValue, color: "#98A2B3", group: "ACTIVE" as const };
  return { ...row, status: homeValue, listLink: { ...link, ...(link.position !== null ? { homeStatus: opt } : {}) } };
}

/**
 * A bulk "set status" over a selection that mixes both kinds.
 *
 * Home rows get the raw value, as today. Linked rows get their home value,
 * grouped so each distinct value is one request. A linked row whose home set
 * is not known here cannot be mapped and is skipped, and named, never sent a
 * value its home would refuse.
 */
export function planBulkStatus(
  rows: readonly BoardItemRow[],
  target: string,
  boardId: string,
  statuses: readonly StatusOption[],
): { home: string[]; linked: Array<{ ids: string[]; status: string }>; skipped: string[] } {
  const home: string[] = [];
  const skipped: string[] = [];
  const byStatus = new Map<string, string[]>();
  for (const r of rows) {
    if (!isLinkedHere(r, boardId)) {
      home.push(r.id);
      continue;
    }
    const mapped = homeStatusForBoardStatus(r, target, statuses);
    if (!mapped) {
      skipped.push(r.id);
      continue;
    }
    const ids = byStatus.get(mapped) ?? [];
    ids.push(r.id);
    byStatus.set(mapped, ids);
  }
  return { home, linked: [...byStatus.entries()].map(([status, ids]) => ({ ids, status })), skipped };
}

/** A per-task refusal from POST /api/boards/[id]/links, as a sentence. */
export function addLinkReasonMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "list_archived": return "That List is archived.";
    case "not_a_task_list": return "Tasks can't be added to that List.";
    case "personal_list": return "A Personal List only holds its owner's own tasks.";
    case "item_not_found": return "That task is no longer there.";
    case "item_archived": return "An archived task can't be added to another List.";
    case "is_subtask": return "A subtask appears wherever its parent does, so it can't be added on its own.";
    case "already_home": return "That's already this task's home List.";
    case "home_list_read_only": return "You need edit access to this task's List to add it to another List.";
    case "too_many_lists": return `A task can appear in at most ${MAX_LISTS_PER_ITEM} Lists besides its home.`;
    case "home_changed": return "This task just moved to another List. Try again.";
    default: return "Couldn't add this task to that List.";
  }
}
