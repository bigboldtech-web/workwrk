// GET /api/export/assets?scope=&status=&condition=&type=&assignedTo=&warrantyWithin=&q=&sort=&ids=
//
// The "…" menu's Export CSV and the bulk bar's Export on /assets
// (spec-tools-misc 2.2). It exports what the caller can see, through the
// same scope and filters as the list, so an export can never widen what a
// filter narrowed; `ids` (the bulk bar) narrows further. Never an Agent or
// an acting-as session (access section 9, the export rule). Exact figures,
// never the compact "$1.2K": a register is a record.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-helpers";
import { csvFilename, csvFormulaSafe, toCsv, type CsvCell } from "@/lib/csv";
import { applyAssetFilters, assetOrderBy, parseAssetFilters, resolveAssetReadScope } from "@/lib/assets/asset-query";
import { CONDITION_LABEL, STATUS_LABEL, personName, typeLabel, type AssetCondition, type AssetStatus } from "@/lib/assets/asset-view";

const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const sp = new URL(req.url).searchParams;
  const scope = await resolveAssetReadScope(session, { mine: false, requestedScope: sp.get("scope"), assignedToId: sp.get("assignedTo") });
  if ("error" in scope) return scope.error;
  if (scope.mine) return jsonError("not_found", 404);
  if (scope.viewer.isAgent || scope.viewer.actingAs) {
    return jsonError("Exports are not available to agents or while acting as somebody else.", 403);
  }
  const filters = parseAssetFilters(sp);
  const where = applyAssetFilters(scope.where, filters);
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length) where.id = { in: ids };

  const rows = await prisma.asset.findMany({
    where,
    include: { assignedTo: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: assetOrderBy(filters.sort),
    take: MAX_ROWS,
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const text = (v: string | null | undefined) => (v ? csvFormulaSafe(v) : "");
  const data: Record<string, CsvCell>[] = rows.map((a) => ({
    Asset: text(a.name),
    Type: typeLabel(a.type),
    Brand: text(a.brand),
    Model: text(a.model),
    Serial: text(a.serialNumber),
    IMEI: text(a.imeiNumber),
    Status: STATUS_LABEL[a.status as AssetStatus] ?? a.status,
    Condition: CONDITION_LABEL[a.condition as AssetCondition] ?? a.condition,
    "Assigned to": text(personName(a.assignedTo)),
    "Assigned to email": a.assignedTo?.email ?? "",
    "Assigned since": day(a.assignedAt),
    "Purchase date": day(a.purchaseDate),
    "Purchase cost": a.purchaseCost ?? "",
    "Warranty ends": day(a.warrantyExpiry),
    Notes: text(a.notes),
    Added: day(a.createdAt),
  }));
  const csv = toCsv(data, ["Asset", "Type", "Brand", "Model", "Serial", "IMEI", "Status", "Condition", "Assigned to", "Assigned to email", "Assigned since", "Purchase date", "Purchase cost", "Warranty ends", "Notes", "Added"]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("assets")}"`,
      "Cache-Control": "no-store",
    },
  });
}
