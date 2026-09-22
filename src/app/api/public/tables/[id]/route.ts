// GET /api/public/tables/[id]   read-only public table data (no auth)
//
// Returns columns + rows for a DataTable, but only if its `isPublic`
// flag is true. Mirrors the public-form responder pattern. No write
// methods on this path; for writes, callers must use the authenticated
// /api/tables/[id]/rows route.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const table = await prisma.dataTable.findFirst({
    where: { id, isPublic: true },
    // `settings` is selected but NEVER returned whole. It is the table's
    // private blob (saved views, freeze positions, conditional formats and
    // whatever a later release puts there), and this route answers with no
    // authentication at all. Only `namedRanges` is copied out, because the
    // embed has to evaluate formulas and a formula written as SUM(Revenue)
    // resolves to #NAME? without the name that defines it.
    select: { id: true, name: true, description: true, columns: true, settings: true },
  });
  if (!table) return jsonError("not found", 404);

  // Defensive on every field: settings is Json, so anything could be in it.
  const settings = table.settings as { namedRanges?: unknown } | null;
  const namedRanges = Array.isArray(settings?.namedRanges)
    ? settings.namedRanges.filter(
        (r): r is { name: string; ref: string } =>
          !!r && typeof r === "object" &&
          typeof (r as { name?: unknown }).name === "string" &&
          typeof (r as { ref?: unknown }).ref === "string",
      )
    : [];

  const rows = await prisma.dataTableRow.findMany({
    where: { tableId: id, deletedAt: null },
    // Same composite order as the app grid's keyset route, so a table with
    // duplicate positions renders identically in the embed. The embed keeps
    // a 5k cap for now (no streaming client here) — recorded follow-up.
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 5000,
    select: { id: true, values: true, position: true },
  });

  // Spread the named fields, never `...table`: that would put the whole
  // settings blob on an unauthenticated response.
  return jsonSuccess({
    id: table.id,
    name: table.name,
    description: table.description,
    columns: table.columns,
    namedRanges,
    rows,
  });
}
