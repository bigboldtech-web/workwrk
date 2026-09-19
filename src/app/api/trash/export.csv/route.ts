// GET /api/trash/export.csv?tab=&type=&q=
//
// The "…" menu's Export list (spec-spaces-lists section 2 /trash). Owner and
// Admin only, and never an Agent or an acting-as session: an export is the one
// action that takes data out of the product, so it follows the export rule in
// access section 9 rather than the page's own read gate.
//
// It exports what the caller can see, through the same reader the page uses,
// so an export can never widen what a filter narrowed.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";
import { readTrash } from "@/lib/trash-server";
import { idsFromParam, sortFromParam, tabFromParam, trashCsv, typesFromParam, type TrashCsvRow } from "@/lib/trash-view";

/** One page is 200 rows; the export walks them all rather than truncating. */
const PAGE = 200;
const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    if (viewer.orgRole !== "OWNER" && viewer.orgRole !== "ADMIN") {
      return jsonError("Only an Admin or the Owner can export the trash list.", 403);
    }
    if (viewer.isAgent || viewer.actingAs) {
      return jsonError("Exports are not available to agents or while acting as somebody else.", 403);
    }

    const sp = new URL(req.url).searchParams;
    const tab = tabFromParam(sp.get("tab"));
    const query = {
      tab,
      types: typesFromParam(sp.get("type")),
      q: sp.get("q"),
      deletedBy: idsFromParam(sp.get("deletedBy")),
      spaceId: idsFromParam(sp.get("spaceId")),
      expiringSoon: sp.get("expiring") === "1",
      sort: sortFromParam(sp.get("sort")),
      cursor: 0,
      limit: PAGE,
    };

    const out: TrashCsvRow[] = [];
    let cursor: number | null = 0;
    while (cursor !== null && out.length < MAX_ROWS) {
      const page = await readTrash(viewer, { ...query, cursor });
      for (const r of page.rows) {
        out.push({
          name: r.name,
          type: r.typeLabel,
          location: r.location,
          deletedByName: r.deletedBy?.name ?? "",
          deletedAt: r.deletedAt,
          timeLeft: r.daysLeft === null ? "" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`,
        });
      }
      cursor = page.nextCursor;
    }

    return new Response(trashCsv(out, tab), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trash-${tab}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
