// GET /api/activity/export.csv — the Activity "…" menu's Export CSV.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity):
// '"…" with Export CSV (`export` action; never Guests, Agents, acting-as)'.
//
// Same scope rule as the feed, so an export can never reach past the pill the
// viewer is allowed to click.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";
import { loadOrgFacts } from "@/lib/access/facts";
import { getTeamUserIds } from "@/lib/team";
import { parseActivityScope, scopeAllowed, viewerScopeFacts } from "@/lib/activity-scope";
import { targetFor, verbFor } from "@/lib/activity-targets";
import { csvCell } from "@/lib/trash-view";
import type { Prisma } from "@/generated/prisma";

const MAX_ROWS = 10_000;

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    if (viewer.orgRole === "GUEST" || viewer.isAgent || viewer.actingAs) {
      return jsonError("Exports are not available to guests, agents, or while acting as somebody else.", 403);
    }

    const sp = new URL(req.url).searchParams;
    const scope = parseActivityScope(sp.get("scope"));
    const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
    if (!scopeAllowed(scope, viewerScopeFacts(viewer, org.peopleTeamIds))) return jsonError("no_access", 403);

    const where: Prisma.ActivityLogWhereInput = { organizationId: viewer.organizationId };
    if (scope === "my") {
      where.actorId = viewer.userId;
    } else if (scope === "team") {
      const ids = await getTeamUserIds(viewer.organizationId, viewer.userId);
      where.actorId = { in: [...new Set([viewer.userId, ...ids])] };
    }
    const targetTypes = (sp.get("targetType") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (targetTypes.length) where.targetType = { in: targetTypes };
    const from = sp.get("from");
    if (from && !Number.isNaN(Date.parse(from))) where.createdAt = { gte: new Date(from) };

    const rows = await prisma.activityLog.findMany({
      where,
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });

    const lines = [["When", "Who", "Did", "Kind", "Target", "Detail"].map(csvCell).join(",")];
    for (const r of rows) {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const name = ["name", "title", "label"].map((k) => meta[k]).find((v) => typeof v === "string" && v.trim());
      lines.push(
        [
          r.createdAt.toISOString(),
          `${r.actor?.firstName ?? ""} ${r.actor?.lastName ?? ""}`.trim(),
          verbFor(r.type),
          targetFor(r.targetType).family,
          typeof name === "string" ? name : "",
          r.description ?? "",
        ].map(csvCell).join(","),
      );
    }

    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="activity-${scope}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
