// Bird's eye, the server loader: the handful of statements the view costs,
// whatever the Space holds.
//
// NO ACCESS READS HERE. The route hands in Lists it has already decided the
// viewer can read (readableListsInSpace); this file only reads their tasks,
// and every statement is also scoped to the organization, so a List id that
// slipped through could still never read another org's rows.
//
// THE STATEMENTS, and why each exists (the fragments are below):
//   Q1  counts per (List, stored status) for every List at once. It feeds the
//       column totals and the status strip, and it is where the closed
//       values come from: JS decides which of the values PRESENT are closed
//       with isDoneStatus, the product's one done rule, and SQL is handed
//       those exact values, so the rule is never re-implemented in SQL.
//   Q2  the first page of every overview column in ONE statement, a LATERAL
//       top-51 per List over jsonb_to_recordset (no per-List query).
//   Q3  the people on those cards, one findMany.
//   Q4  focus: every status column of one List in one statement, a
//       ROW_NUMBER() partition by the SAME bucket expression the column
//       pages filter on, so a column's later pages return exactly the rows
//       its total counts (null and undeclared statuses live in the first
//       column, the List's own Board rule).
//   Pages resume from a keyset cursor, (column, position, id) in the
//   overview and (position, id) in focus; the id breaks position ties.
//
// HOME ROWS ONLY. The List's own views read its home rows (tasks linked in
// from other Lists are not drawn on any List canvas yet), so Bird's eye does
// too; birdseye-server.contract.test.ts fails the day linked rows go live on
// the canvas, until the union is added here.
//
// WHAT IS ACCEPTED (enterprise scale, no schema change). Q1 and Q2 touch
// every live top-level row of the readable Lists once, because the rank, the
// top-level test and the search are not index-ordered: each List's top 51 is
// a top-N sort over its rows. A Space of 60 Lists and 20,000 tasks is one
// pass over 20k rows per load, tens of milliseconds on Postgres 16, and a
// search repeats it per debounced keystroke. Past roughly 100k live top-level
// tasks in one Space the follow-up is one idempotent prisma/sql file: a
// partial index on "Item" ("boardId", position, id) WHERE "archivedAt" IS
// NULL, plus a trigram index on title.
//
// Raw SQL through prisma.$queryRaw with Prisma.sql fragments; ids travel as
// ONE array parameter with = ANY(...::text[]), never IN (Prisma.join(...)),
// which rendered "?,?" inside the Next server bundle (src/lib/doc-lock.ts).

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import type { StatusOption } from "@/lib/board-items-shared";
import {
  BIRDSEYE_PAGE,
  bucketFor,
  closedValuesPresent,
  encodeBucketCursor,
  encodeListCursor,
  isClosedStatus,
  likePattern,
  type BirdseyeCard,
  type BirdseyeColumn,
  type BirdseyeFocusColumn,
  type BirdseyePerson,
  type BucketCursor,
  type ListCursor,
} from "@/lib/work/birdseye";

export interface BirdseyeFilters {
  q: string;
  hideClosed: boolean;
}

/** A List the viewer can read, as the loader needs it. */
export interface LoaderList {
  id: string;
  statuses: StatusOption[];
}

/** What Q1 says about one List, under the current filters. */
export interface ListCounts {
  total: number;
  /** Per column (declared status value). */
  statusCounts: Record<string, number>;
  /** The stored values present on the List that count as closed. */
  closed: string[];
}

const LIMIT = BIRDSEYE_PAGE + 1;

// ── Fragments ───────────────────────────────────────────────────────

/** A top-level card: no parent, or a parent that is not a live row of the same List (kanban rule 2). */
const TOP = Prisma.sql`(i."parentItemId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "Item" p WHERE p.id = i."parentItemId" AND p."boardId" = i."boardId" AND p."archivedAt" IS NULL
))`;

function search(q: string): Prisma.Sql {
  return q ? Prisma.sql`AND i.title ILIKE ${likePattern(q)} ESCAPE '!'` : Prisma.empty;
}

/** Is the row's status one of `closed` (a jsonb array)? A null status never is. */
function closedTest(closed: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`COALESCE(${closed} @> to_jsonb(i.status), false)`;
}

function hideClosedClause(filters: BirdseyeFilters, closed: Prisma.Sql): Prisma.Sql {
  return filters.hideClosed ? Prisma.sql`AND NOT ${closedTest(closed)}` : Prisma.empty;
}

/** The column index a row sorts under; undeclared and null are 0, the first column. */
function rankOf(ranks: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`COALESCE((${ranks} ->> i.status)::int, 0)`;
}

/** The column a row sits in: its status when declared, else the first column. */
function bucketOf(declared: Prisma.Sql, first: string): Prisma.Sql {
  return Prisma.sql`(CASE WHEN ${declared} @> to_jsonb(i.status) THEN i.status ELSE ${first}::text END)`;
}

/** Live subtasks on the same List: GET /api/items/[id]/subtasks's own scope. */
function subtasksOf(alias: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(SELECT COUNT(*)::int FROM "Item" s WHERE s."parentItemId" = ${alias}.id AND s."boardId" = ${alias}."boardId" AND s."archivedAt" IS NULL)`;
}

/** A visible description once tags, &nbsp; and whitespace are gone (descriptionPresent in JS). */
const HAS_DESCRIPTION = Prisma.sql`COALESCE(
  jsonb_typeof(i.metadata -> 'description') = 'string'
  AND regexp_replace(i.metadata ->> 'description', '<[^>]*>|&nbsp;|[[:space:]]+', '', 'g') <> '',
  false
)`;

const CARD_COLUMNS = Prisma.sql`i.id, i."boardId", i.title, i.status, i.position, i."dueAt", i."assigneeIds", ${HAS_DESCRIPTION} AS "hasDescription"`;

function jsonParam(v: unknown): Prisma.Sql {
  return Prisma.sql`${JSON.stringify(v)}::jsonb`;
}

function rankMap(statuses: readonly StatusOption[]): Record<string, number> {
  return Object.fromEntries(statuses.map((s, i) => [s.value, i]));
}

// ── Rows ────────────────────────────────────────────────────────────

interface CardRow {
  id: string;
  boardId: string;
  title: string;
  status: string | null;
  position: number;
  dueAt: Date | string | null;
  assigneeIds: string[] | null;
  hasDescription: boolean;
  subtaskCount: number;
  rank?: number;
  bucket?: string;
}

function toCard(row: CardRow, people: ReadonlyMap<string, BirdseyePerson>, rank: number): BirdseyeCard {
  const ids = row.assigneeIds ?? [];
  const due = row.dueAt ? new Date(row.dueAt) : null;
  return {
    id: row.id,
    boardId: row.boardId,
    title: row.title,
    status: row.status,
    position: Number(row.position),
    rank,
    dueAt: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
    hasDescription: row.hasDescription === true,
    subtaskCount: Number(row.subtaskCount ?? 0),
    assignees: ids.slice(0, 2).map((id) => people.get(id)).filter((p): p is BirdseyePerson => !!p),
    assigneeCount: ids.length,
  };
}

/** Q3: the first two assignees of every card, one read. */
async function peopleFor(rows: readonly CardRow[], orgId: string): Promise<Map<string, BirdseyePerson>> {
  const ids = [...new Set(rows.flatMap((r) => (r.assigneeIds ?? []).slice(0, 2)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId: orgId },
    select: { id: true, firstName: true, lastName: true, avatar: true },
  });
  return new Map(users.map((u) => [u.id, { id: u.id, firstName: u.firstName, lastName: u.lastName, avatar: u.avatar }]));
}

/** Split a LIMIT 51 answer into the page and whether there is more. */
function page<T>(rows: readonly T[]): { rows: T[]; more: boolean } {
  return rows.length > BIRDSEYE_PAGE ? { rows: rows.slice(0, BIRDSEYE_PAGE), more: true } : { rows: [...rows], more: false };
}

// ── Q1 ──────────────────────────────────────────────────────────────

async function countLists(lists: readonly LoaderList[], filters: BirdseyeFilters, orgId: string): Promise<Record<string, ListCounts>> {
  const out: Record<string, ListCounts> = {};
  if (lists.length === 0) return out;
  const ids = lists.map((l) => l.id);
  const rows = await prisma.$queryRaw<Array<{ boardId: string; status: string | null; n: number }>>`
    SELECT i."boardId" AS "boardId", i.status AS status, COUNT(*)::int AS n
    FROM "Item" i
    WHERE i."boardId" = ANY(${ids}::text[])
      AND i."organizationId" = ${orgId}
      AND i."archivedAt" IS NULL
      AND ${TOP}
      ${search(filters.q)}
    GROUP BY i."boardId", i.status
  `;
  const byList = new Map<string, Array<{ status: string | null; n: number }>>();
  for (const r of rows) {
    const at = byList.get(r.boardId);
    if (at) at.push({ status: r.status, n: Number(r.n) });
    else byList.set(r.boardId, [{ status: r.status, n: Number(r.n) }]);
  }
  for (const list of lists) {
    const groups = byList.get(list.id) ?? [];
    const statusCounts: Record<string, number> = {};
    let total = 0;
    for (const g of groups) {
      if (filters.hideClosed && isClosedStatus(list.statuses, g.status)) continue;
      const bucket = bucketFor(list.statuses, g.status);
      statusCounts[bucket] = (statusCounts[bucket] ?? 0) + g.n;
      total += g.n;
    }
    out[list.id] = { total, statusCounts, closed: closedValuesPresent(list.statuses, groups.map((g) => g.status)) };
  }
  return out;
}

// ── Overview ────────────────────────────────────────────────────────

/** Q1 + Q2 + Q3: counts and the first page of every column. */
export async function loadOverview(
  lists: readonly LoaderList[],
  filters: BirdseyeFilters,
  orgId: string,
): Promise<{ counts: Record<string, ListCounts>; columns: Record<string, BirdseyeColumn> }> {
  if (lists.length === 0) return { counts: {}, columns: {} };
  const counts = await countLists(lists, filters, orgId);
  const meta = lists.map((l) => ({ b: l.id, r: rankMap(l.statuses), c: counts[l.id]?.closed ?? [] }));
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT x.*, ${subtasksOf(Prisma.sql`x`)} AS "subtaskCount"
    FROM jsonb_to_recordset(${JSON.stringify(meta)}::jsonb) AS m(b text, r jsonb, c jsonb)
    CROSS JOIN LATERAL (
      SELECT ${CARD_COLUMNS}, ${rankOf(Prisma.sql`m.r`)} AS "rank"
      FROM "Item" i
      WHERE i."boardId" = m.b
        AND i."organizationId" = ${orgId}
        AND i."archivedAt" IS NULL
        AND ${TOP}
        ${search(filters.q)}
        ${hideClosedClause(filters, Prisma.sql`m.c`)}
      ORDER BY "rank", i.position, i.id
      LIMIT ${LIMIT}
    ) x
  `;
  const people = await peopleFor(rows, orgId);
  const byList = new Map<string, CardRow[]>();
  for (const r of rows) {
    const at = byList.get(r.boardId);
    if (at) at.push(r);
    else byList.set(r.boardId, [r]);
  }
  const columns: Record<string, BirdseyeColumn> = {};
  for (const list of lists) {
    const { rows: kept, more } = page(byList.get(list.id) ?? []);
    const cards = kept.map((r) => toCard(r, people, Number(r.rank ?? 0)));
    const last = cards[cards.length - 1];
    columns[list.id] = { cards, nextCursor: more && last ? encodeListCursor(last.rank, last.position, last.id) : null };
  }
  return { counts, columns };
}

/** The next page of one overview column. */
export async function loadListPage(
  list: LoaderList,
  filters: BirdseyeFilters,
  cursor: ListCursor,
  orgId: string,
): Promise<{ cards: BirdseyeCard[]; nextCursor: string | null }> {
  // The closed values come from Q1, and only matter when they are hidden.
  const closed = filters.hideClosed ? ((await countLists([list], filters, orgId))[list.id]?.closed ?? []) : [];
  const ranks = jsonParam(rankMap(list.statuses));
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT y.*, ${subtasksOf(Prisma.sql`y`)} AS "subtaskCount"
    FROM (
      SELECT ${CARD_COLUMNS}, ${rankOf(ranks)} AS "rank"
      FROM "Item" i
      WHERE i."boardId" = ${list.id}
        AND i."organizationId" = ${orgId}
        AND i."archivedAt" IS NULL
        AND ${TOP}
        ${search(filters.q)}
        ${hideClosedClause(filters, jsonParam(closed))}
        AND (${rankOf(ranks)}, i.position, i.id) > (${cursor.rank}::int, ${cursor.position}::float8, ${cursor.id}::text)
      ORDER BY "rank", i.position, i.id
      LIMIT ${LIMIT}
    ) y
  `;
  const people = await peopleFor(rows, orgId);
  const { rows: kept, more } = page(rows);
  const cards = kept.map((r) => toCard(r, people, Number(r.rank ?? 0)));
  const last = cards[cards.length - 1];
  return { cards, nextCursor: more && last ? encodeListCursor(last.rank, last.position, last.id) : null };
}

// ── Focus ───────────────────────────────────────────────────────────

/** Q1 over every readable List (the chips and the switcher) + Q4 for the focused one. */
export async function loadFocus(
  lists: readonly LoaderList[],
  focusList: LoaderList,
  filters: BirdseyeFilters,
  orgId: string,
): Promise<{ counts: Record<string, ListCounts>; columns: Record<string, BirdseyeFocusColumn> }> {
  const counts = await countLists(lists.some((l) => l.id === focusList.id) ? lists : [...lists, focusList], filters, orgId);
  const own = counts[focusList.id] ?? { total: 0, statusCounts: {}, closed: [] };
  const declared = jsonParam(focusList.statuses.map((s) => s.value));
  const first = focusList.statuses[0]?.value ?? "";
  const bucket = bucketOf(declared, first);
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT w.id, w."boardId", w.title, w.status, w.position, w."dueAt", w."assigneeIds", w."hasDescription", w.bucket,
      ${subtasksOf(Prisma.sql`w`)} AS "subtaskCount"
    FROM (
      SELECT ${CARD_COLUMNS}, ${bucket} AS bucket,
        ROW_NUMBER() OVER (PARTITION BY ${bucket} ORDER BY i.position, i.id) AS rn
      FROM "Item" i
      WHERE i."boardId" = ${focusList.id}
        AND i."organizationId" = ${orgId}
        AND i."archivedAt" IS NULL
        AND ${TOP}
        ${search(filters.q)}
        ${hideClosedClause(filters, jsonParam(own.closed))}
    ) w
    WHERE w.rn <= ${LIMIT}
    ORDER BY w.bucket, w.position, w.id
  `;
  const people = await peopleFor(rows, orgId);
  const byBucket = new Map<string, CardRow[]>();
  for (const r of rows) {
    const key = r.bucket ?? first;
    const at = byBucket.get(key);
    if (at) at.push(r);
    else byBucket.set(key, [r]);
  }
  const columns: Record<string, BirdseyeFocusColumn> = {};
  focusList.statuses.forEach((s, rank) => {
    const { rows: kept, more } = page(byBucket.get(s.value) ?? []);
    const cards = kept.map((r) => toCard(r, people, rank));
    const last = cards[cards.length - 1];
    columns[s.value] = {
      cards,
      nextCursor: more && last ? encodeBucketCursor(last.position, last.id) : null,
      total: own.statusCounts[s.value] ?? 0,
    };
  });
  return { counts, columns };
}

/** The next page of one focus column. BUCKET is the partition's own fragment. */
export async function loadFocusPage(
  list: LoaderList,
  bucketValue: string,
  filters: BirdseyeFilters,
  cursor: BucketCursor,
  orgId: string,
): Promise<{ cards: BirdseyeCard[]; nextCursor: string | null }> {
  const closed = filters.hideClosed ? ((await countLists([list], filters, orgId))[list.id]?.closed ?? []) : [];
  const declared = jsonParam(list.statuses.map((s) => s.value));
  const first = list.statuses[0]?.value ?? "";
  const rank = Math.max(0, list.statuses.findIndex((s) => s.value === bucketValue));
  const rows = await prisma.$queryRaw<CardRow[]>`
    SELECT y.*, ${subtasksOf(Prisma.sql`y`)} AS "subtaskCount"
    FROM (
      SELECT ${CARD_COLUMNS}
      FROM "Item" i
      WHERE i."boardId" = ${list.id}
        AND i."organizationId" = ${orgId}
        AND i."archivedAt" IS NULL
        AND ${TOP}
        ${search(filters.q)}
        ${hideClosedClause(filters, jsonParam(closed))}
        AND ${bucketOf(declared, first)} = ${bucketValue}::text
        AND (i.position, i.id) > (${cursor.position}::float8, ${cursor.id}::text)
      ORDER BY i.position, i.id
      LIMIT ${LIMIT}
    ) y
  `;
  const people = await peopleFor(rows, orgId);
  const { rows: kept, more } = page(rows);
  const cards = kept.map((r) => toCard(r, people, rank));
  const last = cards[cards.length - 1];
  return { cards, nextCursor: more && last ? encodeBucketCursor(last.position, last.id) : null };
}
