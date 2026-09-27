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
  return boardStatusPlacement(row, boardId, statuses).status;
}

/** Where a row sits among this List's statuses, and whether that is its own status. */
export interface BoardStatusPlacement {
  status: string | null;
  /**
   * True when this List holds the row's status itself (the same value or the
   * same words). False when the row only sits under the nearest one, a home
   * "In review" under B's first Active status because B has no "In review".
   */
  exact: boolean;
  /** The home status a linked row really holds, when it is known here. */
  home: StatusOption | null;
}

/** boardStatusFor, with the reason: is the row under its own status or the nearest one? */
export function boardStatusPlacement(row: BoardItemRow, boardId: string, statuses: readonly StatusOption[]): BoardStatusPlacement {
  if (!isLinkedHere(row, boardId)) return { status: row.status, exact: true, home: null };
  const link = row.listLink!;
  const value = link.homeStatus?.value ?? row.status;
  if (!value) return { status: null, exact: true, home: null };
  const from = link.homeStatuses ?? (link.homeStatus ? [link.homeStatus] : []);
  const remap = remapStatusOnMove({ status: value, from, to: statuses });
  const home = link.homeStatus ?? from.find((s) => s.value === value) ?? null;
  return { status: remap.status, exact: remap.reason === "same-value" || remap.reason === "same-label", home };
}

/**
 * The sentence that explains a linked row sitting under a status that is not
 * its own, or null when there is nothing to explain.
 *
 * The walk found a home "In review" task filed under B's "To Do" with nothing
 * on screen saying why. The placement stays (B has no "In review" column to
 * put it in, and inventing one per foreign status would be a new surface), so
 * the row's status pill carries this as its tooltip and at the head of its
 * menu, and a Board card shows linkedStatusShort under its title.
 */
export function linkedStatusNote(row: BoardItemRow, boardId: string, statuses: readonly StatusOption[]): string | null {
  const p = boardStatusPlacement(row, boardId, statuses);
  if (p.exact || !p.home || !p.status) return null;
  const shownUnder = statuses.find((s) => s.value === p.status)?.label ?? p.status;
  const where = row.listLink?.homeList?.name ?? "its home List";
  return `This task is ${p.home.label} in ${where}. This List has no ${p.home.label} status, so it shows under ${shownUnder}.`;
}

/**
 * The few words a Board card shows under its title for the same case, so a
 * card in To Do says why without a hover. Null when linkedStatusNote is null.
 *
 * The card's LinkedRowIndicator already names the home List right after the
 * title whenever the viewer may know it, so then the line is the home status
 * alone ("In review"); naming the List here too put its name on the card
 * twice. When the indicator is the bare glyph, the line says where the
 * status belongs ("In review in its home List"). The full sentence stays the
 * line's tooltip (linkedStatusNote).
 */
export function linkedStatusShort(row: BoardItemRow, boardId: string, statuses: readonly StatusOption[]): string | null {
  const p = boardStatusPlacement(row, boardId, statuses);
  if (p.exact || !p.home || !p.status) return null;
  const indicatorNamesHome = linkedRowKind(row, boardId) === "linked-root" && !!row.listLink?.homeList;
  return indicatorNamesHome ? p.home.label : `${p.home.label} in its home List`;
}

/**
 * The HOME value a drop into B's `target` column (or a bulk status) writes.
 *
 * Null when the home set is not known here (a viewer who cannot read the
 * home, or a subtask shown through its parent): then nothing may be dragged
 * or written, because the server refuses any value outside the home set.
 * Null too when the home set has no status that lands back in `target`
 * (see homeStatusTarget).
 */
export function homeStatusForBoardStatus(row: BoardItemRow, target: string, statuses: readonly StatusOption[]): string | null {
  const t = homeStatusTarget(row, target, statuses);
  return t.ok ? t.status : null;
}

export type HomeStatusTarget =
  | { ok: true; status: string }
  | { ok: false; reason: "home_unknown" | "no_equivalent" };

/**
 * homeStatusForBoardStatus, with the reason it says no.
 *
 * A write is FAITHFUL only when the home value it maps to is grouped back
 * into the very column it was dropped on (boardStatusPlacement). The walk
 * found the lossy case: home To Do / In review / Done, B To Do / In
 * Progress / Done. A drop on B's In Progress fell through to "first Active"
 * and wrote the home's To Do, so the card jumped back to To Do, a Done task
 * was silently reopened, and In Progress could never be reached. The round
 * trip keeps every mapping that lands where the person put it (the same
 * value, the same words, and a group mapping such as B's Done to a home
 * "Shipped", which B groups under Done) and refuses the rest, so the caller
 * says why instead of saving a status nobody picked.
 */
export function homeStatusTarget(row: BoardItemRow, target: string, statuses: readonly StatusOption[]): HomeStatusTarget {
  if (!row.listLink) return { ok: true, status: target };
  const homeStatuses = row.listLink.homeStatuses;
  if (!homeStatuses || homeStatuses.length === 0) return { ok: false, reason: "home_unknown" };
  const mapped = remapStatusOnMove({ status: target, from: statuses, to: homeStatuses }).status;
  if (!mapped) return { ok: false, reason: "home_unknown" };
  const back = remapStatusOnMove({ status: mapped, from: homeStatuses, to: statuses }).status;
  if (back !== target) return { ok: false, reason: "no_equivalent" };
  return { ok: true, status: mapped };
}

/** What a refused drop (or single status write) of a linked task says. */
export function linkedStatusRefusal(row: BoardItemRow, targetLabel: string, reason: "home_unknown" | "no_equivalent"): string {
  if (reason === "home_unknown") return "This task's status can't be changed here because its home List's statuses aren't shared with you.";
  const where = row.listLink?.homeList?.name ?? "This task's home List";
  return `${where} has no ${targetLabel} status, so this task can't go in ${targetLabel} here. Open the task to pick one of its own statuses.`;
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

/**
 * What a renderer reports to its host after an optimistic edit. Row fields
 * ride as themselves. A custom-field edit rides as `metadataPatch`, the same
 * patch the request carried, never as a merged blob: each holder merges the
 * patch into its OWN copy of `metadata` (applyRowPatchReport), so a report
 * can only change the keys the edit named. Sending the reporter's merged
 * blob would revert every other key the host learned elsewhere (the drawer,
 * the poll), and sending no metadata at all left the host's old value to win
 * the next renderer resync: the edited cell showed the old value until a
 * full reload.
 */
export type RowPatchReport = Partial<BoardItemRow> & { metadataPatch?: Record<string, unknown> };

/** The optimistic twin of the server-side metadataPatch merge: null deletes the key. */
export function mergeMetadataPatch(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

/**
 * Fold a report into the row a host holds. `metadataPatch` merges into THIS
 * row's own metadata; a report that instead carries a whole `metadata` row
 * field (a server-truth reply, e.g. a Connect commit) replaces it like any
 * other row field, exactly as before.
 */
export function applyRowPatchReport(row: BoardItemRow, report: RowPatchReport): BoardItemRow {
  const { metadataPatch, ...fields } = report;
  const next: BoardItemRow = { ...row, ...fields };
  if (metadataPatch) next.metadata = mergeMetadataPatch(next.metadata, metadataPatch);
  return next;
}

function updatedTs(r: BoardItemRow): number {
  return r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
}

/**
 * Did anything a linked row is DRAWN or GATED by change, whatever the task's
 * updatedAt says? A link move or a reorder moves its place; a status change
 * at home moves its pill; and a change of access (the home List shared or
 * unshared, a role lowered) changes its role, what it may do to the link and
 * whether its home is named. None of those touch the task, so a poll that
 * trusted updatedAt alone kept offering controls the server now refuses.
 */
function linkFactsDiffer(a: NonNullable<BoardItemRow["listLink"]>, b: NonNullable<BoardItemRow["listLink"]>): boolean {
  return (
    a.position !== b.position ||
    (a.homeStatus?.value ?? null) !== (b.homeStatus?.value ?? null) ||
    (a.role ?? null) !== (b.role ?? null) ||
    !!a.canRemove !== !!b.canRemove ||
    !!a.canShare !== !!b.canShare ||
    (a.homeList?.id ?? null) !== (b.homeList?.id ?? null) ||
    !!a.homeStatuses !== !!b.homeStatuses
  );
}

/**
 * The computed cells (connect chips and mirror values) the server read for a
 * row, as one comparable string. They are computed from OTHER tasks, so a
 * connected task renamed, or its mirrored budget changed, moves them without
 * touching this row's updatedAt.
 */
function computedCellsKey(r: BoardItemRow): string {
  const conn = r.connections
    ? Object.keys(r.connections).sort().map((k) => [k, r.connections![k].map((c) => [c.id, c.title, c.statusLabel, c.statusColor, c.done])])
    : null;
  const mirr = r.mirrors ? Object.keys(r.mirrors).sort().map((k) => [k, r.mirrors![k].values, r.mirrors![k].rollup ?? null]) : null;
  return JSON.stringify([conn, mirr]);
}

/**
 * May the fresh computed cells be laid over the held row? Only when the held
 * row's OWN connect values (the ids stored in its metadata) still match what
 * the server computed them from. A connect edit still in flight here holds
 * new ids the server has not seen, and its chips must not be swapped back to
 * the old ones for a poll tick.
 */
function connectValuesAgree(held: BoardItemRow, fresh: BoardItemRow): boolean {
  const keys = Object.keys(fresh.connections ?? {});
  return keys.every((k) => JSON.stringify(held.metadata?.[k] ?? null) === JSON.stringify(fresh.metadata?.[k] ?? null));
}

/**
 * Fold one poll of the List into the held rows. Null when nothing changed.
 *
 * Today's rule, kept: a row the server holds strictly newer replaces the held
 * one, a new row is appended, and a HOME row is never dropped by a poll (that
 * is what keeps an optimistic add alive until the server has it). Two rules
 * for linked rows, which a link change moves without touching the task:
 * a held linked row the answer no longer names has left this List and goes,
 * and a linked row whose link position, home status or access changed is
 * replaced even at an equal updatedAt (linkFactsDiffer). And for every row,
 * fresh connect chips and mirror values are taken at an equal updatedAt
 * (they change when a CONNECTED task changes, never this one).
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
    if (r.listLink && f.listLink && linkFactsDiffer(r.listLink, f.listLink)) {
      changed = true;
      next.push(f);
      continue;
    }
    // Connect chips and mirror values are read from other tasks, so they go
    // stale at an equal updatedAt: take ONLY those two from the answer, which
    // never clobbers anything the viewer is editing on this row.
    if ((f.connections || f.mirrors) && computedCellsKey(r) !== computedCellsKey(f) && connectValuesAgree(r, f)) {
      changed = true;
      next.push({ ...r, connections: f.connections, mirrors: f.mirrors });
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
 * grouped so each distinct value is one request. A linked row that cannot be
 * mapped is skipped, and named, never sent a value its home would refuse or
 * one that lands in another status than the one picked (homeStatusTarget):
 * `skipped` holds every such row, and `unmatched` the ones among them whose
 * home set is known but has no status for the target.
 */
export function planBulkStatus(
  rows: readonly BoardItemRow[],
  target: string,
  boardId: string,
  statuses: readonly StatusOption[],
): { home: string[]; linked: Array<{ ids: string[]; status: string }>; skipped: string[]; unmatched: string[] } {
  const home: string[] = [];
  const skipped: string[] = [];
  const unmatched: string[] = [];
  const byStatus = new Map<string, string[]>();
  for (const r of rows) {
    if (!isLinkedHere(r, boardId)) {
      home.push(r.id);
      continue;
    }
    const mapped = homeStatusTarget(r, target, statuses);
    if (!mapped.ok) {
      skipped.push(r.id);
      if (mapped.reason === "no_equivalent") unmatched.push(r.id);
      continue;
    }
    const ids = byStatus.get(mapped.status) ?? [];
    ids.push(r.id);
    byStatus.set(mapped.status, ids);
  }
  return { home, linked: [...byStatus.entries()].map(([status, ids]) => ({ ids, status })), skipped, unmatched };
}

/** The banner sentences for the rows a bulk status left alone, or "" when none. */
export function bulkStatusSkipMessage(plan: { skipped: string[]; unmatched: string[] }, targetLabel: string): string {
  const unmatched = plan.unmatched.length;
  const unknown = plan.skipped.length - unmatched;
  const n = (count: number) =>
    count === 1 ? "1 task from another List wasn't changed" : `${count} tasks from other Lists weren't changed`;
  const out: string[] = [];
  if (unknown > 0) out.push(`${n(unknown)} because ${unknown === 1 ? "its" : "their"} home List's statuses aren't shared with you.`);
  if (unmatched > 0) out.push(`${n(unmatched)} because ${unmatched === 1 ? "its" : "their"} home List has no ${targetLabel} status.`);
  return out.join(" ");
}

// ── Connected and mirror cells, read by sort, group and refresh ───────
//
// These cells are not in `metadata`: a Connect cell stores ids there and a
// Mirror cell stores nothing, and what the viewer SEES comes from
// `row.connections` and `row.mirrors`, computed at read time from the tasks
// the viewer can read. A sort or a group that read `metadata` sorted every
// mirror row as empty (so Sort ascending and descending did nothing) and a
// connect row by raw ids.

/** One mirror or connect cell as the text or number it shows, or null when empty. */
function computedScalar(v: unknown, lower: boolean): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return lower ? v.toLowerCase() : v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    const parts = v.map((x) => computedScalar(x, lower)).filter((x): x is string | number => x !== null);
    return parts.length ? parts.map(String).join(", ") : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const named = o.label ?? o.name ?? o.title;
    if (typeof named === "string") return lower ? named.toLowerCase() : named;
  }
  return null;
}

/**
 * What a column sort or group reads for a Connect or Mirror column, the value
 * the cell shows. `undefined` means the key is neither on this row, and the
 * caller reads `metadata` as before; `null` means the cell is empty.
 *
 * A mirror sorts by its rollup when it has one, else its first value; a
 * connect cell by its chips' titles, never its ids. `"sort"` lowercases text
 * so case never decides the order; `"group"` keeps the words as shown, for a
 * group heading.
 */
export function computedCellValue(row: BoardItemRow, key: string, mode: "sort" | "group" = "sort"): string | number | null | undefined {
  const lower = mode === "sort";
  const m = row.mirrors?.[key];
  if (m) {
    if (m.rollup !== undefined && m.rollup !== null && m.rollup !== "") return computedScalar(m.rollup, lower);
    for (const v of m.values) {
      const x = computedScalar(v, lower);
      if (x !== null) return x;
    }
    return null;
  }
  const c = row.connections?.[key];
  if (c) return c.length ? c.map((t) => (lower ? t.title.toLowerCase() : t.title)).join(", ") : null;
  return undefined;
}

/**
 * The Connect and Mirror fields of a schema as one comparable string. When it
 * changes (a Mirror column added, a Connect column's target Lists changed),
 * the held rows' computed cells were read for the old schema and the List
 * must be re-read: a new Mirror column otherwise stayed blank all session.
 */
export function computedFieldsKey(fields: readonly { key: string; type: string; options?: unknown }[]): string {
  return JSON.stringify(
    fields
      .filter((f) => f.type === "MIRROR" || f.type === "RELATIONSHIP")
      .map((f) => [f.key, f.type, f.options ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/**
 * Picker sections whose labels are all distinct.
 *
 * The shared Picker keys a section by its label, and two Spaces may carry the
 * same name, which made React drop or repeat a List row. A repeated label
 * gets zero-width spaces appended: the heading reads exactly the same and
 * every section keeps its own identity.
 */
export function distinctSectionLabels<T extends { label?: string }>(sections: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return sections.map((s) => {
    if (!s.label) return s;
    const n = seen.get(s.label) ?? 0;
    seen.set(s.label, n + 1);
    return n === 0 ? s : { ...s, label: `${s.label}${"​".repeat(n)}` };
  });
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
