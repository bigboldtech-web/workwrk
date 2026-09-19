// GET /api/activity/types — the Filter panel's Type list.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity, Data):
// "`GET /api/activity/types` (new, the distinct lowercase families)".
//
// It answers with FAMILIES in user words (Tasks, Docs, SOPs, Goals, People,
// Spaces and Lists, Kudos, Settings), each carrying the stored `targetType`
// spellings it covers, because the app writes the same family four ways
// ("task", "TASK", "item") and a person filtering by "Tasks" means all of them.
//
// Only families that actually have rows in the viewer's scope are returned, so
// the panel never offers a checkbox that can only ever say "No results".

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { loadOrgFacts } from "@/lib/access/facts";
import { getTeamUserIds } from "@/lib/team";
import { parseActivityScope, scopeAllowed, viewerScopeFacts } from "@/lib/activity-scope";
import { ACTIVITY_FAMILY_LABEL, familiesOf, typesInFamily } from "@/lib/activity-targets";
import type { Prisma } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    const scope = parseActivityScope(new URL(req.url).searchParams.get("scope"));
    const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
    if (!scopeAllowed(scope, viewerScopeFacts(viewer, org.peopleTeamIds))) {
      return jsonError("no_access", 403);
    }

    const where: Prisma.ActivityLogWhereInput = { organizationId: viewer.organizationId };
    if (scope === "my") {
      where.actorId = viewer.userId;
    } else if (scope === "team") {
      const ids = await getTeamUserIds(viewer.organizationId, viewer.userId);
      where.actorId = { in: [...new Set([viewer.userId, ...ids])] };
    }

    const rows = await prisma.activityLog.groupBy({
      by: ["targetType"],
      where,
      _count: { _all: true },
    });

    const stored = rows.map((r) => r.targetType);
    const countByType = new Map(rows.map((r) => [r.targetType ?? "", r._count._all]));

    const families = familiesOf(stored).map((family) => {
      const types = typesInFamily(family, stored);
      // A family with only null-targetType rows still counts: they are real
      // activity, they just point at nothing.
      const count = types.reduce((n, t) => n + (countByType.get(t) ?? 0), 0)
        + (family === "other" ? countByType.get("") ?? 0 : 0);
      return { key: family, label: ACTIVITY_FAMILY_LABEL[family], types, count };
    });

    return jsonSuccess({ families }, 200, { "Cache-Control": "private, max-age=30" });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
