// POST /api/tables/[id]/import  { csv }
//
// Parse a CSV body, match headers to existing columns by case-insensitive
// label match, auto-create any new headers as short_text columns,
// then bulk-create one row per CSV row.
//
// Phase 36 — visibility-gated. Same pattern as /api/tables/[id]/rows:
// the table is only writable if the viewer can read its parent Space
// (org-wide tables stay open to all org members). Phase 22b/32b
// closed the read holes; this closes the analogous write hole on
// bulk import — without it, any org member could blast 5K rows into
// any private-Space table.

import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getSpaceForReader } from "@/lib/space";

type Column = { id: string; type: string; label: string; options?: string[] };

const MAX_ROWS = 5000;

async function resolveTable(id: string, orgId: string, userId: string, accessLevel: string | null | undefined) {
  const table = await prisma.dataTable.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, columns: true, spaceId: true },
  });
  if (!table) return null;
  if (table.spaceId) {
    const space = await getSpaceForReader(table.spaceId, userId, accessLevel ?? "EMPLOYEE");
    if (!space) return null;
  }
  return table;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const userId = getUserId(session);
  const accessLevel = (session.user as { accessLevel?: string }).accessLevel;
  const { id } = await params;

  const body = await req.json();
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) return jsonError("csv body required");

  const table = await resolveTable(id, orgId, userId, accessLevel);
  if (!table) return jsonError("not found", 404);

  const parsed = parseCsv(csv);
  if (parsed.length === 0) return jsonError("CSV had no rows");
  const [headers, ...dataRows] = parsed;
  if (headers.length === 0) return jsonError("CSV has no header row");
  if (dataRows.length > MAX_ROWS) return jsonError(`too many rows (max ${MAX_ROWS})`);

  const columns = Array.isArray(table.columns) ? [...(table.columns as Column[])] : [];

  // Map each CSV header to an existing column (by case-insensitive label)
  // or create a new short_text column.
  const headerToColId: string[] = [];
  let columnsAdded = 0;
  for (const header of headers) {
    const existing = columns.find((c) => c.label.trim().toLowerCase() === header.trim().toLowerCase());
    if (existing) {
      headerToColId.push(existing.id);
    } else {
      const newCol: Column = {
        id: Math.random().toString(36).slice(2, 10),
        type: "short_text",
        label: header.trim() || "Untitled",
      };
      columns.push(newCol);
      headerToColId.push(newCol.id);
      columnsAdded += 1;
    }
  }

  if (columnsAdded > 0) {
    await prisma.dataTable.update({
      where: { id: table.id },
      data: { columns: columns as unknown as Prisma.InputJsonValue },
    });
  }

  // Figure out the starting position (append after existing rows).
  const max = await prisma.dataTableRow.findFirst({
    where: { tableId: table.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const startPos = (max?.position ?? 0) + 1;

  // Build the row payloads and createMany.
  const data = dataRows.map((row, i) => {
    const values: Record<string, unknown> = {};
    row.forEach((cell, idx) => {
      const colId = headerToColId[idx];
      if (colId && cell !== "") values[colId] = cell;
    });
    return {
      organizationId: orgId,
      tableId: table.id,
      values: values as Prisma.InputJsonValue,
      position: startPos + i,
      createdById: userId,
    };
  });

  await prisma.dataTableRow.createMany({ data });

  return jsonSuccess({
    columnsAdded,
    rowsCreated: data.length,
  });
}

// Minimal CSV parser. Handles: comma separators, double-quoted fields,
// escaped quotes ("" inside quotes), \r\n or \n line endings, trailing
// empty line. NOT for arbitrary user-uploaded malformed CSVs at scale —
// good enough for the import flow.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* skip — handle on \n */ }
      else { cell += ch; }
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
}
