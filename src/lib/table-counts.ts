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
 *  here and by lastFilledPosition, so the two can never disagree. */
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
