// GET /api/analytics/export.csv — the Analytics "…" menu's Export CSV.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/analytics, Data):
// "`GET /api/analytics/export.csv` (new)", with the toolbar rule "`export`:
// Admin for org-wide, otherwise the viewer's chain; never Guests, Agents,
// acting-as".
//
// Same gate and the same scope check as the feed it exports, so a CSV can never
// reach past the pill the viewer was allowed to click. The numbers come from
// buildAnalytics, so the file and the screen cannot disagree.

import { NextRequest } from "next/server";
import { AccessError, requireCan } from "@/lib/access/gate";
import { loadOrgFacts } from "@/lib/access/facts";
import { jsonError } from "@/lib/api-helpers";
import {
  ANALYTICS_TILES,
  analyticsScopeAllowed,
  buildAnalytics,
  formatTileValue,
  parseAnalyticsScope,
  periodDays,
  periodLabel,
  personName,
  viewerAnalyticsFacts,
} from "@/lib/analytics";
import { csvCell } from "@/lib/trash-view";

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "analytics" });
    if (viewer.orgRole === "GUEST" || viewer.isAgent || viewer.actingAs) {
      return jsonError("Exports are not available to guests, agents, or while acting as somebody else.", 403);
    }

    const sp = new URL(req.url).searchParams;
    const scope = parseAnalyticsScope(sp.get("view") ?? sp.get("scope"));
    const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
    if (!analyticsScopeAllowed(scope, viewerAnalyticsFacts(viewer, org.peopleTeamIds))) {
      return jsonError("no_access", 403);
    }

    const period = sp.get("period");
    const result = await buildAnalytics(viewer, {
      scope,
      days: periodDays(period),
      personId: sp.get("personId"),
      departmentId: sp.get("departmentId"),
    });

    const lines: string[] = [];

    // Three sections in one file, each with its own header row, because the
    // page shows three things and a single flat table could only be one of them.
    lines.push(["Analytics", scope === "org" ? "Everyone" : "My team", periodLabel(period)].map(csvCell).join(","));
    lines.push(["From", result.from, "To", result.to].map(csvCell).join(","));
    lines.push("");

    lines.push(["Measure", "Value", "Previous"].map(csvCell).join(","));
    for (const tile of ANALYTICS_TILES) {
      lines.push(
        [
          tile.label,
          formatTileValue(tile, result.totals[tile.key]),
          tile.comparable ? formatTileValue(tile, result.previous[tile.key]) : "",
        ].map(csvCell).join(","),
      );
    }
    lines.push("");

    lines.push(["Person", "Open", "Done", "Overdue", "Hours", "SOP acks"].map(csvCell).join(","));
    for (const p of result.people) {
      lines.push(
        [personName(p), p.open, p.done, p.overdue, p.hours, p.sopAcks].map((v) => csvCell(String(v))).join(","),
      );
    }
    lines.push("");

    lines.push(["List", "Space", "Open", "Done", "Overdue"].map(csvCell).join(","));
    for (const l of result.lists) {
      lines.push([l.name, l.spaceName ?? "", l.open, l.done, l.overdue].map((v) => csvCell(String(v))).join(","));
    }
    lines.push("");

    lines.push(["Week beginning", "Completed"].map(csvCell).join(","));
    for (const w of result.weekly) {
      lines.push([w.weekStart, String(w.completed)].map(csvCell).join(","));
    }

    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${scope}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
