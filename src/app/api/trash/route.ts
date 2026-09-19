// GET /api/trash?tab=deleted|archived&type=&q=&deletedBy=&spaceId=&expiring=1&sort=&cursor=
//
// `?type=` accepts one key or a comma list, so the Filter panel's checkboxes
// narrow the whole set rather than the page the browser is holding.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/trash).
//
// THE READ NO LONGER DELETES. The old handler called purgeExpiredTrash plus
// three deleteMany calls before it answered, so every page load destroyed
// expired rows and two concurrent callers destroyed them twice. The purge is a
// cron row now (scripts/CRON-SETUP.md, POST /api/cron/trash-purge), which is
// also the only way a retention window can be honoured when nobody happens to
// open the page.
//
// THE GATE MOVED. It was `isManager`, so a Member who deleted their own list
// was told "Trash is for managers" (work-tasks #11). It is the `trash` app key
// plus per-source `accessibleIds(type, FULL)` now, with "rows you deleted
// yourself" as the floor, and Owner and Admin over the org.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { readTrash } from "@/lib/trash-server";
import { idsFromParam, sortFromParam, tabFromParam, typesFromParam } from "@/lib/trash-view";

const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "trash" });
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get("limit") ?? "40", 10) || 40));
    const cursor = Math.max(0, parseInt(sp.get("cursor") ?? "0", 10) || 0);

    const page = await readTrash(viewer, {
      tab: tabFromParam(sp.get("tab")),
      types: typesFromParam(sp.get("type")),
      q: sp.get("q"),
      deletedBy: idsFromParam(sp.get("deletedBy")),
      spaceId: idsFromParam(sp.get("spaceId")),
      expiringSoon: sp.get("expiring") === "1",
      sort: sortFromParam(sp.get("sort")),
      cursor,
      limit,
    });

    return jsonSuccess(page, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
