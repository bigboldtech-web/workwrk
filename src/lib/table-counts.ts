// filledRowCount (spec-tables-forms section 2 /tables, data.md 3.14): the
// rows of a table that hold at least one non-empty value. A brand new table
// is 26 columns by 1,000 BLANK rows, and counting those made every new table
// read "1000 rows". Computed, never stored (data migration (d)).
//
// Empty means what the grid treats as an empty cell: JSON null, "", [] and
// {}. The reserved row keys (values["$fmt"] cell styles, values["$rh"] row
// height, every key starting "$") are layout, not data, so a styled but
// empty row still counts as empty.
//
// A row whose values is not a JSON object (an array, a scalar, JSON null)
// counts as empty instead of making jsonb_each raise and 500 the whole list:
// the CASE hands jsonb_each an empty object for it. A CASE, not an AND on
// jsonb_typeof, because Postgres does not promise the order of AND terms.

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";

/** The SQL test for "this row holds data" on a DataTableRow aliased r: at
 *  least one non-reserved key with a non-empty value. Shared by the counts
 *  here, by lastFilledPosition and by a goal's table count (liveTableRows),
 *  so they can never disagree. */
const ROW_HAS_DATA = Prisma.sql`EXISTS (
  SELECT 1 FROM jsonb_each(
    CASE WHEN jsonb_typeof(r."values"::jsonb) = 'object' THEN r."values"::jsonb ELSE '{}'::jsonb END
  ) e
  WHERE left(e.key, 1) <> '$'
    AND e.value <> 'null'::jsonb
    AND e.value <> '""'::jsonb
    AND e.value <> '[]'::jsonb
    AND e.value <> '{}'::jsonb
)`;

/** The position of the last live row of a table that holds data, or null
 *  when every live row is blank (a brand new table). An append lands on the
 *  first blank row after it (the form responses route), not after the
 *  seeded blank rows. */
export async function lastFilledPosition(tableId: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ p: number | null }[]>`
    SELECT MAX(r."position") AS p
    FROM "DataTableRow" r
    WHERE r."tableId" = ${tableId}
      AND r."deletedAt" IS NULL
      AND ${ROW_HAS_DATA}
  `;
  const p = rows[0]?.p;
  return p === null || p === undefined ? null : Number(p);
}

/** A live row of a table as a goal counts it: its values, and whether it holds data by the rule above. */
export interface CountedTableRow {
  id: string;
  values: unknown;
  filled: boolean;
}

/**
 * The live rows of one table for a goal's count (docs/plans/recurring-goals.md
 * C5), in the grid's storage order (position, then id), each with `filled`
 * decided by ROW_HAS_DATA, so a goal counts exactly the rows the Tables list
 * does. `filledOnly` reads only the rows that hold data (a count over plain
 * columns); without it every live row comes back (the engine anchors A1 row N
 * to storage index N-1, so a formula needs the blank rows in place).
 */
export async function liveTableRows(tableId: string, opts: { filledOnly: boolean }): Promise<CountedTableRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; values: unknown; filled: boolean }[]>`
    SELECT r."id" AS "id", r."values" AS "values", ${ROW_HAS_DATA} AS "filled"
    FROM "DataTableRow" r
    WHERE r."tableId" = ${tableId}
      AND r."deletedAt" IS NULL
      ${opts.filledOnly ? Prisma.sql`AND ${ROW_HAS_DATA}` : Prisma.empty}
    ORDER BY r."position" ASC, r."id" ASC
  `;
  return rows.map((r) => ({ id: r.id, values: r.values, filled: r.filled === true }));
}

export async function filledRowCounts(tableIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tableIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ tableId: string; n: bigint | number }[]>`
    SELECT r."tableId" AS "tableId", COUNT(*) AS n
    FROM "DataTableRow" r
    WHERE r."tableId" IN (${Prisma.join(tableIds)})
      AND r."deletedAt" IS NULL
      AND ${ROW_HAS_DATA}
    GROUP BY r."tableId"
  `;
  for (const r of rows) out.set(r.tableId, Number(r.n));
  return out;
}
