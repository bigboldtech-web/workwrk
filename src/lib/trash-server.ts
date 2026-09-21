// Reading the one Trash: both tabs, every source, scoped to what the viewer
// may actually restore.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// THREE THINGS CHANGE HERE, AND EACH ONE WAS A BUG.
//
// 1. THE GATE. `GET /api/trash` was `isManager`, so a plain Member who deleted
//    their own list got "Trash is for managers" and had to find a manager to
//    get it back (work-tasks #11). It is `accessibleIds(type, FULL)` per source
//    now, plus "rows you deleted yourself", with Owner and Admin over the org.
//    The sets narrow; nobody sees more than before.
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
// Server-only: imports prisma and the access engine.

import { prisma } from "./prisma";
import { accessibleIds } from "./access/ids";
import type { Viewer } from "./access/types";
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
 * What the viewer may see and restore, as id sets.
 *
 * `accessibleIds` answers for Spaces, Folders, Lists, Tables and Canvases.
 * The other types have no id set yet, so for those the rule is the narrow half
 * alone: rows the viewer deleted. Narrow is the safe direction; widening one
 * of them is adding a case to `accessibleIds`, not a special case here.
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

export async function trashScope(viewer: Viewer): Promise<TrashScope> {
  if (viewerIsOwnerOrAdmin(viewer)) {
    return { all: true, userId: viewer.userId, spaces: new Set(), folders: new Set(), lists: new Set(), tables: new Set(), canvases: new Set() };
  }
  const [spaces, folders, lists, tables, canvases] = await Promise.all([
    accessibleIds(viewer, "space", "FULL"),
    accessibleIds(viewer, "folder", "FULL"),
    accessibleIds(viewer, "list", "FULL"),
    accessibleIds(viewer, "table", "FULL"),
    accessibleIds(viewer, "whiteboard", "FULL"),
  ]);
  return {
    all: false,
    userId: viewer.userId,
    spaces: new Set(spaces.readable),
    folders: new Set(folders.readable),
    lists: new Set(lists.readable),
    tables: new Set(tables.readable),
    canvases: new Set(canvases.readable),
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
}

export async function readTrash(viewer: Viewer, query: TrashQuery): Promise<TrashPage> {
  const orgId = viewer.organizationId;
  const [scope, days] = await Promise.all([trashScope(viewer), trashRetentionDays(orgId)]);
  const { rows: raw, capped } = query.tab === "deleted" ? await readDeleted(orgId) : await readArchived(orgId);

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

  const soon = (r: RawRow): boolean =>
    query.tab === "deleted" && isExpiringSoon(daysLeft(r.deletedAt, days));

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
  // not exist. Saying so beats a Restore button that 409s.
  const missingParents = await missingParentIds(page);

  const rows: TrashRow[] = page.map((r) => {
    const actor = r.deletedById ? actorById.get(r.deletedById) : null;
    const parentGone = missingParents.has(r.id);
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
      daysLeft: query.tab === "archived" ? null : daysLeft(r.deletedAt, days),
      restorable: !parentGone,
      // A task is the one row that can be re-homed: its snapshot carries a
      // boardId, and any List the viewer may write to will hold it.
      needsTarget: parentGone && r.type === "task",
      blockedReason: parentGone ? "Its list is gone" : null,
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
    };
  });
  return { rows, capped };
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
  const archivedBy = await archivedByColumnAvailable();
  const read = async (withActor: { archivedById: true } | Record<string, never>) => Promise.all([
    prisma.space.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, ownerId: true, ...withActor } }),
    prisma.folder.findMany({ where: { archivedAt: { not: null }, space: { organizationId } }, select: { id: true, name: true, archivedAt: true, spaceId: true, ownerId: true, ...withActor } }),
    prisma.board.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, spaceId: true, folderId: true, ownerId: true, ...withActor } }),
    prisma.item.findMany({ where: { organizationId, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: SOURCE_CAP + 1, select: { id: true, title: true, archivedAt: true, boardId: true, ownerId: true, ...withActor } }),
    // entityType/entityId is the Doc's anchor. Reading it lets inScope apply
    // the SAME Space/Folder/List rules it applies to everything else, so a
    // Member with Full access on the Space an archived Doc lives in can see
    // and restore it. Without the anchor every archived Doc fell through to
    // "rows you deleted yourself", which was narrower than the /docs/trash
    // page this replaced. A doc with no anchor still has none: there is no
    // per-doc ACL to widen it with, and org-wide would be wider than the rule.
    prisma.doc.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, title: true, archivedAt: true, createdById: true, entityType: true, entityId: true, ...withActor } }),
    prisma.whiteboard.findMany({ where: { organizationId, archivedAt: { not: null } }, select: { id: true, name: true, archivedAt: true, spaceId: true, ownerId: true, ...withActor } }),
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

  const out: RawRow[] = [
    ...spaces.map((s) => ({ id: archiveRowId("space", s.id), type: "space" as const, typeLabel: "space", name: s.name, anchor: none, ownId: s.id, deletedById: actor(s), deletedByName: null, scopeOwnerId: s.ownerId ?? null, deletedAt: s.archivedAt! })),
    ...folders.map((f) => ({ id: archiveRowId("folder", f.id), type: "folder" as const, typeLabel: "folder", name: f.name, anchor: { spaceId: f.spaceId, folderId: null, boardId: null }, ownId: f.id, deletedById: actor(f), deletedByName: null, scopeOwnerId: f.ownerId ?? null, deletedAt: f.archivedAt! })),
    ...boards.map((b) => ({ id: archiveRowId("board", b.id), type: "list" as const, typeLabel: "board", name: b.name, anchor: { spaceId: b.spaceId, folderId: b.folderId, boardId: null }, ownId: b.id, deletedById: actor(b), deletedByName: null, scopeOwnerId: b.ownerId ?? null, deletedAt: b.archivedAt! })),
    ...items.slice(0, SOURCE_CAP).map((i) => ({ id: archiveRowId("item", i.id), type: "task" as const, typeLabel: "item", name: i.title, anchor: { spaceId: boardSpace.get(i.boardId) ?? null, folderId: null, boardId: i.boardId }, ownId: i.id, deletedById: actor(i), deletedByName: null, scopeOwnerId: i.ownerId ?? null, deletedAt: i.archivedAt! })),
    ...docs.map((d) => ({ id: archiveRowId("doc", d.id), type: "doc" as const, typeLabel: "note", name: d.title || "Untitled doc", anchor: anchorOfDoc(d), ownId: d.id, deletedById: actor(d), deletedByName: null, scopeOwnerId: d.createdById ?? null, deletedAt: d.archivedAt! })),
    ...canvases.map((w) => ({ id: archiveRowId("wb", w.id), type: "canvas" as const, typeLabel: "whiteboard", name: w.name || "Untitled canvas", anchor: { spaceId: w.spaceId, folderId: null, boardId: null }, ownId: w.id, deletedById: actor(w), deletedByName: null, scopeOwnerId: w.ownerId ?? null, deletedAt: w.archivedAt! })),
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
  const scope = await trashScope(viewer);
  if (scope.all) return { ok: true };

  const parsed = parseRowId(rowId);
  if (parsed.archive) {
    const { type, id } = parsed.archive;
    const anchor = await archiveAnchor(type, id, viewer.organizationId);
    if (!anchor) return { ok: false, status: 404, message: "Not found" };
    // The owner arrives in the owner slot: an archived row has no recorded
    // actor unless archivedById holds one, and the gate must not read the
    // owner as though they were the archiver.
    return inScope(scope, { ...anchor.anchor, ownId: id, type }, null, anchor.ownerId)
      ? { ok: true }
      : { ok: false, status: 403, message: "You need Full access on this to restore it." };
  }

  const snap = await prisma.trashItem.findFirst({
    where: { id: rowId, organizationId: viewer.organizationId },
    select: { entityType: true, entityId: true, snapshot: true, deletedById: true },
  });
  if (!snap) return { ok: false, status: 404, message: "Not found" };
  const type = typeKeyFor(snap.entityType);
  return inScope(scope, { ...snapshotAnchor(snap.snapshot), ownId: snap.entityId, type }, snap.deletedById)
    ? { ok: true }
    : { ok: false, status: 403, message: "You need Full access on this to restore it." };
}

async function archiveAnchor(
  type: TrashTypeKey,
  id: string,
  organizationId: string,
): Promise<{ anchor: { spaceId: string | null; folderId: string | null; boardId: string | null }; ownerId: string | null } | null> {
  const none = { spaceId: null, folderId: null, boardId: null };
  switch (type) {
    case "space": {
      const r = await prisma.space.findFirst({ where: { id, organizationId }, select: { ownerId: true } });
      return r ? { anchor: none, ownerId: r.ownerId ?? null } : null;
    }
    case "folder": {
      const r = await prisma.folder.findFirst({ where: { id, space: { organizationId } }, select: { spaceId: true, ownerId: true } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: null, boardId: null }, ownerId: r.ownerId ?? null } : null;
    }
    case "list": {
      const r = await prisma.board.findFirst({ where: { id, organizationId }, select: { spaceId: true, folderId: true, ownerId: true } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: r.folderId, boardId: null }, ownerId: r.ownerId ?? null } : null;
    }
    case "task": {
      const r = await prisma.item.findFirst({ where: { id, organizationId }, select: { boardId: true, ownerId: true, board: { select: { spaceId: true } } } });
      return r ? { anchor: { spaceId: r.board?.spaceId ?? null, folderId: null, boardId: r.boardId }, ownerId: r.ownerId ?? null } : null;
    }
    case "doc": {
      const r = await prisma.doc.findFirst({ where: { id, organizationId }, select: { createdById: true, entityType: true, entityId: true } });
      // The same anchor the read uses, so the gate and the list agree on who
      // may restore an archived Doc.
      return r ? { anchor: docAnchor(r.entityType, r.entityId), ownerId: r.createdById ?? null } : null;
    }
    case "canvas": {
      const r = await prisma.whiteboard.findFirst({ where: { id, organizationId }, select: { spaceId: true, ownerId: true } });
      return r ? { anchor: { spaceId: r.spaceId, folderId: null, boardId: null }, ownerId: r.ownerId ?? null } : null;
    }
    case "contract":
    case "template": {
      const r = await prisma.agreement.findFirst({ where: { id, organizationId }, select: { id: true } });
      return r ? { anchor: none, ownerId: null } : null;
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

  let toRestore = snap;
  const targetBoardId = target?.targetBoardId ?? null;
  if (targetBoardId) {
    if (snap.entityType !== "item") {
      return { ok: false, status: 409, message: "Only a task can be restored into a different list." };
    }
    // The target has to be a List this viewer may WRITE to, or "Restore to..."
    // would be a way to put a row somewhere you cannot reach.
    const writable = await accessibleIds(viewer, "list", "EDIT");
    if (!writable.readable.has(targetBoardId)) {
      return { ok: false, status: 403, message: "You need edit access on that list." };
    }
    toRestore = { ...snap, snapshot: retargetSnapshot(snap.snapshot, targetBoardId) as typeof snap.snapshot };
  }

  try {
    await restoreFromTrash(toRestore);
    return { ok: true };
  } catch {
    // The usual cause is a parent that is itself gone; the page prints the
    // same sentence on the row so this is the stale-tab path, not the norm.
    return { ok: false, status: 409, message: "Couldn't restore. The list or folder it lived in may be gone." };
  }
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

  const snap = await prisma.trashItem.findFirst({
    where: { id: rowId, organizationId: orgId },
    select: { id: true, entityType: true, snapshot: true },
  });
  if (!snap) return { ok: false, status: 404, message: "Not found" };
  await freeTrashStorage(snap.entityType, snap.snapshot);
  await prisma.trashItem.delete({ where: { id: snap.id } });
  return { ok: true };
}

/**
 * Which rows in this page would have nowhere to go back to.
 *
 * Only tasks can be orphaned this way today: a snapshot of a task carries its
 * boardId, and if that List is itself gone the insert would fail on the foreign
 * key. Containers restore into the Space root when their Folder is missing,
 * which the registry already handles.
 */
async function missingParentIds(page: readonly RawRow[]): Promise<Set<string>> {
  const taskRows = page.filter((r) => r.type === "task" && r.anchor.boardId);
  if (!taskRows.length) return new Set();
  const boardIds = [...new Set(taskRows.map((r) => r.anchor.boardId!))];
  const alive = await prisma.board.findMany({ where: { id: { in: boardIds } }, select: { id: true } });
  const aliveIds = new Set(alive.map((b) => b.id));
  return new Set(taskRows.filter((r) => !aliveIds.has(r.anchor.boardId!)).map((r) => r.id));
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
  if (type === "space") {
    const [folders, lists] = await Promise.all([
      prisma.folder.count({ where: { spaceId: id, archivedAt: null } }),
      prisma.board.count({ where: { spaceId: id, organizationId, archivedAt: null } }),
    ]);
    if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
    if (lists) parts.push(`${lists} list${lists === 1 ? "" : "s"}`);
  } else if (type === "folder") {
    const lists = await prisma.board.count({ where: { folderId: id, organizationId, archivedAt: null } });
    if (lists) parts.push(`${lists} list${lists === 1 ? "" : "s"}`);
  } else {
    const tasks = await prisma.item.count({ where: { boardId: id, organizationId, archivedAt: null } });
    if (tasks) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
  }
  if (!parts.length) return null;
  const noun = type === "list" ? "list" : type;
  return `This ${noun} still holds ${parts.join(" and ")} that are not archived. Archive or move them first.`;
}

/** Point a task snapshot (and its subtasks) at a different List. */
function retargetSnapshot(snapshot: unknown, boardId: string): unknown {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const s = snapshot as { row?: Record<string, unknown>; children?: { subtasks?: Array<Record<string, unknown>> } };
  return {
    ...s,
    ...(s.row ? { row: { ...s.row, boardId } } : {}),
    ...(s.children?.subtasks
      ? { children: { ...s.children, subtasks: s.children.subtasks.map((t) => ({ ...t, boardId })) } }
      : {}),
  };
}
