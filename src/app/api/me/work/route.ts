// GET /api/me/work: every task assigned to the viewer, across every Space.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/my-work, Data),
// which asks for exactly four changes to what this route used to be:
//
//   1. `OR: [{ ownerId }, { assigneeIds: { has } }]`. It read `ownerId` ONLY,
//      while /api/me/items next door read both. Two routes both answered "what
//      is mine" and disagreed, so the planner panel and the Home card showed
//      two different task sets to the same person on the same morning.
//   2. Grouping, sorting and filtering on the server.
//   3. Cursor pagination, replacing `take: 600`. A capped list with no total
//      looks complete and is not.
//   4. The due-date buckets computed in the VIEWER's time zone and week start
//      (`home.locale.*`), not the server's local midnight. See work-buckets.ts.
//
// GROUPING IS AN ORDER, NOT A GROUP BY. Every grouping this page offers is
// expressible as an ORDER BY whose leading key is the group, so a page of rows
// is always a contiguous run of groups and the client can cut it into headers
// without the server having to hold the whole set. Due date is the neat case:
// `dueAt asc` with nulls last IS the order Overdue, Today, Tomorrow, This
// week, Later, No date.
//
// ACCESS. Every row is assigned to the viewer, and access rule 9 says being
// assigned a task grants Can edit on it. So this route deliberately does NOT
// filter by List membership: doing that is what used to hide people's own
// work from them. The List name travels with the row for display, and the
// client renders it as a plain label rather than a link when the viewer cannot
// open the List.
//
// COMPATIBILITY. The planner side panel reads `buckets` and `counts` off this
// route. Both are still returned, computed from the same rows, so nothing has
// to move in the planner unit for this to ship.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectivePreferences } from "@/lib/preferences";
import { getBoardStatuses, isDoneStatusName, makeStatusLookup } from "@/lib/board-items-shared";
import { bucketFor, endOfWeekInstant, startOfTodayInstant, type LocaleContext } from "@/lib/work-buckets";
import { getOrCreatePersonalBoard } from "@/lib/board";
import { createBoardItem } from "@/lib/board-items";
import { parseWorkScope, type MyWorkRow, type WorkGroupKey, type WorkSortKey } from "@/lib/my-work";
import { delegatedWhere } from "@/lib/delegated-items";
import type { Prisma } from "@/generated/prisma";

export const dynamic = "force-dynamic";

/** The page size the list view asks for; 200 is the ceiling a caller may ask. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

/** The ORDER BY for a (group, sort) pair. `id` last, always, so the cursor is stable. */
function orderFor(group: WorkGroupKey, sort: WorkSortKey, dir: "asc" | "desc"): Prisma.ItemOrderByWithRelationInput[] {
  const sortClause: Prisma.ItemOrderByWithRelationInput[] = (() => {
    switch (sort) {
      case "priority": return [{ priority: dir }];
      case "title": return [{ title: dir }];
      case "list": return [{ board: { name: dir } }];
      case "created": return [{ createdAt: dir }];
      case "updated": return [{ updatedAt: dir }];
      case "due":
      default: return [{ dueAt: { sort: dir, nulls: "last" } }];
    }
  })();

  const groupClause: Prisma.ItemOrderByWithRelationInput[] = (() => {
    switch (group) {
      // Due date IS the sort that produces the six buckets in order.
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

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const sp = url.searchParams;
  const group = (sp.get("group") ?? "due") as WorkGroupKey;
  const sortRaw = (sp.get("sort") ?? "due") as WorkSortKey;
  const dir: "asc" | "desc" = sp.get("dir") === "desc" ? "desc" : "asc";
  const limit = parseLimit(sp.get("limit"));
  const cursor = sp.get("cursor");
  // done=0 hides done tasks (the default: My work is work still to do),
  // done=1 shows everything, done=only shows just the finished ones.
  const doneParam = sp.get("done") ?? "0";
  const includeSubtasks = sp.get("subtasks") !== "0";
  // `scope=delegated`: the tasks the viewer handed to other people (the
  // retired Today / Overdue page's Delegated tab). See lib/delegated-items.ts.
  const scope = parseWorkScope(sp.get("scope"));

  const prefs = await getEffectivePreferences(u.id, u.organizationId).catch(() => null);
  const locale: LocaleContext = {
    timeZone: prefs?.home?.locale?.timezone ?? null,
    weekStart: prefs?.home?.locale?.weekStart ?? null,
  };

  const where: Prisma.ItemWhereInput =
    scope === "delegated"
      ? await delegatedWhere(u.organizationId, u.id)
      : {
          organizationId: u.organizationId,
          OR: [{ ownerId: u.id }, { assigneeIds: { has: u.id } }],
          archivedAt: null,
        };
  if (!includeSubtasks) where.parentItemId = null;

  // ── filters ──────────────────────────────────────────────────────
  //
  // Every row the Filter panel draws is one of these, and every one of these
  // is a real predicate. The panel used to draw four Priority checkboxes and
  // nothing else, because these were the only filters that existed.
  const and: Prisma.ItemWhereInput[] = [];
  const priorities = listParam(sp.get("priority"));
  if (priorities.length) and.push({ priority: { in: priorities } });
  const statuses = listParam(sp.get("status"));
  if (statuses.length) and.push({ status: { in: statuses } });
  const boardIds = listParam(sp.get("list"));
  if (boardIds.length) and.push({ boardId: { in: boardIds } });
  const spaceIds = listParam(sp.get("space"));
  if (spaceIds.length) and.push({ board: { spaceId: { in: spaceIds } } });
  const typeIds = listParam(sp.get("type"));
  if (typeIds.length) {
    // "__none" is the org default type, which is a null column, not an id.
    const real = typeIds.filter((t) => t !== "__none");
    const wantsDefault = typeIds.includes("__none");
    const clauses: Prisma.ItemWhereInput[] = [];
    if (real.length) clauses.push({ itemTypeId: { in: real } });
    if (wantsDefault) clauses.push({ itemTypeId: null });
    and.push(clauses.length === 1 ? clauses[0] : { OR: clauses });
  }
  // Due-date buckets are computed in the VIEWER's zone, so they become
  // instants here rather than a SQL date_trunc in the server's zone.
  const dueBuckets = listParam(sp.get("due"));
  if (dueBuckets.length) {
    const clauses = dueBucketClauses(dueBuckets, new Date(), locale);
    if (clauses.length) and.push(clauses.length === 1 ? clauses[0] : { OR: clauses });
  }
  const q = (sp.get("q") ?? "").trim();
  if (q) and.push({ title: { contains: q, mode: "insensitive" } });

  // Tags live in TagAssignment, which has no relation back to Item, so the
  // narrowing is an id list. Bounded: a tag with more matches than the cap
  // narrows to the most recent ones rather than timing the page out.
  const tagIds = listParam(sp.get("tags"));
  if (tagIds.length) {
    const assignments = await prisma.tagAssignment.findMany({
      // BOARD_ITEM is the entity type every task tag is written under
      // (src/lib/board-items.ts tagsForItems / syncItemTags).
      where: { organizationId: u.organizationId, entityType: "BOARD_ITEM", tagId: { in: tagIds } },
      select: { entityId: true },
      take: 5000,
    });
    and.push({ id: { in: assignments.map((a) => a.entityId) } });
  }
  if (and.length) where.AND = and;

  const select = {
    id: true, title: true, status: true, priority: true, startAt: true, dueAt: true,
    ownerId: true, assigneeIds: true, parentItemId: true, createdAt: true, updatedAt: true,
    boardId: true,
    // `statuses` travels with the row so the list can print the WORD the
    // List's owner chose ("Shipped") rather than the stored value ("DONE"),
    // and so the checkbox knows which value means done in THIS List. There is
    // no org-wide status vocabulary, so this is the only place the answer
    // exists.
    board: { select: { id: true, slug: true, name: true, icon: true, color: true, spaceId: true, statuses: true } },
  } as const;

  // One extra row tells the client whether there is a next page, without a
  // second COUNT on the hot path. The total is counted separately, because a
  // footer that says "1 to 50" of an unknown total is the cap problem again.
  //
  // Done filtering cannot be a SQL predicate: "done" is a per-List status NAME
  // ("Shipped", "Closed"), resolved by isDoneStatusName, so it is applied after
  // the read. To keep a page full under that filter the read over-fetches by a
  // factor, which is bounded rather than uncapped.
  const overFetch = doneParam === "0" ? 3 : 1;
  // How many of the viewer's legacy `Task` rows have NOT been migrated yet.
  //
  // WHO READS IT: the notice on /my-work ("N tasks are still on the old task
  // list"), src/app/(dashboard)/my-work/my-work-client.tsx. Phase 2 W4 deleted
  // the seven pages that were the only UI over that table, and the migration
  // that moves the rows across is a script the founder runs, so between the
  // deploy and that run there is work a person owns that this page cannot
  // show. Counting it and rendering nothing would be the silent removal this
  // release exists to avoid, so the number reaches the page.
  //
  // It counts rows with NO forwarding address rather than every legacy row:
  // the migration never deletes its source rows (scripts/MIGRATIONS.md rule
  // 6), so a count of the table itself would never fall and the notice would
  // stand for ever. This one reaches zero the moment the org is migrated, and
  // the notice disappears by itself.
  const legacyTasksPromise = (async () => {
    const rows = await prisma.task.findMany({
      where: { organizationId: u.organizationId, assigneeId: u.id },
      select: { id: true },
      take: 500,
    });
    if (rows.length === 0) return 0;
    const forwarded = await prisma.legacyRedirect.findMany({
      where: { organizationId: u.organizationId, kind: "task", legacyId: { in: rows.map((r) => r.id) } },
      select: { legacyId: true },
    });
    const done = new Set(forwarded.map((f) => f.legacyId));
    return rows.filter((r) => !done.has(r.id)).length;
  })().catch(() => 0);

  const [rowsRaw, total, legacyTaskCount] = await Promise.all([
    prisma.item.findMany({
      where,
      select,
      orderBy: orderFor(group, sortRaw, dir),
      take: limit * overFetch + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.item.count({ where }),
    legacyTasksPromise,
  ]);

  const afterDone = rowsRaw.filter((it) => {
    const done = isDoneStatusName(it.status);
    if (doneParam === "only") return done;
    if (doneParam === "1") return true;
    return !done;
  });

  const page = afterDone.slice(0, limit);
  const hasMore = afterDone.length > limit || rowsRaw.length > limit * overFetch;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;

  // Space names for the List chip's crumbs, in one query.
  const spaceIdSet = Array.from(new Set(page.map((r) => r.board?.spaceId).filter((v): v is string => !!v)));
  const spaces = spaceIdSet.length
    ? await prisma.space.findMany({
        where: { id: { in: spaceIdSet }, organizationId: u.organizationId },
        select: { id: true, slug: true, name: true },
      })
    : [];
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  // The people on each row. Multi-assignee shipped (commit 638e9d6f) but the
  // list had no Assignees column and no way to turn one on, so a task shared
  // with three people looked exactly like one that was only yours.
  const assigneeIdSet = Array.from(
    new Set(page.flatMap((r) => [r.ownerId, ...(r.assigneeIds ?? [])]).filter((v): v is string => !!v)),
  );
  const people = assigneeIdSet.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIdSet }, organizationId: u.organizationId },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  // Which of those Lists the viewer can actually open, so the chip is a link
  // only when it leads somewhere. Assignment granted them the TASK, not the
  // List, and a chip that 404s is worse than a label.
  const readableBoardIds = await readableListIds(
    u.id,
    u.organizationId,
    Array.from(new Set(page.map((r) => r.boardId))),
  );

  const now = new Date();
  // One status lookup per List, not per row.
  const statusesByBoard = new Map<string, ReturnType<typeof makeStatusLookup>>();
  const doneByBoard = new Map<string, string | null>();
  for (const it of page) {
    if (!it.board || statusesByBoard.has(it.board.id)) continue;
    const options = getBoardStatuses(it.board);
    statusesByBoard.set(it.board.id, makeStatusLookup(options));
    const done = options.find((o) => o.group === "DONE") ?? options.find((o) => isDoneStatusName(o.value));
    doneByBoard.set(it.board.id, done?.value ?? null);
  }

  const rows: MyWorkRow[] = page.map((it) => ({
    id: it.id,
    title: it.title,
    status: it.status,
    priority: it.priority,
    startAt: it.startAt ? it.startAt.toISOString() : null,
    dueAt: it.dueAt ? it.dueAt.toISOString() : null,
    ownerId: it.ownerId,
    assigneeIds: it.assigneeIds ?? [],
    // Owner first (the DRI), then the rest, de-duplicated. A person who has
    // left the org resolves to nothing and is dropped rather than rendered as
    // an empty circle: no fake avatars.
    assignees: Array.from(new Set([it.ownerId, ...(it.assigneeIds ?? [])].filter((v): v is string => !!v)))
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
    listReadable: readableBoardIds.has(it.boardId),
  }));

  // The legacy shape the planner side panel still reads. Same rows, five
  // buckets, so the panel keeps working without a change in that unit.
  const buckets = legacyBuckets(rows, now, locale);

  // The values the Filter panel may offer, computed over the viewer's WHOLE
  // assigned set rather than the page in front of them. Offering only what is
  // on the page makes a filter that cannot narrow anything it cannot already
  // see, and offering the org's whole vocabulary makes rows that always come
  // back "No results".
  // The facets count the SET the page is showing: the delegated set when that
  // is the scope, so a Filter row never offers a List none of the shown rows
  // sit in.
  const facets = await workFacets(u.id, u.organizationId, scope === "delegated" ? where : null);

  return NextResponse.json(
    {
      rows,
      group,
      sort: sortRaw,
      dir,
      total,
      nextCursor,
      hasMore,
      legacyTaskCount,
      locale: { timeZone: locale.timeZone, weekStart: locale.weekStart },
      facets,
      buckets,
      counts: {
        today: buckets.today.length,
        overdue: buckets.overdue.length,
        next: buckets.next.length,
        unscheduled: buckets.unscheduled.length,
        done: buckets.done.length,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * A status value a List does not declare, made readable. "IN_PROGRESS" ->
 * "In progress". It is a last resort, not a vocabulary: a List that declares
 * its statuses always wins.
 */
function humaniseStatus(value: string): string {
  const words = value.replace(/[._-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function listParam(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The Filter panel's Due date rows as SQL.
 *
 * The bucket edges are the VIEWER's midnights, not the server's, which is the
 * same rule `bucketFor` applies when it labels a row, so a filter and a group
 * header can never disagree about which day a task is due.
 */
function dueBucketClauses(buckets: string[], now: Date, locale: LocaleContext): Prisma.ItemWhereInput[] {
  const startOfToday = startOfTodayInstant(now, locale);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
  const endOfWeek = endOfWeekInstant(now, locale);
  const out: Prisma.ItemWhereInput[] = [];
  for (const b of buckets) {
    if (b === "overdue") out.push({ dueAt: { lt: startOfToday } });
    else if (b === "today") out.push({ dueAt: { gte: startOfToday, lt: startOfTomorrow } });
    else if (b === "week") out.push({ dueAt: { gte: startOfToday, lte: endOfWeek } });
    else if (b === "next") out.push({ dueAt: { gt: endOfWeek, lte: new Date(endOfWeek.getTime() + 7 * 86_400_000) } });
    else if (b === "none") out.push({ dueAt: null });
  }
  return out;
}

/**
 * The subset of these Lists the viewer can open.
 *
 * Deliberately cheap and deliberately conservative: a List the viewer is a
 * member of, or whose Space they are a member of, or a Space visible to the
 * whole org. It never widens what the List page itself allows, the page runs
 * its own gate: it only decides whether to draw the chip as a link.
 */
async function readableListIds(userId: string, organizationId: string, boardIds: string[]): Promise<Set<string>> {
  if (boardIds.length === 0) return new Set();
  const rows = await prisma.board.findMany({
    where: {
      id: { in: boardIds },
      organizationId,
      OR: [
        { members: { some: { userId } } },
        { space: { visibility: "ORG" } },
        { space: { members: { some: { userId } } } },
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export interface WorkFacets {
  statuses: Array<{ value: string; label: string; count: number }>;
  lists: Array<{ id: string; name: string; count: number }>;
  spaces: Array<{ id: string; name: string; count: number }>;
  types: Array<{ id: string; name: string; count: number }>;
  tags: Array<{ id: string; name: string; color: string | null; count: number }>;
}

/**
 * Which values the viewer's own tasks actually carry.
 *
 * Four cheap GROUP BYs over the assignment set (never the whole org's items),
 * then one name lookup each. Exact counts, so a Filter row can print "3" and
 * mean it.
 */
async function workFacets(userId: string, organizationId: string, scopeWhere: Prisma.ItemWhereInput | null): Promise<WorkFacets> {
  // The scope predicate without the page's own filters: the facets describe
  // what the viewer COULD narrow to, not what the current narrowing left.
  const base: Prisma.ItemWhereInput = scopeWhere
    ? { organizationId: scopeWhere.organizationId, id: scopeWhere.id, archivedAt: null, NOT: scopeWhere.NOT, OR: scopeWhere.OR }
    : {
        organizationId,
        OR: [{ ownerId: userId }, { assigneeIds: { has: userId } }],
        archivedAt: null,
      };

  const [byStatus, byBoard, byType, ownIds] = await Promise.all([
    prisma.item.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.item.groupBy({ by: ["boardId"], where: base, _count: { _all: true } }),
    prisma.item.groupBy({ by: ["itemTypeId"], where: base, _count: { _all: true } }),
    prisma.item.findMany({ where: base, select: { id: true }, take: 5000 }),
  ]);

  const boardIds = byBoard.map((b) => b.boardId);
  const typeIds = byType.map((t) => t.itemTypeId).filter((v): v is string => !!v);
  const [boards, types, assignments] = await Promise.all([
    boardIds.length
      ? prisma.board.findMany({
          where: { id: { in: boardIds }, organizationId },
          select: { id: true, name: true, statuses: true, spaceId: true, space: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    typeIds.length
      ? prisma.itemType.findMany({ where: { id: { in: typeIds }, organizationId }, select: { id: true, singular: true } })
      : Promise.resolve([]),
    ownIds.length
      ? prisma.tagAssignment.findMany({
          where: { organizationId, entityType: "BOARD_ITEM", entityId: { in: ownIds.map((r) => r.id) } },
          select: { tagId: true, tag: { select: { id: true, name: true, color: true, archived: true } } },
        })
      : Promise.resolve([]),
  ]);

  const boardById = new Map(boards.map((b) => [b.id, b]));
  // One status word per value, taken from whichever List declares it; a value
  // no List names falls back to the humanised form the rows already print.
  const statusLabel = new Map<string, string>();
  for (const b of boards) {
    for (const option of getBoardStatuses(b)) statusLabel.set(option.value, option.label);
  }

  const spaceCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const row of byBoard) {
    const board = boardById.get(row.boardId);
    if (!board?.space) continue;
    const existing = spaceCounts.get(board.space.id);
    if (existing) existing.count += row._count._all;
    else spaceCounts.set(board.space.id, { id: board.space.id, name: board.space.name, count: row._count._all });
  }

  const tagCounts = new Map<string, { id: string; name: string; color: string | null; count: number }>();
  for (const a of assignments) {
    if (a.tag.archived) continue;
    const existing = tagCounts.get(a.tag.id);
    if (existing) existing.count += 1;
    else tagCounts.set(a.tag.id, { id: a.tag.id, name: a.tag.name, color: a.tag.color, count: 1 });
  }

  const typeName = new Map(types.map((t) => [t.id, t.singular]));

  return {
    statuses: byStatus
      .filter((s): s is typeof s & { status: string } => !!s.status)
      .map((s) => ({ value: s.status, label: statusLabel.get(s.status) ?? humaniseStatus(s.status), count: s._count._all }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    lists: byBoard
      .map((b) => ({ id: b.boardId, name: boardById.get(b.boardId)?.name ?? "Unknown list", count: b._count._all }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    spaces: [...spaceCounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    types: byType
      .map((t) => ({
        id: t.itemTypeId ?? "__none",
        name: t.itemTypeId ? typeName.get(t.itemTypeId) ?? "Unknown type" : "Task",
        count: t._count._all,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tags: [...tagCounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

interface LegacyCard {
  id: string; title: string; status: string | null;
  dueAt: string | null; priority: string | null; board: string | null; url: string;
}

function legacyBuckets(rows: MyWorkRow[], now: Date, locale: LocaleContext) {
  const out = { today: [] as LegacyCard[], overdue: [] as LegacyCard[], next: [] as LegacyCard[], unscheduled: [] as LegacyCard[], done: [] as LegacyCard[] };
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  for (const r of rows) {
    const card: LegacyCard = {
      id: r.id, title: r.title, status: r.status, dueAt: r.dueAt,
      priority: r.priority, board: r.board?.name ?? null, url: `/item/${r.id}`,
    };
    if (isDoneStatusName(r.status)) {
      if (new Date(r.updatedAt) >= weekAgo) out.done.push(card);
      continue;
    }
    const bucket = bucketFor(r.dueAt ?? r.startAt, now, locale);
    if (bucket === "none") out.unscheduled.push(card);
    else if (bucket === "overdue") out.overdue.push(card);
    else if (bucket === "today") out.today.push(card);
    else out.next.push(card);
  }
  return out;
}

/**
 * POST /api/me/work: put a task on my own Personal list.
 *
 * Phase 2 W4 (docs/plans/ui-refresh/spec-work-home.md section 4). The planner
 * had three "create a task" buttons (the command bar's "Meet with", the week
 * grid's new-event popover, and the side panel's "Meet with") and all three
 * POSTed to /api/tasks, which wrote a row on the LEGACY `Task` table. That is
 * why work created in the planner never appeared on a board, in My work, in
 * Everything, or in anybody's search: it was written to a model no task
 * surface reads. A 308 cannot fix a POST, so those three callers move here.
 *
 * The destination is the viewer's own Personal list, which is exactly where a
 * personal, planner-created task belongs and is the same List /my-work/personal
 * renders. The list is created on first use, the same way opening the page
 * creates it.
 *
 * Deliberately small: title, an optional description, and optional start / due
 * timestamps. A task that needs a List, an assignee, a priority or a type is a
 * task for the create-task modal, and this route does not grow into a second
 * one of those.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!u?.id || !u.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const when = (key: string): Date | null => {
    const raw = body[key];
    if (typeof raw !== "string" || !raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  const board = await getOrCreatePersonalBoard(u.organizationId, u.id);
  const statuses = getBoardStatuses(board);
  const firstActive = statuses.find((s) => s.group === "ACTIVE") ?? statuses[0];

  const created = await createBoardItem({
    organizationId: u.organizationId,
    boardId: board.id,
    title,
    status: firstActive?.value,
    ownerId: u.id,
    assigneeIds: [u.id],
    startAt: when("startAt"),
    dueAt: when("dueAt") ?? when("endAt") ?? when("date"),
    metadata: description ? { description } : {},
    actorId: u.id,
  });

  return NextResponse.json({ item: { id: created.id, title: created.title, url: `/item/${created.id}` } }, { status: 201 });
}
