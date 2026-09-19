// Everything: every task in every Space the viewer can see, as one list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/everything).
//
// THREE THINGS THE OLD VERSION DID THAT THIS ONE DOES NOT.
//
// 1. IT LOADED EVERY BOARD IN THE ORG AND ASKED ABOUT EACH ONE. The readable
//    set came from `board.findMany()` over the whole org followed by a
//    `getBoardForReader` per board inside a Promise.all, on every page load of
//    a force-dynamic route. That is an N+1 access check whose cost grows with
//    the workspace, before a single task is read. `accessibleIds(viewer,
//    "list", VIEW)` answers the same question as set arithmetic.
// 2. IT CAPPED AT 500 AND SAID "500+". A capped list with no total looks
//    complete and is not (work-tasks 1.10, critic #12). There is a cursor and
//    a real count now.
// 3. IT HAD NO ROLE PER ROW, so every row rendered editable and the save
//    failed later. Each row carries the viewer's role on its own List, so a
//    Can view row renders as text (critic #4).
//
// Server-only: prisma and the access engine.

import { prisma } from "./prisma";
import { accessibleIds } from "./access/ids";
import type { ObjectRole, Viewer } from "./access/types";
import { atLeast } from "./access/id-sets";
import { getBoardStatuses, isDoneStatusName, makeStatusLookup } from "./board-items-shared";
import { bucketFor, type LocaleContext } from "./work-buckets";
import { getEffectivePreferences } from "./preferences";
import type { MyWorkRow, WorkGroupKey, WorkSortKey } from "./my-work";
import type { Prisma } from "@/generated/prisma";

/** A row plus what this viewer may do with it. */
export interface EverythingRow extends MyWorkRow {
  /** VIEW / COMMENT rows render as plain text; EDIT and FULL edit inline. */
  role: ObjectRole;
  canEdit: boolean;
}

export interface EverythingScope {
  /** One Space, by slug. */
  space?: string | null;
  /** One Folder, by id. */
  folder?: string | null;
}

export interface EverythingQuery extends EverythingScope {
  group: WorkGroupKey;
  sort: WorkSortKey;
  dir: "asc" | "desc";
  done: "0" | "1" | "only";
  q: string | null;
  statuses: string[];
  priorities: string[];
  listIds: string[];
  spaceIds: string[];
  assigneeIds: string[];
  includeSubtasks: boolean;
  cursor: string | null;
  limit: number;
}

export interface EverythingFacets {
  spaces: Array<{ id: string; slug: string; name: string; count: number }>;
  lists: Array<{ id: string; name: string; count: number }>;
  statuses: Array<{ value: string; label: string; count: number }>;
  priorities: Array<{ value: string; count: number }>;
  /**
   * The DRIs present in the readable set, so the Filter panel can offer
   * Assignee without a second people endpoint. The spec names Assignee as a
   * Filter row and the route has always accepted `?assignee=`; the panel had
   * no way to write it, which made the parameter reachable only by hand.
   */
  assignees: Array<{ id: string; name: string; avatar: string | null; count: number }>;
}

/** One List's status vocabulary, for the inline status picker. */
export interface EverythingStatusOption {
  value: string;
  label: string;
  color: string | null;
}

export interface EverythingResult {
  rows: EverythingRow[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  facets: EverythingFacets;
  /**
   * The status vocabulary of every List represented on this page, keyed by
   * List id. A row's status is per-List, so an inline picker cannot offer an
   * org-wide list: it offers the words that row's own List knows. Without
   * this the `role` each row carries drove nothing but a lock glyph and the
   * spec's "Can edit rows edit inline" was decorative.
   */
  listStatuses: Record<string, EverythingStatusOption[]>;
  /** Resolved from `?space=` so the header can print the crumb. */
  scope: { space: { id: string; slug: string; name: string } | null; folder: { id: string; name: string; spaceId: string } | null };
  /**
   * Which requested scope could not be honoured, and why the page shows an
   * error instead of the whole org.
   *
   * A `?space=` the viewer cannot read and a `?space=` that does not exist get
   * the SAME answer, "space", and no name, id or slug comes back with it: the
   * page used to resolve the Space by slug with no readability filter and print
   * its name as the H1, so a Member could read back the name of a PRIVATE Space
   * the access engine denies them. Dropping the parameter silently was the
   * other half of the bug: a stale link then showed the entire readable org
   * under no caption at all.
   */
  scopeError: "space" | "folder" | null;
  /** False when every readable List is read-only: the primary is then absent. */
  canCreate: boolean;
  locale: { timeZone: string | null; weekStart: number | null };
}

function orderFor(group: WorkGroupKey, sort: WorkSortKey, dir: "asc" | "desc"): Prisma.ItemOrderByWithRelationInput[] {
  const sortClause: Prisma.ItemOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case "priority": return [{ priority: dir }];
      case "title": return [{ title: dir }];
      case "list": return [{ board: { name: dir } }];
      case "updated": return [{ updatedAt: dir }];
      case "due": return [{ dueAt: { sort: dir, nulls: "last" } }];
      case "created":
      default: return [{ createdAt: dir }];
    }
  })();
  const groupClause: Prisma.ItemOrderByWithRelationInput[] = (() => {
    switch (group) {
      case "due": return [{ dueAt: { sort: "asc", nulls: "last" } }];
      case "status": return [{ status: "asc" }];
      case "list": return [{ board: { name: "asc" } }];
      case "priority": return [{ priority: "asc" }];
      // The DRI is the owner column; the client prints the name.
      case "assignee": return [{ ownerId: "asc" }];
      case "none":
      default: return [];
    }
  })();
  return [...groupClause, ...sortClause, { id: "asc" }];
}

function humaniseStatus(value: string): string {
  const words = value.replace(/[._-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/** The role the viewer holds on each readable List, as one map. */
async function listRoles(viewer: Viewer): Promise<Map<string, ObjectRole>> {
  const out = new Map<string, ObjectRole>();
  // Four passes over the same set arithmetic, widest last, so each id ends on
  // the highest role it qualifies for. This is far cheaper than canMany() per
  // row and gives exactly the same answer, because both read the same sets.
  const levels: ObjectRole[] = ["VIEW", "COMMENT", "EDIT", "FULL"];
  for (const level of levels) {
    const ids = await accessibleIds(viewer, "list", level);
    for (const id of ids.readable) out.set(id, level);
  }
  return out;
}

export async function listEverything(viewer: Viewer, query: EverythingQuery): Promise<EverythingResult> {
  const orgId = viewer.organizationId;
  const roles = await listRoles(viewer);

  // Scope first: `?space=` and `?folder=` narrow the READABLE set on the
  // server, never the page after it. Narrowing after paging is how a scoped
  // view ends up with four rows out of fifty.
  //
  // READABILITY IS PART OF RESOLVING. The lookup is by slug, and the answer
  // carries the Space's id and name into the page title, so it has to be
  // filtered by what the viewer may read or the title leaks the existence and
  // name of a PRIVATE Space. `accessibleIds` is the same set arithmetic the
  // rest of this file uses, so an unreadable Space and a missing one are
  // indistinguishable from the outside.
  const [rawSpace, rawFolder] = await Promise.all([
    query.space
      ? prisma.space.findFirst({ where: { slug: query.space, organizationId: orgId }, select: { id: true, slug: true, name: true } })
      : Promise.resolve(null),
    query.folder
      ? prisma.folder.findFirst({ where: { id: query.folder, space: { organizationId: orgId } }, select: { id: true, name: true, spaceId: true } })
      : Promise.resolve(null),
  ]);
  const [readableSpaces, readableFolders] = await Promise.all([
    rawSpace ? accessibleIds(viewer, "space", "VIEW") : Promise.resolve(null),
    rawFolder ? accessibleIds(viewer, "folder", "VIEW") : Promise.resolve(null),
  ]);
  const space = rawSpace && readableSpaces?.readable.has(rawSpace.id) ? rawSpace : null;
  const folder = rawFolder && readableFolders?.readable.has(rawFolder.id) ? rawFolder : null;
  // A scope that was asked for and could not be honoured is an error, not a
  // silent widening: the caller asked for one Space's tasks and must never be
  // handed the whole workspace under the page title "Everything".
  const scopeError: "space" | "folder" | null = query.space && !space ? "space" : query.folder && !folder ? "folder" : null;

  let allowedBoardIds = [...roles.keys()];
  if (space || folder || query.listIds.length || query.spaceIds.length) {
    const narrow = await prisma.board.findMany({
      where: {
        id: { in: allowedBoardIds },
        organizationId: orgId,
        archivedAt: null,
        ...(space ? { spaceId: space.id } : {}),
        ...(folder ? { folderId: folder.id } : {}),
        ...(query.listIds.length ? { id: { in: query.listIds } } : {}),
        ...(query.spaceIds.length ? { spaceId: { in: query.spaceIds } } : {}),
      },
      select: { id: true },
    });
    allowedBoardIds = narrow.map((b) => b.id);
  }

  const empty: EverythingResult = {
    rows: [],
    total: 0,
    nextCursor: null,
    hasMore: false,
    facets: { spaces: [], lists: [], statuses: [], priorities: [], assignees: [] },
    listStatuses: {},
    scope: { space, folder },
    scopeError,
    canCreate: false,
    locale: { timeZone: null, weekStart: null },
  };
  // A scope that could not be resolved answers with nothing and says so. It
  // must not fall through to the unscoped read.
  if (scopeError) return empty;
  if (allowedBoardIds.length === 0) return empty;

  const where: Prisma.ItemWhereInput = {
    organizationId: orgId,
    boardId: { in: allowedBoardIds },
    archivedAt: null,
  };
  if (!query.includeSubtasks) where.parentItemId = null;

  const and: Prisma.ItemWhereInput[] = [];
  if (query.statuses.length) and.push({ status: { in: query.statuses } });
  if (query.priorities.length) and.push({ priority: { in: query.priorities } });
  if (query.assigneeIds.length) {
    and.push({ OR: [{ ownerId: { in: query.assigneeIds } }, { assigneeIds: { hasSome: query.assigneeIds } }] });
  }
  if (query.q?.trim()) and.push({ title: { contains: query.q.trim(), mode: "insensitive" } });
  if (and.length) where.AND = and;

  const select = {
    id: true, title: true, status: true, priority: true, startAt: true, dueAt: true,
    ownerId: true, assigneeIds: true, parentItemId: true, createdAt: true, updatedAt: true, boardId: true,
    board: { select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true, statuses: true } },
  } as const;

  // "Done" is a per-List status NAME, not a column, so it cannot be a SQL
  // predicate; the read over-fetches by a bounded factor to keep a page full.
  const overFetch = query.done === "0" ? 3 : 1;

  const [rowsRaw, byStatusTotal] = await Promise.all([
    prisma.item.findMany({
      where,
      select,
      orderBy: orderFor(query.group, query.sort, query.dir),
      take: query.limit * overFetch + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    // "Total records" has to be the number of rows this page can reach. A
    // plain count(where) carries no Done predicate, because Done is a per-List
    // status NAME rather than a column, so with the default done=0 the footer
    // overstated the list by exactly the number of Done tasks. Grouping by
    // status over the SAME `where` gives every status value that matches the
    // filters, and the name test can then be applied to the counts.
    prisma.item.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const keeps = (status: string | null): boolean => {
    const done = isDoneStatusName(status);
    if (query.done === "only") return done;
    if (query.done === "1") return true;
    return !done;
  };
  const total = byStatusTotal.reduce((sum, r) => (keeps(r.status) ? sum + r._count._all : sum), 0);

  // THE CURSOR IS THE LAST RAW ROW READ, NOT THE LAST ROW SHOWN.
  //
  // Done rows are dropped in JS after the query, so a window can be entirely
  // Done: the page is then empty while more rows exist. Deriving the cursor
  // from the visible page produced `null` in exactly that case, which dead-
  // ended the pagination and made every remaining task unreachable behind an
  // empty table with a live record count above it. Anchoring on the last raw
  // row consumed keeps the walk moving through a window that showed nothing.
  const window = rowsRaw.slice(0, query.limit * overFetch);
  const hasSentinel = rowsRaw.length > query.limit * overFetch;
  const page: typeof rowsRaw = [];
  let consumed = 0;
  for (const it of window) {
    consumed++;
    if (keeps(it.status)) {
      page.push(it);
      if (page.length === query.limit) break;
    }
  }
  const hasMore = hasSentinel || consumed < window.length;
  const nextCursor = hasMore && consumed > 0 ? window[consumed - 1].id : null;

  const spaceIdSet = [...new Set(page.map((r) => r.board?.spaceId).filter((v): v is string => !!v))];
  const personIdSet = [...new Set(page.flatMap((r) => [r.ownerId, ...(r.assigneeIds ?? [])]).filter((v): v is string => !!v))];
  const [spaces, people] = await Promise.all([
    spaceIdSet.length
      ? prisma.space.findMany({ where: { id: { in: spaceIdSet }, organizationId: orgId }, select: { id: true, slug: true, name: true } })
      : Promise.resolve([]),
    personIdSet.length
      ? prisma.user.findMany({ where: { id: { in: personIdSet }, organizationId: orgId }, select: { id: true, firstName: true, lastName: true, avatar: true } })
      : Promise.resolve([]),
  ]);
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const personById = new Map(people.map((p) => [p.id, p]));

  const statusesByBoard = new Map<string, ReturnType<typeof makeStatusLookup>>();
  const doneByBoard = new Map<string, string | null>();
  const listStatuses: Record<string, EverythingStatusOption[]> = {};
  for (const it of page) {
    if (!it.board || statusesByBoard.has(it.board.id)) continue;
    const options = getBoardStatuses(it.board);
    statusesByBoard.set(it.board.id, makeStatusLookup(options));
    const done = options.find((o) => o.group === "DONE") ?? options.find((o) => isDoneStatusName(o.value));
    doneByBoard.set(it.board.id, done?.value ?? null);
    listStatuses[it.board.id] = options.map((o) => ({ value: o.value, label: o.label, color: o.color }));
  }

  const now = new Date();
  // The due buckets are the viewer's, not the server's: a task due tonight in
  // Mumbai is not due tomorrow because the box is in Virginia (critic #13).
  const prefs = await getEffectivePreferences(viewer.userId, orgId).catch(() => null);
  const locale: LocaleContext = {
    timeZone: prefs?.home?.locale?.timezone ?? null,
    weekStart: prefs?.home?.locale?.weekStart ?? null,
  };

  const rows: EverythingRow[] = page.map((it) => {
    const role = roles.get(it.boardId) ?? "VIEW";
    return {
      id: it.id,
      title: it.title,
      status: it.status,
      priority: it.priority,
      startAt: it.startAt ? it.startAt.toISOString() : null,
      dueAt: it.dueAt ? it.dueAt.toISOString() : null,
      ownerId: it.ownerId,
      assigneeIds: it.assigneeIds ?? [],
      assignees: [...new Set([it.ownerId, ...(it.assigneeIds ?? [])].filter((v): v is string => !!v))]
        .map((id) => personById.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, avatar: p.avatar })),
      parentItemId: it.parentItemId,
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt.toISOString(),
      dueBucket: bucketFor(it.dueAt ?? it.startAt, now, locale),
      statusLabel: it.status ? statusesByBoard.get(it.boardId)?.[it.status]?.label ?? humaniseStatus(it.status) : null,
      statusColor: it.status ? statusesByBoard.get(it.boardId)?.[it.status]?.color ?? null : null,
      doneStatus: doneByBoard.get(it.boardId) ?? null,
      board: it.board
        ? { id: it.board.id, slug: it.board.slug, name: it.board.name, icon: it.board.icon, color: it.board.color, spaceId: it.board.spaceId }
        : null,
      space: it.board?.spaceId ? spaceById.get(it.board.spaceId) ?? null : null,
      // Every row here comes from a readable List by construction.
      listReadable: true,
      role,
      canEdit: atLeast(role, "EDIT"),
    };
  });

  const facets = await everythingFacets(orgId, allowedBoardIds, query.includeSubtasks);
  // The Create-task primary needs somewhere to write; with every readable List
  // at Can view the modal's picker would be empty, so the button is absent and
  // the empty state says so instead.
  const canCreate = [...roles.values()].some((r) => atLeast(r, "EDIT"));

  return {
    rows,
    total,
    nextCursor,
    hasMore,
    facets,
    listStatuses,
    scope: { space, folder },
    scopeError,
    canCreate,
    locale: { timeZone: locale.timeZone ?? null, weekStart: locale.weekStart ?? null },
  };
}

/** The values the Filter panel may offer, over the readable set, not the page. */
async function everythingFacets(organizationId: string, boardIds: string[], includeSubtasks: boolean): Promise<EverythingFacets> {
  const base: Prisma.ItemWhereInput = {
    organizationId,
    boardId: { in: boardIds },
    archivedAt: null,
    ...(includeSubtasks ? {} : { parentItemId: null }),
  };
  const [byBoard, byStatus, byPriority, byOwner, boards] = await Promise.all([
    prisma.item.groupBy({ by: ["boardId"], where: base, _count: { _all: true } }),
    prisma.item.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.item.groupBy({ by: ["priority"], where: base, _count: { _all: true } }),
    prisma.item.groupBy({ by: ["ownerId"], where: base, _count: { _all: true } }),
    prisma.board.findMany({ where: { id: { in: boardIds } }, select: { id: true, name: true, spaceId: true, space: { select: { id: true, slug: true, name: true } } } }),
  ]);
  const ownerIds = byOwner.map((r) => r.ownerId).filter((v): v is string => Boolean(v));
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds }, organizationId },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const spaceCount = new Map<string, { id: string; slug: string; name: string; count: number }>();
  for (const row of byBoard) {
    const b = boardById.get(row.boardId);
    if (!b?.space) continue;
    const prev = spaceCount.get(b.space.id) ?? { ...b.space, count: 0 };
    prev.count += row._count._all;
    spaceCount.set(b.space.id, prev);
  }
  return {
    spaces: [...spaceCount.values()].sort((a, b) => b.count - a.count),
    lists: byBoard
      .map((r) => ({ id: r.boardId, name: boardById.get(r.boardId)?.name ?? "List", count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    statuses: byStatus
      .filter((r): r is typeof r & { status: string } => Boolean(r.status))
      .map((r) => ({ value: r.status, label: humaniseStatus(r.status), count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    priorities: byPriority
      .filter((r): r is typeof r & { priority: string } => Boolean(r.priority))
      .map((r) => ({ value: r.priority, count: r._count._all })),
    // A person with no name row left behind is dropped rather than offered as
    // a blank checkbox: the panel must never print an option nobody can read.
    assignees: byOwner
      .map((r) => {
        const u = r.ownerId ? ownerById.get(r.ownerId) : null;
        if (!u) return null;
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
        return { id: u.id, name: name || "Unnamed", avatar: u.avatar ?? null, count: r._count._all };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .sort((a, b) => b.count - a.count),
  };
}
