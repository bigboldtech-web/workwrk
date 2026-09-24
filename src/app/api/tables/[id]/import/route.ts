// POST /api/tables/[id]/import  { csv, hasHeader?, columns? }
//
// Parse a CSV body, match headers to existing columns by case-insensitive
// label match, auto-create any new headers as short_text columns,
// then write one row per CSV row.
//
// The in-place import dialog (spec-tables-forms section 3, CsvImportDialog)
// adds two optional fields, and a body without them behaves exactly as before:
//   hasHeader  false = the first line is data; columns are "Column 1", ...
//   columns    one entry per CSV column, in order: { target } names an
//              existing column id to write into, { label, type } makes a new
//              column with that name and type, { skip: true } drops it.
//
// Rows land after the LAST ROW THAT HOLDS DATA, reusing the blank rows a
// sheet-born table is seeded with (a new table has 1,000 of them): an
// import into a fresh table starts at row 1, not row 1,001. A blank row is
// one with no non-empty value in any column; its reserved keys (cell styles,
// row height) are kept, never overwritten. When the blank tail runs out the
// rest are appended.
//
// Cell typing: a CSV is all text. Cells landing in an OPEN column
// (short_text, the type every new column is born with) go through the same
// entry-time typing as the editor, so "5" imports as the number 5 and
// =SUM over the column works straight away. Every other column type keeps
// storing the raw text: numeric-typed columns are read as numbers by the
// engine anyway (sheet-engine-host literalAt), and long_text/email/url/...
// are text by definition.
//
// Phase 36, visibility-gated. Same pattern as /api/tables/[id]/rows:
// the table is only writable if the viewer can read its parent Space
// (org-wide tables stay open to all org members). Phase 22b/32b
// closed the read holes; this closes the analogous write hole on
// bulk import, without it, any org member could blast 5K rows into
// any private-Space table.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionAndModule, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";
import { unscopedTableReadable } from "@/lib/table-gate";
import { autoTypeForColumn } from "@/lib/sheet-entry";
import { parseCsv } from "@/lib/csv";
import { blankTail as blankTailOf, reservedKeysOf } from "@/lib/sheet-blank-tail";

type Column = { id: string; type: string; label: string; options?: string[] };

const MAX_ROWS = 5000;

async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, columns: true, spaceId: true, createdById: true },
  });
  if (!table) return null;
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return null;
  } else if (!unscopedTableReadable(table.createdById, userId, accessLevel)) {
    // No Space: org-wide for Members, a Guest's own only (lib/table-visibility).
    return null;
  }
  return table;
}

const IMPORT_TYPES = new Set([
  "short_text", "long_text", "number", "currency", "percent", "rating", "select", "multi_select",
  "date", "checkbox", "url", "email",
]);

type ColumnPlan = { target?: string; label?: string; type?: string; skip?: boolean };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionAndModule("workwrk-tables");
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const csv = typeof body?.csv === "string" ? body.csv : "";
  if (!csv.trim()) return jsonError("csv body required");
  const hasHeader = body?.hasHeader !== false;
  const plan: ColumnPlan[] | null = Array.isArray(body?.columns) ? (body.columns as ColumnPlan[]) : null;

  const table = await resolveTable(id, orgId, userId, accessLevel);
  if (!table) return jsonError("not found", 404);

  const parsed = parseCsv(csv);
  if (parsed.length === 0) return jsonError("CSV had no rows");
  const width = parsed.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = hasHeader ? parsed[0] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? parsed.slice(1) : parsed;
  if (headers.length === 0) return jsonError("CSV has no header row");
  if (dataRows.length > MAX_ROWS) return jsonError(`too many rows (max ${MAX_ROWS})`);

  const columns = Array.isArray(table.columns) ? [...(table.columns as Column[])] : [];

  // Map each CSV column to an existing column (the plan's target, else a
  // case-insensitive label match) or a new column. null = skipped.
  const headerToColId: (string | null)[] = [];
  let columnsAdded = 0;
  // A CSV column written INTO an existing column that has no name yet (every
  // column of a sheet-born table starts unnamed, shown by its letter) gives
  // that column the CSV's header text, so appending "Name,Amount" into a
  // fresh table keeps the names instead of consuming the header row and
  // storing it nowhere. A named column keeps its name, and a header already
  // used by another column is not repeated. An unnamed column has no name
  // for a formula to reference, so naming it rewrites no formula.
  let columnsNamed = 0;
  const takenLabels = new Set(columns.map((c) => (c.label ?? "").trim().toLowerCase()).filter(Boolean));
  headers.forEach((header, idx) => {
    const p = plan?.[idx];
    if (p?.skip) { headerToColId.push(null); return; }
    if (p?.target && columns.some((c) => c.id === p.target)) {
      const col = columns.find((c) => c.id === p.target)!;
      const name = hasHeader ? (header ?? "").trim().slice(0, 200) : "";
      if (name && !(col.label ?? "").trim() && !takenLabels.has(name.toLowerCase())) {
        const at = columns.indexOf(col);
        columns[at] = { ...col, label: name };
        takenLabels.add(name.toLowerCase());
        columnsNamed += 1;
      }
      headerToColId.push(p.target);
      return;
    }
    const label = (typeof p?.label === "string" ? p.label : header).trim().slice(0, 200);
    const existing = !p && label ? columns.find((c) => (c.label ?? "").trim().toLowerCase() === label.toLowerCase()) : undefined;
    if (existing) { headerToColId.push(existing.id); return; }
    const newCol: Column = {
      id: Math.random().toString(36).slice(2, 10),
      type: p?.type && IMPORT_TYPES.has(p.type) ? p.type : "short_text",
      label: label || "Untitled",
    };
    columns.push(newCol);
    headerToColId.push(newCol.id);
    columnsAdded += 1;
  });

  if (columnsAdded > 0 || columnsNamed > 0) {
    await prisma.dataTable.update({
      where: { id: table.id },
      data: { columns: columns as unknown as Prisma.InputJsonValue },
    });
  }

  const typeByColId = new Map(columns.map((c) => [c.id, c.type]));
  const valuesFor = (row: string[]) => {
    const values: Record<string, unknown> = {};
    row.forEach((cell, idx) => {
      const colId = headerToColId[idx];
      if (colId && cell !== "") values[colId] = autoTypeForColumn(typeByColId.get(colId) ?? "", cell);
    });
    return values;
  };

  // The blank tail: every live row after the last one holding data.
  const live = await prisma.dataTableRow.findMany({
    where: { tableId: table.id, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, values: true, position: true },
  });
  const blankTail = blankTailOf(live);
  const plannedReuse = Math.min(blankTail.length, dataRows.length);

  // The tail was read outside the transaction, so a co-editor may type into
  // a "blank" row before the import reaches it. Each reuse is a compare and
  // set: the update only lands while the row still holds exactly the values
  // read above. At the first row that changed (or was deleted), reuse stops
  // and every remaining imported row is appended instead, so the import
  // keeps its order and never overwrites a cell someone else just typed.
  let reuse = 0;
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < plannedReuse; i++) {
      const target = blankTail[i];
      // A JSON null body cannot be compared here; append rather than guess.
      if (target.values === null) break;
      const keep = reservedKeysOf(target.values);
      const res = await tx.dataTableRow.updateMany({
        where: {
          id: target.id,
          tableId: table.id,
          deletedAt: null,
          values: { equals: target.values as Prisma.InputJsonValue },
        },
        data: { values: { ...keep, ...valuesFor(dataRows[i]) } as Prisma.InputJsonValue },
      });
      if (res.count === 0) break;
      reuse += 1;
    }
    const appendRows = dataRows.slice(reuse);
    if (appendRows.length > 0) {
      // Read the end of the table inside the transaction: rows a co-editor
      // added since the tail read sit above the appended block.
      const last = await tx.dataTableRow.aggregate({ where: { tableId: table.id }, _max: { position: true } });
      const maxPos = last._max.position ?? 0;
      await tx.dataTableRow.createMany({
        data: appendRows.map((row, i) => ({
          organizationId: orgId,
          tableId: table.id,
          values: valuesFor(row) as Prisma.InputJsonValue,
          position: maxPos + 1 + i,
          createdById: userId,
        })),
      });
    }
  }, { timeout: 60_000 });
  // Touch the table so the lists' Last updated reflects the import.
  await prisma.dataTable.update({ where: { id: table.id }, data: { updatedAt: new Date() } }).catch(() => undefined);

  return jsonSuccess({
    columnsAdded,
    columnsNamed,
    rowsCreated: dataRows.length,
    rowsReused: reuse,
  });
}
