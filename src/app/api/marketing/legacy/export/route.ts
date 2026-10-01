// "Marketing (legacy) CSV": GET ?entity=campaigns|content|events, one file
// per entity (spec-tools-misc section 2.7). Owner and Admin, through the Data
// gate, and recorded in the audit trail like every other export.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";
import { csvFilename } from "@/lib/csv";
import { legacyMarketingCsv } from "@/lib/marketing/legacy-export";
import { MARKETING_KINDS, type MarketingKind } from "@/lib/marketing/legacy-map";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("manage", { type: "settings", page: "data" });
    const entity = new URL(req.url).searchParams.get("entity") ?? "";
    if (!(MARKETING_KINDS as readonly string[]).includes(entity)) return jsonError("Unsupported export entity", 400);
    const kind = entity as MarketingKind;
    const { csv, rows } = await legacyMarketingCsv(viewer.organizationId, kind);
    logActivity({
      type: "csv_exported",
      actorId: viewer.userId,
      organizationId: viewer.organizationId,
      description: `Exported legacy marketing ${kind} CSV (${rows} ${rows === 1 ? "row" : "rows"})`,
      targetType: "export",
      severity: rows > 1000 ? "warning" : "info",
    });
    const filename = csvFilename(`marketing-${kind}`);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
