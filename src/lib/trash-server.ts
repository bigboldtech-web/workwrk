// Reading the one Trash: both tabs, every source, scoped to what the viewer
// may actually restore.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// THREE THINGS CHANGE HERE, AND EACH ONE WAS A BUG.
//
// 1. THE GATE. `GET /api/trash` was `isManager`, so a plain Member who deleted
//    their own list got "Trash is for managers" and had to find a manager to
//    get it back (work-tasks #11). It is Full access on the row's own node or
//    its container, from the one node-access resolver over ONE world for the
//    rows on the page, plus "rows you deleted yourself", with Owner and Admin
//    over the org. The sets narrow; nobody sees more than before.
//
// 2. THE ARCHIVED HALF. The route read `TrashItem` snapshots plus archived
//    Docs, Canvases and Contracts, and nothing else. Archiving a Space, a
//    Folder, a List or a task put it somewhere with no page at all, while the
//    task detail's own copy said "You can restore it from Trash". Archived rows
//    are the second tab, and that sentence is true.
//
// 3. THE READ NO LONGER DELETES. The old GET ran purgeExpiredTrash plus three
//    deleteMany calls before it answered, so opening the page destroyed rows
//    and a second caller (a poll, a prefetch) doubled the destruction. The
//    purge is a cron row now (scripts/CRON-SETUP.md).
//
// Server-only: imports prisma and the node-access resolver.

import { prisma } from "./prisma";
import type { Viewer } from "./access/types";
import { nodeCtxFromViewer, nodeRole, nodeRoles } from "./access/node-access";
import { NodeEvaluator, createDecision, refKey, roleAtLeast, type NodeRef, type Place, type PlaceKind } from "./access/node-rules";
import { loadWorld } from "./access/node-world";
import { canvasesHaveFolders, checkCreate, checkFormDestination, docPlaceLive, folderPlacementFact } from "./access/node-placement";
import { canCreateDocAt } from "./access/node-access";
import { freeTrashStorage, restoreFromTrash } from "./trash";
import {
  DEFAULT_TRASH_DAYS,
  TRASH_TYPE_BY_KEY,
  archiveRowId,
  daysLeft,
  isExpiringSoon,
  parseRowId,
  retentionDays,
  typeKeyFor,
  type TrashSort,
  type TrashTab,
  type TrashTypeKey,
} from "./trash-view";
import { trashClockStart, trashPurgeOn } from "@/lib/purge-jobs";

export interface TrashRow {
  id: string;
  type: TrashTypeKey | null;
  /**
   * The id of the OBJECT, which is not the row id: on the Deleted tab `id` is
   * the TrashItem's. It is what `trashHref` (src/lib/trash.ts) turns into the
   * restored row's own URL, so "Restored X" can offer Open instead of leaving
   * the person to hunt for what just came back.
   */
  entityId: string | null;
  /** The raw stored word, when no type claims it. */
  typeLabel: string;
  name: string;
  /** "Sales › Q4" as plain text, or "Standalone". */
  location: string;
  spaceId: string | null;
  /** `name` is what the CSV prints; the two parts are what the avatar needs. */
  deletedBy: { id: string; name: string; firstName: string | null; lastName: string | null; avatar: string | null } | null;
  deletedAt: string;
  /** null on the Archived tab: archives never expire. */
  daysLeft: number | null;
  /** False when restoring would need the parent back first. */
  restorable: boolean;
  /** The sentence to show beside "Restore to..." when `restorable` is false. */
  blockedReason: string | null;
  /**
   * True when the row CAN come back, but only somewhere else: the List it
   * lived in is gone, so the person picks a new one. The spec's row is "a 32px
   * secondary Restore button per row (or 'Restore to...' opening a
   * MoveTargetDialog when the parent is itself in Trash or gone)", and the
   * second half did not exist: a task whose List was gone was a permanent dead
   * row showing a sentence and no control at all.
   */
  needsTarget: boolean;
}

export interface TrashQuery {
  tab: TrashTab;
  /** Empty means every type. More than one is a union, filtered here so the
   *  total and the paging are over the same set the table shows. */
  types: TrashTypeKey[];
  q: string | null;
  /** Empty means every person. A list, like `types`, so the panel's checkboxes
   *  narrow the whole set rather than the page the browser is holding. */
  deletedBy: string[];
  /** Empty means every Space. */
  spaceId: string[];
  /** "Time left": only rows inside the last week of the retention window. */
  expiringSoon: boolean;
  sort: TrashSort;
  cursor: number;
  limit: number;
}

/**
 * The values the Filter panel may offer, counted over the rows this viewer can
 * see on this tab and BEFORE the panel's own choices are applied, so checking
 * one person does not make every other person disappear from the list.
 *
 * The panel used to offer Type alone while the route had always accepted
 * `deletedBy` and `spaceId`: two filters reachable only by hand-editing a URL.
 */
export interface TrashFacets {
  people: Array<{ id: string; name: string; avatar: string | null; count: number }>;
  locations: Array<{ id: string; name: string; count: number }>;
  expiringSoon: number;
}

export interface TrashPage {
  rows: TrashRow[];
  total: number;
  nextCursor: number | null;
  retentionDays: number;
  /** Owner and Admin only: Delete permanently, Empty trash, Export. */
  canPurge: boolean;
  /**
   * True when a source hit its read cap, so `total` is a floor rather than the
   * truth and rows past the cap are not on this page at all. The footer says
   * so: a capped list that looks complete is the same lie the old 500-row
   * "500+" cap told on /everything.
   */
  capped: boolean;
  facets: TrashFacets;
}

/**
 * Owner or Admin, read off the Viewer's orgRole.
 *
 * NOT named `isOrgAdmin`: that is one of the retired tier predicates the G7
 * lint bans by name (eslint.config.mjs), and a local helper borrowing the name
 * made this file read like a call into the old tier world. It is the check the
 * rule's own message points at ("useViewer().orgRole"), under a name that says
 * so.
 */
function viewerIsOwnerOrAdmin(viewer: Viewer): boolean {
  return viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
}

/** The org's retention window, tolerating the setting being absent. */
export async function trashRetentionDays(organizationId: string): Promise<number> {
  const org = await prisma.organization
    .findUnique({ where: { id: organizationId }, select: { settings: true } })
    .catch(() => null);
  const settings = (org?.settings ?? {}) as { retention?: { trashDays?: unknown } };
  return retentionDays(settings.retention?.trashDays ?? DEFAULT_TRASH_DAYS);
}

/**
 * What the viewer may see and restore, as id sets: the Spaces, Folders,
 * Lists, Tables and Canvases among the candidates on which they hold Full
 * access. The other types have no node of their own in the resolver, so for
 * those the rule is the narrow half alone: rows the viewer deleted. Narrow is
 * the safe direction.
 */
export interface TrashScope {
  all: boolean;
  userId: string;
  spaces: Set<string>;
  folders: Set<string>;
  lists: Set<string>;
  tables: Set<string>;
  canvases: Set<string>;
}

/** The node ids a page of Trash rows names: their own ids and their anchors. */
export interface TrashCandidates {
  spaces: Set<string>;
  folders: Set<string>;
  lists: Set<string>;
  tables: Set<string>;
  canvases: Set<string>;
}

function candidatesOf(rows: Array<{ anchor: { spaceId?: string | null; folderId?: string | null; boardId?: string | null }; ownId?: string | null; type: TrashTypeKey | null }>): TrashCandidates {
  const c: TrashCandidates = { spaces: new Set(), folders: new Set(), lists: new Set(), tables: new Set(), canvases: new Set() };
  for (const r of rows) {
    if (r.anchor.spaceId) c.spaces.add(r.anchor.spaceId);
    if (r.anchor.folderId) c.folders.add(r.anchor.folderId);
    if (r.anchor.boardId) c.lists.add(r.anchor.boardId);
    if (!r.ownId) continue;
    if (r.type === "space") c.spaces.add(r.ownId);
    else if (r.type === "folder") c.folders.add(r.ownId);
    else if (r.type === "list") c.lists.add(r.ownId);
    else if (r.type === "table") c.tables.add(r.ownId);
    else if (r.type === "canvas") c.canvases.add(r.ownId);
  }
  return c;
}

export async function trashScope(viewer: Viewer, candidates: TrashCandidates): Promise<TrashScope> {
  if (viewerIsOwnerOrAdmin(viewer)) {
    return { all: true, userId: viewer.userId, spaces: new Set(), folders: new Set(), lists: new Set(), tables: new Set(), canvases: new Set() };
  }
  const refs: NodeRef[] = [
    ...[...candidates.spaces].map((id) => ({ kind: "space" as const, id })),
    ...[...candidates.folders].map((id) => ({ kind: "folder" as const, id })),
    ...[...candidates.lists].map((id) => ({ kind: "list" as const, id })),
    ...[...candidates.tables].map((id) => ({ kind: "table" as const, id })),
    ...[...candidates.canvases].map((id) => ({ kind: "canvas" as const, id })),
  ];
  // ONE world for every node the rows name, never a gate call per row.
  const decisions = await nodeRoles(nodeCtxFromViewer(viewer), refs);
  const full = (ref: NodeRef) => roleAtLeast(decisions.get(refKey(ref))?.role ?? "none", "FULL");
  const keep = (kind: NodeRef["kind"], ids: Set<string>) => new Set([...ids].filter((id) => full({ kind, id })));
  return {
    all: false,
    userId: viewer.userId,
    spaces: keep("space", candidates.spaces),
    folders: keep("folder", candidates.folders),
    lists: keep("list", candidates.lists),
    tables: keep("table", candidates.tables),
    canvases: keep("canvas", candidates.canvases),
  };
}

/** Does this scope let the viewer act on a row anchored to these ids? */
function inScope(
  scope: TrashScope,
  anchor: { spaceId?: string | null; folderId?: string | null; boardId?: string | null; ownId?: string | null; type: TrashTypeKey | null },
  deletedById: string | null,
  /** The row's owner. Separate from `deletedById` so the column and the gate
   *  can disagree: naming an archiver you did not record is a lie, but an
   *  owner still gets their own archived row back. */
  ownerId: string | null = null,
): boolean {
  if (scope.all) return true;
  // You can always get back what you threw away, and you can always get back
  // what is yours.
  if (deletedById && deletedById === scope.userId) return true;
  if (ownerId && ownerId === scope.userId) return true;
  if (anchor.type === "space" && anchor.ownId && scope.spaces.has(anchor.ownId)) return true;
  if (anchor.type === "folder" && anchor.ownId && scope.folders.has(anchor.ownId)) return true;
  if (anchor.type === "list" && anchor.ownId && scope.lists.has(anchor.ownId)) return true;
  if (anchor.type === "table" && anchor.ownId && scope.tables.has(anchor.ownId)) return true;
  if (anchor.type === "canvas" && anchor.ownId && scope.canvases.has(anchor.ownId)) return true;
  if (anchor.boardId && scope.lists.has(anchor.boardId)) return true;
  if (anchor.folderId && scope.folders.has(anchor.folderId)) return true;
  if (anchor.spaceId && scope.spaces.has(anchor.spaceId)) return true;
  return false;
}

type SnapshotShape = { row?: Record<string, unknown> } | null;

/** A Doc's `entityType`/`entityId` pair as the anchor shape everything else uses. */
function docAnchor(entityType: string | null, entityId: string | null): { spaceId: string | null; folderId: string | null; boardId: string | null } {
  const none = { spaceId: null, folderId: null, boardId: null };
  if (!entityType || !entityId) return none;
  switch (entityType) {
    case "SPACE": return { ...none, spaceId: entityId };
    case "FOLDER": return { ...none, folderId: entityId };
    case "BOARD": return { ...none, boardId: entityId };
    default: return none;
  }
}

function snapshotAnchor(snapshot: unknown): { spaceId: string | null; folderId: string | null; boardId: string | null } {
  const row = (snapshot as SnapshotShape)?.row ?? {};
  const pick = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : null);
  return { spaceId: pick("spaceId"), folderId: pick("folderId"), boardId: pick("boardId") };
}

/* ─────────────────────────── location names ─────────────────────────── */

interface NameMaps {
  spaces: Map<string, string>;
  folders: Map<string, string>;
  boards: Map<string, string>;
}

async function loadNames(ids: { spaces: Set<string>; folders: Set<string>; boards: Set<string> }): Promise<NameMaps> {
  const [spaces, folders, boards] = await Promise.all([
    ids.spaces.size ? prisma.space.findMany({ where: { id: { in: [...ids.spaces] } }, select: { id: true, name: true } }) : [],
    ids.folders.size ? prisma.folder.findMany({ where: { id: { in: [...ids.folders] } }, select: { id: true, name: true } }) : [],
    ids.boards.size ? prisma.board.findMany({ where: { id: { in: [...ids.boards] } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    spaces: new Map(spaces.map((s) => [s.id, s.name])),
    folders: new Map(folders.map((f) => [f.id, f.name])),
    boards: new Map(boards.map((b) => [b.id, b.name])),
  };
}

function locationOf(names: NameMaps, anchor: { spaceId: string | null; folderId: string | null; boardId: string | null }): string {
  const parts = [
    anchor.spaceId ? names.spaces.get(anchor.spaceId) : null,
    anchor.folderId ? names.folders.get(anchor.folderId) : null,
    anchor.boardId ? names.boards.get(anchor.boardId) : null,
  ].filter((x): x is string => Boolean(x));
  // A row whose whole chain is gone is honestly standalone, not "unknown".
  return parts.length ? parts.join(" › ") : "Standalone";
}

/**
 * Is `archivedById` there yet?
 *
 * Every reader has to tolerate a new column being absent for one release
 * (prisma/sql/2026-09-19-archived-by.sql is applied by the founder, not by a
 * deploy). Asking the catalogue once per process is cheaper than letting a
 * failed select take the whole Trash page down, and the false answer degrades
 * one column rather than the page.
 */
let archivedByColumn: boolean | null = null;
async function archivedByColumnAvailable(): Promise<boolean> {
  if (archivedByColumn !== null) return archivedByColumn;
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n
      FROM information_schema.columns
      WHERE table_name IN ('Space', 'Agreement') AND column_name = 'archivedById'
    `;
    // Both must be there. Space's column ships in
    // prisma/sql/2026-09-19-archived-by.sql and Agreement's in
    // prisma/sql/2026-09-21-agreement-archived-by.sql, so a database can hold
    // one and not the other. Asking for a column that is not there fails the
    // whole read, and the fallback shape is per-read, not per-table, so the
    // honest probe is "are all of them here".
    archivedByColumn = Number(rows[0]?.n ?? 0) >= 2;
  } catch {
    archivedByColumn = false;
  }
  return archivedByColumn;
}

/* ──────────────────────────── the read ──────────────────────────── */

interface RawRow {
  id: string;
  type: TrashTypeKey | null;
  typeLabel: string;
  name: string;
  anchor: { spaceId: string | null; folderId: string | null; boardId: string | null };
  ownId: string | null;
  /**
   * The person the row NAMES as having removed it. On the Deleted tab that is
   * the recorded deleter; on the Archived tab it is `archivedById`, which is
   * null for anything archived before that column existed. Null renders a
   * blank cell; it never falls back to the owner (see `scopeOwnerId`).
   */
  deletedById: string | null;
  deletedByName: string | null;
  /**
   * The row's OWNER, used only to decide who may act on it, never to fill the
   * "Archived by" column. Collapsing the two is what made the page print the
   * owner's name and avatar under a heading that claims an action.
   */
  scopeOwnerId: string | null;
  deletedAt: Date;
  /**
   * Where the row comes back to, as the restore's landing check reads it
   * (archiveLanding, snapshotLanding): the container and what the row is
   * there, or null when the restore asks nothing of a place. The listing
   * answers `restorable` from it, so the page offers Restore exactly where
   * the route would restore (P5 for Trash).
   */
  landing: TrashLanding | null;
}

/** A row's landing: the place it comes back into and what it is there ("task" for a task on its List). */
type TrashLanding = { place: Place; what: PlaceKind | "task" };

export async function readTrash(viewer: Viewer, query: TrashQuery): Promise<TrashPage> {
  const orgId = viewer.organizationId;
  const [{ rows: raw, capped }, days] = await Promise.all([
    query.tab === "deleted" ? readDeleted(orgId) : readArchived(orgId),
    trashRetentionDays(orgId),
  ]);
  const scope = await trashScope(viewer, candidatesOf(raw));

  // Scope, then filter, then sort, then page. Scoping first is what makes the
  // total honest: a count over rows the viewer cannot see is not their total.
  const visible = raw.filter((r) =>
    inScope(scope, { ...r.anchor, ownId: r.ownId, type: r.type }, r.deletedById, r.scopeOwnerId),
  );

  const ids = { spaces: new Set<string>(), folders: new Set<string>(), boards: new Set<string>() };
  for (const r of visible) {
    if (r.anchor.spaceId) ids.spaces.add(r.anchor.spaceId);
    if (r.anchor.folderId) ids.folders.add(r.anchor.folderId);
    if (r.anchor.boardId) ids.boards.add(r.anchor.boardId);
  }
  const names = await loadNames(ids);

  // Nothing expires while nothing empties Trash (src/lib/purge-jobs.ts), and
  // a row's window starts no earlier than the day the purge was turned on.
  const purges = trashPurgeOn();
  const soon = (r: RawRow): boolean =>
    purges && query.tab === "deleted" && isExpiringSoon(daysLeft(trashClockStart(r.deletedAt), days));

  const q = query.q?.trim().toLowerCase() ?? "";
  const filtered = visible.filter((r) => {
    if (query.types.length && !(r.type && query.types.includes(r.type))) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (query.deletedBy.length && !(r.deletedById && query.deletedBy.includes(r.deletedById))) return false;
    if (query.spaceId.length && !(r.anchor.spaceId && query.spaceId.includes(r.anchor.spaceId))) return false;
    if (query.expiringSoon && !soon(r)) return false;
    return true;
  });

  const facets = await trashFacets(orgId, visible, names, soon);

  filtered.sort((a, b) => {
    if (query.sort === "name") return a.name.localeCompare(b.name);
    // Time left is the deletion order read the other way round.
    if (query.sort === "expiry") return a.deletedAt.getTime() - b.deletedAt.getTime();
    return b.deletedAt.getTime() - a.deletedAt.getTime();
  });

  const total = filtered.length;
  const page = filtered.slice(query.cursor, query.cursor + query.limit);
  const actorIds = [...new Set(page.map((r) => r.deletedById).filter((x): x is string => Boolean(x)))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds }, organizationId: orgId },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  // A task whose List is gone cannot come back: the row it would go in does
  // not exist. Saying so beats a Restore button that 409s. And a row the
  // viewer may not restore where it now lands (the placement rule P1, the
  // same check the restore runs) says so too, instead of offering a Restore
  // the route refuses (round four, break 3).
  const [missingParents, landingBlocked] = await Promise.all([missingParentIds(page), landingRefusals(viewer, page)]);

  const rows: TrashRow[] = page.map((r) => {
    const actor = r.deletedById ? actorById.get(r.deletedById) : null;
    const listState = missingParents.get(r.id) ?? null;
    const parentGone = listState !== null;
    const blocked = landingBlocked.get(r.id) ?? null;
    return {
      id: r.id,
      type: r.type,
      entityId: r.ownId,
      typeLabel: r.type ? TRASH_TYPE_BY_KEY[r.type].label : r.typeLabel,
      name: r.name,
      location: locationOf(names, r.anchor),
      spaceId: r.anchor.spaceId,
      deletedBy: actor
        ? {
            id: actor.id,
            name: `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || "Someone",
            firstName: actor.firstName,
            lastName: actor.lastName,
            avatar: actor.avatar,
          }
        : r.deletedByName
          ? // The snapshot froze a name at delete time; the person may since
            // have left, which is exactly when that frozen name is the only
            // answer there is.
            { id: r.deletedById ?? "", name: r.deletedByName, firstName: r.deletedByName, lastName: null, avatar: null }
          : null,
      deletedAt: r.deletedAt.toISOString(),
      // No countdown while nothing empties Trash (src/lib/purge-jobs.ts):
      // "N days left" promised a deletion that never came.
      daysLeft: query.tab === "archived" || !purges ? null : daysLeft(trashClockStart(r.deletedAt), days),
      restorable: !parentGone && !blocked,
      // A task is the one row that can be re-homed: its snapshot carries a
      // boardId, and any List the viewer may write to will hold it. An
      // archived task (no snapshot) comes back in place or not at all, so
      // with its List in Trash it says so instead of offering a new home.
      needsTarget: r.type === "task" && (listState === "gone" || (listState === "archived" && parseRowId(r.id).archive === null)),
      blockedReason: listState === "gone" ? "Its list is gone" : listState === "archived" ? LIST_IN_TRASH_FOR_TASK : blocked,
    };
  });

  return {
    rows,
    total,
    nextCursor: query.cursor + query.limit < total ? query.cursor + query.limit : null,
    retentionDays: days,
    canPurge: viewerIsOwnerOrAdmin(viewer),
    capped,
    facets,
  };
}

/** The Filter panel's people, Spaces and "under 7 days" count. */
async function trashFacets(
  organizationId: string,
  visible: RawRow[],
  names: Awaited<ReturnType<typeof loadNames>>,
  soon: (r: RawRow) => boolean,
): Promise<TrashFacets> {
  const byPerson = new Map<string, { name: string | null; count: number }>();
  const byLocation = new Map<string, number>();
  let expiring = 0;
  for (const r of visible) {
    if (r.deletedById) {
      const prev = byPerson.get(r.deletedById);
      byPerson.set(r.deletedById, { name: prev?.name ?? r.deletedByName, count: (prev?.count ?? 0) + 1 });
    }
    if (r.anchor.spaceId) byLocation.set(r.anchor.spaceId, (byLocation.get(r.anchor.spaceId) ?? 0) + 1);
    if (soon(r)) expiring++;
  }
  const personIds = [...byPerson.keys()];
  const users = personIds.length
    ? await prisma.user.findMany({
        where: { id: { in: personIds }, organizationId },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  return {
    people: personIds
      .map((id) => {
        const u = userById.get(id);
        const frozen = byPerson.get(id)?.name ?? null;
        // A person who has left the org keeps the name the snapshot froze; a
        // row with neither is dropped rather than offered as a blank option.
        const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || frozen : frozen;
        if (!name) return null;
        return { id, name, avatar: u?.avatar ?? null, count: byPerson.get(id)?.count ?? 0 };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .sort((a, b) => b.count - a.count),
    locations: [...byLocation.entries()]
      .map(([id, count]) => ({ id, name: names.spaces.get(id) ?? "Space", count }))
      .sort((a, b) => b.count - a.count),
    expiringSoon: expiring,
  };
}

/** How many rows one source is read at a time. See `TrashPage.capped`. */
const SOURCE_CAP = 2000;

/** Deleted tab: the TrashItem snapshots. */
async function readDeleted(organizationId: string): Promise<{ rows: RawRow[]; capped: boolean }> {
  const snaps = await prisma.trashItem.findMany({
    where: { organizationId },
    orderBy: { deletedAt: "desc" },
    take: SOURCE_CAP + 1,
    select: { id: true, entityType: true, entityId: true, label: true, snapshot: true, deletedById: true, deletedByName: true, deletedAt: true },
  });
  const capped = snaps.length > SOURCE_CAP;
  const rows = snaps.slice(0, SOURCE_CAP).map((s) => {
    const type = typeKeyFor(s.entityType);
    return {
      id: s.id,
      type,
      typeLabel: s.entityType,
      name: s.label || "Untitled",
      anchor: snapshotAnchor(s.snapshot),
      ownId: s.entityId,
      deletedById: s.deletedById,
      deletedByName: s.deletedByName,
      // A snapshot's deleter IS its actor; there is no second person.
      scopeOwnerId: s.deletedById,
      deletedAt: s.deletedAt,
      landing: snapshotLandingOf(s.entityType, s.snapshot),
    };
  });
  return { rows, capped };
}

/** Where a snapshot row comes back to, as snapshotLanding reads it. */
function snapshotLandingOf(entityType: string, snapshot: unknown): TrashLanding | null {
  const row = ((snapshot as SnapshotShape)?.row ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof row[k] === "string" && row[k] ? (row[k] as string) : null);
  const inTree = (folder: string | null, space: string | null): Place => (folder ? { kind: "folder", id: folder } : space ? { kind: "space", id: space } : null);
  switch (entityType) {
    case "folder": {
      const place = inTree(str("parentFolderId"), str("spaceId"));
      return place ? { place, what: "folder" } : null;
    }
    case "board": {
      const place = inTree(str("folderId"), str("spaceId"));
      return place ? { place, what: "list" } : null;
    }
    case "whiteboard":
      return { place: inTree(str("folderId"), str("spaceId")), what: "canvas" };
    case "table": {
      const space = str("spaceId");
      return { place: space ? { kind: "space", id: space } : null, what: "table" };
    }
    case "item": {
      const board = str("boardId");
      return board ? { place: { kind: "list", id: board }, what: "task" } : null;
    }
    case "note":
      return docLandingOf({ entityType: str("entityType"), entityId: str("entityId"), parentId: str("parentId"), boardId: null });
    case "file":
      return { place: inTree(str("spaceFolderId"), str("spaceId")), what: "file" };
    case "form": {
      const board = str("targetBoardId");
      const table = str("targetTableId");
      return board ? { place: { kind: "list", id: board }, what: "form" } : table ? { place: { kind: "table", id: table }, what: "form" } : null;
    }
    default:
      return null;
  }
}

/**
 * Where a doc comes back to: its parent page, else its anchor (a task's doc
 * onto the task's List, `boardId` when the read resolved it). A note, a doc
 * pinned to a task this read did not resolve, and any other anchor type ask
 * nothing here; the restore itself still runs docLanding.
 */
function docLandingOf(d: { entityType: string | null; entityId: string | null; parentId: string | null; boardId: string | null }): TrashLanding | null {
  if (d.entityType === "NOTEPAD") return null;
  if (d.parentId) return { place: { kind: "doc", id: d.parentId }, what: "doc" };
  if (!d.entityType || !d.entityId) return { place: null, what: "doc" };
  switch (d.entityType) {
    case "SPACE": return { place: { kind: "space", id: d.entityId }, what: "doc" };
    case "FOLDER": return { place: { kind: "folder", id: d.entityId }, what: "doc" };
    case "BOARD": return { place: { kind: "list", id: d.entityId }, what: "doc" };
    case "BOARD_ITEM": return d.boardId ? { place: { kind: "list", id: d.boardId }, what: "doc" } : null;
    default: return null;
  }
}

/**
 * The rows on this page the restore would refuse where they now land, with
 * the sentence it would answer. First the place itself, for everyone: a
 * Folder, Space or parent page that is gone or in Trash refuses the restore
 * whoever asks (landingCheck, docLanding), an org admin included. Then, for
 * a viewer who is not an org owner or admin, P1 on the container as it is
 * now (landingCheck), over ONE world for the whole page. A List a task or a
 * form comes back to is not blocked here: a task's is missingParentIds
 * (Restore to...), a form's is no write at all (formLanding). Round six, item
 * 2: the page offered Restore for a sub-folder whose parent Folder was
 * itself in Trash, and the restore answered 409.
 */
async function landingRefusals(viewer: Viewer, page: readonly RawRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const landed = page.filter((r): r is RawRow & { landing: TrashLanding } => r.landing !== null);
  if (!landed.length) return out;
  const gone = await landingPlaceBlocks(viewer.organizationId, landed);
  for (const r of landed) {
    const { place, what } = r.landing;
    if (!place || (place.kind === "list" && what !== "doc")) continue;
    const why = gone.get(refKey(place));
    if (why) out.set(r.id, why);
  }
  if (viewerIsOwnerOrAdmin(viewer)) return out;
  const places = new Map<string, NodeRef>();
  for (const r of landed) if (r.landing.place && !out.has(r.id)) places.set(refKey(r.landing.place), r.landing.place);
  const { rows, grants } = await loadWorld(nodeCtxFromViewer(viewer), [...places.values()], { chain: true });
  const ev = new NodeEvaluator(rows, grants);
  for (const r of landed) {
    if (out.has(r.id)) continue;
    const { place, what } = r.landing;
    if (place?.kind === "folder" && !rows.folders.has(place.id)) continue;
    if (place?.kind === "space" && !rows.spaces.has(place.id)) continue;
    if (place?.kind === "list" && !rows.lists.has(place.id)) continue;
    if (place?.kind === "table" && !rows.tables.has(place.id)) continue;
    if (place?.kind === "doc" && !rows.docs.has(place.id)) continue;
    const ok = what === "task"
      ? roleAtLeast(ev.effective(place as NodeRef).role, "EDIT")
      : createDecision(rows, grants, place, what);
    if (!ok) out.set(r.id, CANT_RESTORE_HERE);
  }
  return out;
}

const FOLDER_GONE = "The folder it lived in is gone.";
const SPACE_ARCHIVED = "The Space it lived in is archived. Restore that Space first.";
const SPACE_GONE = "The Space it lived in is gone.";
const LIST_GONE_FOR_DOC = "The List it lived in is gone or in Trash. Restore that List first.";
const PAGE_GONE = "The page it lived in is gone or in Trash. Restore that page first.";

/**
 * The landing places on this page that are gone or in Trash, keyed by
 * refKey, each with the sentence the restore answers: a Folder that is gone
 * (in Trash when a snapshot of it is there, to restore first) or in Trash
 * with any Folder above it (folderPlacementFact, as landingCheck reads it),
 * a Space that is gone or archived, a List a doc lived on that is gone or
 * archived, and a parent page that is gone or in Trash (docPlaceLive). One
 * query per kind for the whole page.
 */
async function landingPlaceBlocks(organizationId: string, landed: ReadonlyArray<RawRow & { landing: TrashLanding }>): Promise<Map<string, string>> {
  const ids = { folder: new Set<string>(), space: new Set<string>(), list: new Set<string>(), doc: new Set<string>() };
  for (const r of landed) {
    const p = r.landing.place;
    if (!p) continue;
    if (p.kind === "folder") ids.folder.add(p.id);
    else if (p.kind === "space") ids.space.add(p.id);
    else if (p.kind === "list" && r.landing.what === "doc") ids.list.add(p.id);
    else if (p.kind === "doc") ids.doc.add(p.id);
  }
  const out = new Map<string, string>();
  const [folders, spaces, lists, docs] = await Promise.all([
    Promise.all([...ids.folder].map(async (id) => [id, await folderPlacementFact(organizationId, id)] as const)),
    ids.space.size ? prisma.space.findMany({ where: { id: { in: [...ids.space] }, organizationId }, select: { id: true, archivedAt: true } }) : Promise.resolve([]),
    ids.list.size ? prisma.board.findMany({ where: { id: { in: [...ids.list] }, organizationId }, select: { id: true, archivedAt: true } }) : Promise.resolve([]),
    ids.doc.size ? prisma.doc.findMany({ where: { id: { in: [...ids.doc] }, organizationId }, select: { id: true, archivedAt: true } }) : Promise.resolve([]),
  ]);
  const goneFolders = folders.filter(([, f]) => !f).map(([id]) => id);
  const trashedFolders = new Set(
    goneFolders.length
      ? (await prisma.trashItem.findMany({ where: { organizationId, entityType: "folder", entityId: { in: goneFolders } }, select: { entityId: true } })).map((t) => t.entityId)
      : [],
  );
  for (const [id, f] of folders) {
    if (!f) out.set(refKey({ kind: "folder", id }), trashedFolders.has(id) ? PARENT_IN_TRASH : FOLDER_GONE);
    else if (f.inTrash) out.set(refKey({ kind: "folder", id }), PARENT_IN_TRASH);
  }
  const spaceById = new Map(spaces.map((s) => [s.id, s] as const));
  for (const id of ids.space) {
    const s = spaceById.get(id);
    if (!s) out.set(refKey({ kind: "space", id }), SPACE_GONE);
    else if (s.archivedAt) out.set(refKey({ kind: "space", id }), SPACE_ARCHIVED);
  }
  const listById = new Map(lists.map((l) => [l.id, l] as const));
  for (const id of ids.list) {
    const l = listById.get(id);
    if (!l || l.archivedAt) out.set(refKey({ kind: "list", id }), LIST_GONE_FOR_DOC);
  }
  const docById = new Map(docs.map((d) => [d.id, d] as const));
  for (const id of ids.doc) {
    const d = docById.get(id);
    if (!d || d.archivedAt) out.set(refKey({ kind: "doc", id }), PAGE_GONE);
  }
  return out;
}

/**
 * Archived tab: everything carrying `archivedAt`, across seven tables.
 *
 * "ARCHIVED BY" NAMES THE ARCHIVER OR NOBODY. `archivedById` is a nullable
 * column added in prisma/sql/2026-09-19-archived-by.sql; before it existed the
 * page filled that column with the object's OWNER and drew that person's
 * avatar, so a Space owned by Alice and archived by Bob read "Archived by
 * Alice". The owner still travels, as `scopeOwnerId`, because owning a row is
 * what lets you restore it, but it never reaches the column.
 *
 * The column may be absent for one release: the select runs inside a try and
 * falls back to a shape without it, which reads as "no recorded archiver" and
 * degrades the attribution, never the page.
 */
async function readArchived(organizationId: string): Promise<{ rows: RawRow[]; capped: boolean }> {
  // TOLERATING THE COLUMN BEING ABSENT, FOR REAL.
  //
  // `archivedById` ships as prisma/sql/2026-09-19-archived-by.sql, which the
  // founder applies. Two things can therefore be behind: the DATABASE (before
  // the file is run) and the generated CLIENT (a process started before
  // `prisma generate`). The catalogue check catches the first; only actually
  // trying the select catches the second, and a select the client rejects is a
  // 500 on the whole Trash page. So the read asks for the column, and on ANY
  // failure asks again without it. The fallback loses one column's
  // attribution, never the page.
  const [archivedBy, canvasFolders] = await Promise.all([archivedByColumnAvailable(), canvasesHaveFolders()]);
  const read = async (withActor: { archivedById: true } | Record<string, never>) => Promise.all([
    prisma.space.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, ownerId: true, ...withActor } }),
    prisma.folder.findMany({ where: { archivedAt: { not: null }, space: { organizationId } }, select: { id: true, name: true, archivedAt: true, spaceId: true, parentFolderId: true, ownerId: true, ...withActor } }),
    prisma.board.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, spaceId: true, folderId: true, ownerId: true, ...withActor } }),
    prisma.item.findMany({ where: { organizationId, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: SOURCE_CAP + 1, select: { id: true, title: true, archivedAt: true, boardId: true, ownerId: true, ...withActor } }),
    // entityType/entityId is the Doc's anchor. Reading it lets inScope apply
    // the SAME Space/Folder/List rules it applies to everything else, so a
    // Member with Full access on the Space an archived Doc lives in can see
    // and restore it. Without the anchor every archived Doc fell through to
    // "rows you deleted yourself", which was narrower than the /docs/trash
    // page this replaced. A doc with no anchor still has none: there is no
    // per-doc ACL to widen it with, and org-wide would be wider than the rule.
    prisma.doc.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, title: true, archivedAt: true, createdById: true, entityType: true, entityId: true, parentId: true, ...withActor } }),
    // A canvas comes back into its Folder when the column exists (node-placement canvasesHaveFolders).
    prisma.whiteboard.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, spaceId: true, ownerId: true, ...(canvasFolders ? { folderId: true } : {}), ...withActor } }),
    prisma.agreement.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, title: true, isTemplate: true, archivedAt: true, ...withActor } }),
  ]);

  type Archived = Awaited<ReturnType<typeof read>>;
  let rowsets: Archived;
  if (archivedBy) {
    try {
      rowsets = await read({ archivedById: true });
    } catch {
      // A client that predates the column. Degrade the attribution, keep the
      // page, and stop asking for the column for the rest of this process.
      archivedByColumn = false;
      rowsets = await read({});
    }
  } else {
    rowsets = await read({});
  }
  const [spaces, folders, boards, items, docs, canvases, contracts] = rowsets;

  /** The recorded archiver, or null while the column is not there yet. */
  const actor = (row: object): string | null => {
    const v = (row as { archivedById?: unknown }).archivedById;
    return typeof v === "string" ? v : null;
  };

  const boardSpace = new Map(boards.map((b) => [b.id, b.spaceId] as const));
  const none = { spaceId: null, folderId: null, boardId: null };

  // A Doc pinned to a TASK is anchored to that task's List once removed. The
  // anchor table only knew SPACE, FOLDER and BOARD, so a BOARD_ITEM doc fell
  // through to "rows you deleted yourself" even for someone holding Full
  // access on the List it lives in. One lookup resolves the whole batch; a
  // task that is itself gone leaves the doc anchorless, as it was.
  const pinnedItemIds = [
    ...new Set(docs.filter((d) => d.entityType === "BOARD_ITEM" && d.entityId).map((d) => d.entityId as string)),
  ];
  const itemBoard = pinnedItemIds.length
    ? new Map(
        (await prisma.item.findMany({
          where: { id: { in: pinnedItemIds }, organizationId },
          select: { id: true, boardId: true },
        })).map((i) => [i.id, i.boardId] as const),
      )
    : new Map<string, string>();
  const anchorOfDoc = (d: { entityType: string | null; entityId: string | null }) => {
    if (d.entityType === "BOARD_ITEM" && d.entityId) {
      const boardId = itemBoard.get(d.entityId) ?? null;
      return boardId ? { spaceId: boardSpace.get(boardId) ?? null, folderId: null, boardId } : none;
    }
    return docAnchor(d.entityType, d.entityId);
  };
  const canvasFolderOf = (w: object): string | null => {
    const v = (w as { folderId?: unknown }).folderId;
    return typeof v === "string" && v ? v : null;
  };
  const inTree = (folder: string | null, space: string | null): Place => (folder ? { kind: "folder", id: folder } : space ? { kind: "space", id: space } : null);

  const out: RawRow[] = [
    ...spaces.map((s) => ({ id: archiveRowId("space", s.id), type: "space" as const, typeLabel: "space", name: s.name, anchor: none, ownId: s.id, deletedById: actor(s), deletedByName: null, scopeOwnerId: s.ownerId ?? null, deletedAt: s.archivedAt!, landing: null })),
    ...folders.map((f) => ({ id: archiveRowId("folder", f.id), type: "folder" as const, typeLabel: "folder", name: f.name, anchor: { spaceId: f.spaceId, folderId: null, boardId: null }, ownId: f.id, deletedById: actor(f), deletedByName: null, scopeOwnerId: f.ownerId ?? null, deletedAt: f.archivedAt!, landing: { place: inTree(f.parentFolderId, f.spaceId), what: "folder" as const } })),
    ...boards.map((b) => ({ id: archiveRowId("board", b.id), type: "list" as const, typeLabel: "board", name: b.name, anchor: { spaceId: b.spaceId, folderId: b.folderId, boardId: null }, ownId: b.id, deletedById: actor(b), deletedByName: null, scopeOwnerId: b.ownerId ?? null, deletedAt: b.archivedAt!, landing: b.spaceId ? { place: inTree(b.folderId, b.spaceId), what: "list" as const } : null })),
    ...items.slice(0, SOURCE_CAP).map((i) => ({ id: archiveRowId("item", i.id), type: "task" as const, typeLabel: "item", name: i.title, anchor: { spaceId: boardSpace.get(i.boardId) ?? null, folderId: null, boardId: i.boardId }, ownId: i.id, deletedById: actor(i), deletedByName: null, scopeOwnerId: i.ownerId ?? null, deletedAt: i.archivedAt!, landing: { place: { kind: "list" as const, id: i.boardId }, what: "task" as const } })),
    ...docs.map((d) => ({ id: archiveRowId("doc", d.id), type: "doc" as const, typeLabel: "note", name: d.title || "Untitled doc", anchor: anchorOfDoc(d), ownId: d.id, deletedById: actor(d), deletedByName: null, scopeOwnerId: d.createdById ?? null, deletedAt: d.archivedAt!, landing: docLandingOf({ entityType: d.entityType, entityId: d.entityId, parentId: d.parentId, boardId: anchorOfDoc(d).boardId }) })),
    ...canvases.map((w) => ({ id: archiveRowId("wb", w.id), type: "canvas" as const, typeLabel: "whiteboard", name: w.name || "Untitled canvas", anchor: { spaceId: w.spaceId, folderId: null, boardId: null }, ownId: w.id, deletedById: actor(w), deletedByName: null, scopeOwnerId: w.ownerId ?? null, deletedAt: w.archivedAt!, landing: { place: inTree(canvasFolderOf(w), w.spaceId), what: "canvas" as const } })),
    ...contracts.map((c) => ({
      id: archiveRowId("agr", c.id),
      type: (c.isTemplate ? "template" : "contract") as TrashTypeKey,
      typeLabel: c.isTemplate ? "template" : "contract",
      name: c.title || "Untitled contract",
      anchor: none,
      ownId: c.id,
      deletedById: actor(c),
      deletedByName: null,
      scopeOwnerId: null,
      deletedAt: c.archivedAt!,
      landing: null,
    })),
  ];
  return { rows: out, capped: items.length > SOURCE_CAP };
}

/* ──────────────────────────── the actions ──────────────────────────── */

export type TrashActionResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 409; message: string };

/** Can this viewer act on this row id? Resolved against the same scope the read uses. */
async function gateRow(viewer: Viewer, rowId: string): Promise<TrashActionResult> {
  if (viewerIsOwnerOrAdmin(viewer)) return { ok: true };

  const parsed = parseRowId(rowId);
  if (parsed.archive) {
    const { type, id } = parsed.archive;
    const anchor = await archiveAnchor(type, id, viewer.organizationId);
    if (!anchor) return { ok: false, status: 404, message: "Not found" };
    const scope = await trashScope(viewer, candidatesOf([{ anchor: anchor.anchor, ownId: id, type }]));
    // The recorded archiver arrives in the actor slot and the owner in the
    // owner slot, exactly as readTrash hands them to inScope, so the gate
    // and the listing agree on who may act on an archived row: you can
    // always get back what you archived yourself. The gate once passed null
    // for the actor, so the Archived tab listed a row as restorable for its
    // archiver and the restore refused them (round four, break 3). The
    // owner is never read as though they were the archiver.
    return inScope(scope, { ...anchor.anchor, ownId: id, type }, anchor.archivedById, anchor.ownerId)
      ? { ok: true }
      : { ok: false, status: 403, message: "You need Full access on this to restore it." };
  }

  const snap = await prisma.trashItem.findFirst({
    where: { id: rowId, organizationId: viewer.organizationId },
    select: { entityType: true, entityId: true, snapshot: true, deletedById: true },
  });
  if (!snap) return { ok: false, status: 404, message: "Not found" };
  const type = typeKeyFor(snap.entityType);
  const anchor = snapshotAnchor(snap.snapshot);
  const scope = await trashScope(viewer, candidatesOf([{ anchor, ownId: snap.entityId, type }]));
  return inScope(scope, { ...anchor, ownId: snap.entityId, type }, snap.deletedById)
    ? { ok: true }
    : { ok: false, status: 403, message: "You need Full access on this to restore it." };
}

type ArchiveAnchor = { anchor: { spaceId: string | null; folderId: string | null; boardId: string | null }; ownerId: string | null; archivedById: string | null };

/**
 * An archived row's anchor, owner and recorded archiver, for the gate. The
 * archiver is read the way readArchived reads it: only when `archivedById`
 * is there, and on a client that predates the column the read runs again
 * without it, so the gate degrades to owner and Full access, never to a 500.
 */
async function archiveAnchor(type: TrashTypeKey, id: string, organizationId: string): Promise<ArchiveAnchor | null> {
  if (await archivedByColumnAvailable()) {
    try {
      return await readArchiveAnchor(type, id, organizationId, { archivedById: true });
    } catch {
      archivedByColumn = false;
    }
  }
  return readArchiveAnchor(type, id, organizationId, {});
}

async function readArchiveAnchor(
  type: TrashTypeKey,
  id: string,
  organizationId: string,
  withActor: { archivedById: true } | Record<string, never>,
): Promise<ArchiveAnchor | null> {
  const none = { spaceId: null, folderId: null, boardId: null };
  const actor = (row: object): string | null => {
    const v = (row as { archivedById?: unknown }).archivedById;
    return typeof v === "string" ? v : null;
  };
  switch (type) {
    case "space": {
      const r = await prisma.space.findFirst({ where: { id, organizationId }, select: { ownerId: true, ...withActor } });
      return r ? { anchor: none, ownerId: r.ownerId ?? null, archivedById: actor(r) } : null;
    }
    case "folder": {
      const r = await prisma.folder.findFirst({ where: { id, space: { organizationId } }, select: { spaceId: true, ownerId: true, ...withActor } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: null, boardId: null }, ownerId: r.ownerId ?? null, archivedById: actor(r) } : null;
    }
    case "list": {
      const r = await prisma.board.findFirst({ where: { id, organizationId }, select: { spaceId: true, folderId: true, ownerId: true, ...withActor } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: r.folderId, boardId: null }, ownerId: r.ownerId ?? null, archivedById: actor(r) } : null;
    }
    case "task": {
      const r = await prisma.item.findFirst({ where: { id, organizationId }, select: { boardId: true, ownerId: true, board: { select: { spaceId: true } }, ...withActor } });
      return r ? { anchor: { spaceId: r.board?.spaceId ?? null, folderId: null, boardId: r.boardId }, ownerId: r.ownerId ?? null, archivedById: actor(r) } : null;
    }
    case "doc": {
      const r = await prisma.doc.findFirst({ where: { id, organizationId }, select: { createdById: true, entityType: true, entityId: true, ...withActor } });
      // The same anchor the read uses, so the gate and the list agree on who
      // may restore an archived Doc.
      return r ? { anchor: docAnchor(r.entityType, r.entityId), ownerId: r.createdById ?? null, archivedById: actor(r) } : null;
    }
    case "canvas": {
      const r = await prisma.whiteboard.findFirst({ where: { id, organizationId }, select: { spaceId: true, ownerId: true, ...withActor } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: null, boardId: null }, ownerId: r.ownerId ?? null, archivedById: actor(r) } : null;
    }
    case "contract":
    case "template": {
      const r = await prisma.agreement.findFirst({ where: { id, organizationId }, select: { id: true, ...withActor } });
      return r ? { anchor: none, ownerId: null, archivedById: actor(r) } : null;
    }
    default:
      return null;
  }
}

/**
 * Un-archive in place, or re-create from the snapshot.
 *
 * `targetBoardId` is the "Restore to..." case: the task's own List is gone, so
 * the snapshot's boardId is rewritten to a List the viewer may write to before
 * the row goes back. Without it such a row could never be restored at all.
 */
export async function restoreTrashRow(
  viewer: Viewer,
  rowId: string,
  target?: { targetBoardId?: string | null },
): Promise<TrashActionResult> {
  const gate = await gateRow(viewer, rowId);
  if (!gate.ok) return gate;

  const parsed = parseRowId(rowId);
  if (parsed.archive) {
    const { type, id } = parsed.archive;
    const orgId = viewer.organizationId;
    // An archived row comes back in place: it has no snapshot to point at
    // another List, so a target is refused, not ignored (round seven, item 1).
    if (target?.targetBoardId) {
      return { ok: false, status: 409, message: "An archived task comes back into its own list. Only a task whose list is gone can be restored into another one." };
    }
    // A restore puts the row back INTO its container, so the placement rule
    // holds (node-rules P1): Can edit there now, whoever deleted it or owns
    // it. A grant revoked since never brings it back into the Space.
    const landing = await archiveLanding(viewer, type, id);
    if (!landing.ok) return landing;
    switch (type) {
      case "space": await prisma.space.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      case "folder": await prisma.folder.updateMany({ where: { id, space: { organizationId: orgId } }, data: { archivedAt: null } }); return { ok: true };
      case "list": await prisma.board.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      case "task": await prisma.item.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      case "doc": await prisma.doc.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      case "canvas": await prisma.whiteboard.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      case "contract":
      case "template": await prisma.agreement.updateMany({ where: { id, organizationId: orgId }, data: { archivedAt: null } }); return { ok: true };
      default: return { ok: false, status: 404, message: "Not found" };
    }
  }

  const snap = await prisma.trashItem.findFirst({
    where: { id: rowId, organizationId: viewer.organizationId },
    select: { id: true, entityType: true, snapshot: true },
  });
  if (!snap) return { ok: false, status: 404, message: "Not found" };

  const targetBoardId = target?.targetBoardId ?? null;
  if (!targetBoardId) {
    // The same rule for a row re-created from its snapshot (P1), and P3: a
    // Folder, a List or a canvas comes back in its parent's Space as the
    // parent is now (restoreFromTrash re-derives it).
    const landing = await snapshotLanding(viewer, snap.entityType, snap.snapshot);
    if (!landing.ok) return landing;
  }
  if (targetBoardId) {
    if (snap.entityType !== "item") {
      return { ok: false, status: 409, message: "Only a task can be restored into a different list." };
    }
    // The target has to be a List this viewer may WRITE to, or "Restore to..."
    // would be a way to put a row somewhere you cannot reach.
    const targetList = await prisma.board.findFirst({ where: { id: targetBoardId, organizationId: viewer.organizationId, archivedAt: null }, select: { id: true } });
    const writable = targetList ? roleAtLeast((await nodeRole(nodeCtxFromViewer(viewer), { kind: "list", id: targetList.id })).role, "EDIT") : false;
    if (!writable) {
      return { ok: false, status: 403, message: "You need edit access on that list." };
    }
  }

  try {
    // The snapshot is pointed at the new List INSIDE the restore's
    // transaction, on the row it locks (trash-retarget.ts), so a link parked
    // into it a moment ago is part of what is restored.
    await restoreFromTrash(snap, { targetBoardId });
    return { ok: true };
  } catch {
    // The usual cause is a parent that is itself gone; the page prints the
    // same sentence on the row so this is the stale-tab path, not the norm.
    return { ok: false, status: 409, message: "Couldn't restore. The list or folder it lived in may be gone." };
  }
}

const CANT_RESTORE_HERE = "You need Can edit where this lived to bring it back there.";
const PARENT_IN_TRASH = "The folder it lived in is in Trash. Restore that folder first.";

const PLACE_GONE = "Couldn't restore. The list or folder it lived in may be gone.";

/** P1 for a restore into `place`: ok, or the refusal the Trash page shows. A container that is gone or in Trash is its own sentence. */
async function landingCheck(viewer: Viewer, place: Place, what: PlaceKind): Promise<TrashActionResult> {
  if (place?.kind === "folder") {
    const f = await folderPlacementFact(viewer.organizationId, place.id);
    // A Folder that is gone from the tree but sits in Trash is one to restore
    // first (the listing says the same, landingPlaceBlocks); one that is
    // nowhere is gone.
    if (!f) return { ok: false, status: 409, message: (await folderTrashRow(viewer.organizationId, place.id)) ? PARENT_IN_TRASH : PLACE_GONE };
    if (f.inTrash) return { ok: false, status: 409, message: PARENT_IN_TRASH };
  }
  if (place?.kind === "space") {
    const space = await prisma.space.findFirst({ where: { id: place.id, organizationId: viewer.organizationId }, select: { archivedAt: true } });
    if (!space) return { ok: false, status: 409, message: PLACE_GONE };
    if (space.archivedAt) return { ok: false, status: 409, message: "The Space it lived in is archived. Restore that Space first." };
  }
  const gate = await checkCreate(nodeCtxFromViewer(viewer), place, what);
  return gate.ok ? { ok: true } : { ok: false, status: 403, message: CANT_RESTORE_HERE };
}

/** Is a Folder that is gone from the tree sitting in Trash, as a snapshot the person can restore first? */
async function folderTrashRow(organizationId: string, folderId: string): Promise<boolean> {
  return !!(await prisma.trashItem.findFirst({ where: { organizationId, entityType: "folder", entityId: folderId }, select: { id: true } }));
}

const LIST_IN_TRASH_FOR_TASK = "Its list is in Trash. Restore that list first.";

/** A task comes back into its List: the List live (one in Trash is its own 409), then Can edit on it, the rule every task write reads. A List that is gone is the restore's own 409 (or "Restore to..."). */
async function listLanding(viewer: Viewer, boardId: string | null): Promise<TrashActionResult> {
  if (!boardId) return { ok: true };
  const list = await prisma.board.findFirst({ where: { id: boardId, organizationId: viewer.organizationId }, select: { id: true, archivedAt: true } });
  if (!list) return { ok: true };
  if (list.archivedAt) return { ok: false, status: 409, message: LIST_IN_TRASH_FOR_TASK };
  const role = (await nodeRole(nodeCtxFromViewer(viewer), { kind: "list", id: boardId })).role;
  return roleAtLeast(role, "EDIT") ? { ok: true } : { ok: false, status: 403, message: CANT_RESTORE_HERE };
}

/** A doc comes back to its anchor and its parent page: they must be live, and the viewer able to add docs there. */
async function docLanding(viewer: Viewer, doc: { entityType: string | null; entityId: string | null; parentId: string | null }): Promise<TrashActionResult> {
  if (doc.entityType === "NOTEPAD") return { ok: true };
  if (!(await docPlaceLive(viewer.organizationId, doc))) {
    return { ok: false, status: 409, message: "The place this doc lived in is gone or in Trash, so it can't come back there." };
  }
  const ok = await canCreateDocAt(nodeCtxFromViewer(viewer), { entityType: doc.entityType, entityId: doc.entityId }, doc.parentId);
  return ok ? { ok: true } : { ok: false, status: 403, message: CANT_RESTORE_HERE };
}

/** Where an archived row comes back to, in place, and P1 there. */
async function archiveLanding(viewer: Viewer, type: TrashTypeKey, id: string): Promise<TrashActionResult> {
  const org = viewer.organizationId;
  switch (type) {
    case "folder": {
      const r = await prisma.folder.findFirst({ where: { id, organizationId: org }, select: { spaceId: true, parentFolderId: true } });
      if (!r) return { ok: false, status: 404, message: "Not found" };
      return landingCheck(viewer, r.parentFolderId ? { kind: "folder", id: r.parentFolderId } : { kind: "space", id: r.spaceId }, "folder");
    }
    case "list": {
      const r = await prisma.board.findFirst({ where: { id, organizationId: org }, select: { spaceId: true, folderId: true } });
      if (!r) return { ok: false, status: 404, message: "Not found" };
      if (!r.spaceId) return { ok: true };
      return landingCheck(viewer, r.folderId ? { kind: "folder", id: r.folderId } : { kind: "space", id: r.spaceId }, "list");
    }
    case "task": {
      const r = await prisma.item.findFirst({ where: { id, organizationId: org }, select: { boardId: true } });
      if (!r) return { ok: false, status: 404, message: "Not found" };
      return listLanding(viewer, r.boardId);
    }
    case "doc": {
      const r = await prisma.doc.findFirst({ where: { id, organizationId: org }, select: { entityType: true, entityId: true, parentId: true } });
      if (!r) return { ok: false, status: 404, message: "Not found" };
      return docLanding(viewer, r);
    }
    case "canvas": {
      const folders = await canvasesHaveFolders();
      const r = folders
        ? await prisma.whiteboard.findFirst({ where: { id, organizationId: org }, select: { spaceId: true, folderId: true } })
        : await prisma.whiteboard.findFirst({ where: { id, organizationId: org }, select: { spaceId: true } }).then((w) => (w ? { ...w, folderId: null as string | null } : null));
      if (!r) return { ok: false, status: 404, message: "Not found" };
      const place: Place = r.folderId && r.spaceId ? { kind: "folder", id: r.folderId } : r.spaceId ? { kind: "space", id: r.spaceId } : null;
      return landingCheck(viewer, place, "canvas");
    }
    default:
      return { ok: true };
  }
}

/** Where a snapshot row comes back to (its parent as it is now, P3), and P1 there. */
async function snapshotLanding(viewer: Viewer, entityType: string, snapshot: unknown): Promise<TrashActionResult> {
  const row = ((snapshot as SnapshotShape)?.row ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof row[k] === "string" && row[k] ? (row[k] as string) : null);
  switch (entityType) {
    case "folder": {
      const parent = str("parentFolderId");
      const space = str("spaceId");
      if (!parent && !space) return { ok: true };
      return landingCheck(viewer, parent ? { kind: "folder", id: parent } : { kind: "space", id: space as string }, "folder");
    }
    case "board": {
      const folder = str("folderId");
      const space = str("spaceId");
      if (!folder && !space) return { ok: true };
      return landingCheck(viewer, folder ? { kind: "folder", id: folder } : { kind: "space", id: space as string }, "list");
    }
    case "whiteboard": {
      const folder = str("folderId");
      const space = str("spaceId");
      return landingCheck(viewer, folder ? { kind: "folder", id: folder } : space ? { kind: "space", id: space } : null, "canvas");
    }
    case "table": {
      const space = str("spaceId");
      return landingCheck(viewer, space ? { kind: "space", id: space } : null, "table");
    }
    case "item":
      return listLanding(viewer, str("boardId"));
    case "note":
      return docLanding(viewer, { entityType: str("entityType"), entityId: str("entityId"), parentId: str("parentId") });
    case "file": {
      // A file comes back into its Space folder (the Space re-derived from
      // the folder as it is now, restoreFromTrash) or its Space's root: Can
      // edit there now, whoever uploaded or deleted it. A file of the org's
      // keeps the org root's rule.
      const folder = str("spaceFolderId");
      const space = str("spaceId");
      return landingCheck(viewer, folder ? { kind: "folder", id: folder } : space ? { kind: "space", id: space } : null, "file");
    }
    case "form":
      return formLanding(viewer, { boardId: str("targetBoardId"), tableId: str("targetTableId") });
    default:
      return { ok: true };
  }
}

/**
 * A form comes back with its destination, and every response it takes then
 * writes a task or a row there on the restorer's behalf: the same Can edit
 * the form's create and change ask (node-placement checkFormDestination). A
 * restorer lowered to Can view since never gets a form that writes into the
 * List. A destination that is gone is no write at all, so it does not block.
 */
async function formLanding(viewer: Viewer, dest: { boardId: string | null; tableId: string | null }): Promise<TrashActionResult> {
  if (!dest.boardId && !dest.tableId) return { ok: true };
  const [board, table] = await Promise.all([
    dest.boardId ? prisma.board.findFirst({ where: { id: dest.boardId, organizationId: viewer.organizationId, archivedAt: null }, select: { id: true } }) : Promise.resolve(null),
    dest.tableId ? prisma.dataTable.findFirst({ where: { id: dest.tableId, organizationId: viewer.organizationId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!board && !table) return { ok: true };
  const gate = await checkFormDestination(nodeCtxFromViewer(viewer), { boardId: board?.id ?? null, tableId: table?.id ?? null });
  if (gate.ok) return { ok: true };
  return { ok: false, status: 403, message: gate.status === 403 ? `${gate.error} Ask someone who can edit it to restore this form.` : CANT_RESTORE_HERE };
}

/**
 * Delete permanently. Owner and Admin only, enforced by the caller.
 *
 * AN ARCHIVED CONTAINER IS NOT AN EMPTY ONE, and this is where that bit.
 * Archiving a Space does not archive its Folders, its Lists or their tasks:
 * `archiveSpace` sets one timestamp. The archive branch used to call
 * `prisma.space.deleteMany` straight, and `Folder.spaceId` is `onDelete:
 * Cascade`, so purging one archived Space destroyed every Folder in it,
 * archived or not, while its Lists survived with a null spaceId and a null
 * folderId, i.e. off the Spaces tree entirely. All of that sat behind a
 * confirm that said "1 item".
 *
 * The same stage refused exactly this for Empty trash ("no single control
 * should be able to destroy every archived Space in the workspace"), so a
 * container that still holds live children is refused here too, with a 409
 * that says what is in the way. Permanently deleting a Space with its contents
 * is still reachable, from the Space's own delete (DELETE /api/spaces/[id]
 * ?hard=1), which snapshots the subtree to Trash first and then runs
 * `deleteSpace`'s transaction rather than letting the database cascade.
 */
export async function purgeTrashRow(viewer: Viewer, rowId: string): Promise<TrashActionResult> {
  const orgId = viewer.organizationId;
  const parsed = parseRowId(rowId);
  if (parsed.archive) {
    const { type, id } = parsed.archive;
    if (type === "space" || type === "folder" || type === "list") {
      const blocked = await liveChildrenOf(type, id, orgId);
      if (blocked) return { ok: false, status: 409, message: blocked };
    }
    switch (type) {
      case "space": await prisma.space.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      case "folder": await prisma.folder.deleteMany({ where: { id, space: { organizationId: orgId } } }); return { ok: true };
      case "list": await prisma.board.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      case "task": await prisma.item.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      case "doc": await prisma.doc.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      case "canvas": await prisma.whiteboard.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      case "contract":
      case "template": await prisma.agreement.deleteMany({ where: { id, organizationId: orgId } }); return { ok: true };
      default: return { ok: false, status: 404, message: "Not found" };
    }
  }

  // The row goes first and its files are freed only if this delete took it
  // (a restore that committed first keeps them).
  const gone = await prisma.$queryRaw<Array<{ id: string; entityType: string; snapshot: unknown }>>`
    DELETE FROM "TrashItem" WHERE "id" = ${rowId} AND "organizationId" = ${orgId}
    RETURNING "id", "entityType", "snapshot"`;
  if (gone.length === 0) return { ok: false, status: 404, message: "Not found" };
  await freeTrashStorage(gone[0].entityType, gone[0].snapshot, orgId, gone[0].id);
  return { ok: true };
}

/**
 * Which rows in this page would have nowhere to go back to.
 *
 * Only tasks can be orphaned this way today: a snapshot of a task carries its
 * boardId, and if that List is itself gone the insert would fail on the foreign
 * key. A container whose Folder, Space or parent page is gone or in Trash is
 * landingRefusals' (landingPlaceBlocks): the restore refuses it until that
 * place is back, and the row says so instead of offering a Restore.
 */
/**
 * The task rows on this page whose List is not there to take them back:
 * gone (no row at all) or in Trash (archived). A task restored in place into
 * an archived List was live inside a List nobody could open (round seven,
 * item 1), so the archived List blocks the restore like a gone one does.
 */
async function missingParentIds(page: readonly RawRow[]): Promise<Map<string, "gone" | "archived">> {
  const out = new Map<string, "gone" | "archived">();
  const taskRows = page.filter((r) => r.type === "task" && r.anchor.boardId);
  if (!taskRows.length) return out;
  const boardIds = [...new Set(taskRows.map((r) => r.anchor.boardId!))];
  const lists = await prisma.board.findMany({ where: { id: { in: boardIds } }, select: { id: true, archivedAt: true } });
  const byId = new Map(lists.map((l) => [l.id, l] as const));
  for (const r of taskRows) {
    const l = byId.get(r.anchor.boardId!);
    if (!l) out.set(r.id, "gone");
    else if (l.archivedAt) out.set(r.id, "archived");
  }
  return out;
}

/**
 * The sentence to refuse a container purge with, or null when it is safe.
 *
 * "Live" means not itself archived: a child that is already on this same
 * Archived tab has its own row and its own Delete permanently, so the person
 * can work inwards. A child that is NOT archived is in daily use and must not
 * disappear as a side effect of deleting the shell around it.
 */
async function liveChildrenOf(
  type: "space" | "folder" | "list",
  id: string,
  organizationId: string,
): Promise<string | null> {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // A purge deletes the container row alone, and canvases, tables and files
  // name their Space (and a canvas its Folder) with no foreign key, while a
  // sub-folder and a file drop to the Space root when their Folder goes. So
  // every one of them still live blocks the purge (the placement rule's P3:
  // a delete never leaves an orphan).
  const canvasFolders = await canvasesHaveFolders();
  if (type === "space") {
    const [folders, lists, canvases, tables, files] = await Promise.all([
      prisma.folder.count({ where: { spaceId: id, archivedAt: null } }),
      prisma.board.count({ where: { spaceId: id, organizationId, archivedAt: null } }),
      prisma.whiteboard.count({ where: { spaceId: id, organizationId, archivedAt: null } }),
      prisma.dataTable.count({ where: { spaceId: id, organizationId } }),
      prisma.fileEntry.count({ where: { spaceId: id, organizationId } }),
    ]);
    if (folders) parts.push(plural(folders, "folder", "folders"));
    if (lists) parts.push(plural(lists, "list", "lists"));
    if (canvases) parts.push(plural(canvases, "canvas", "canvases"));
    if (tables) parts.push(plural(tables, "table", "tables"));
    if (files) parts.push(plural(files, "file", "files"));
  } else if (type === "folder") {
    const [lists, folders, canvases, files] = await Promise.all([
      prisma.board.count({ where: { folderId: id, organizationId, archivedAt: null } }),
      prisma.folder.count({ where: { parentFolderId: id, organizationId, archivedAt: null } }),
      canvasFolders ? prisma.whiteboard.count({ where: { folderId: id, organizationId, archivedAt: null } }) : Promise.resolve(0),
      prisma.fileEntry.count({ where: { spaceFolderId: id, organizationId } }),
    ]);
    if (folders) parts.push(plural(folders, "folder", "folders"));
    if (lists) parts.push(plural(lists, "list", "lists"));
    if (canvases) parts.push(plural(canvases, "canvas", "canvases"));
    if (files) parts.push(plural(files, "file", "files"));
  } else {
    const tasks = await prisma.item.count({ where: { boardId: id, organizationId, archivedAt: null } });
    if (tasks) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
  }
  if (!parts.length) return null;
  const noun = type === "list" ? "list" : type;
  return `This ${noun} still holds ${parts.join(" and ")} that are not archived. Archive or move them first.`;
}
