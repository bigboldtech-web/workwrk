// GET /api/activity?scope=my|team|all&type=&actorIds=&from=&to=&page=&limit=50
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity, Data).
//
// THE SILENT DOWNGRADE IS GONE. The old handler read
//
//   if (scope === "my" || !userIsManager) where.actorId = userId;
//
// so an IC who clicked "My team" or "Everyone" got their OWN rows back with
// the other pill still lit: the page said one thing and the data said another
// (work-tasks #8). A scope the viewer may not use is an explicit 403 now, and
// the page never asks for it because it never renders the pill.
//
// The rule is the access model's own vocabulary rather than a new app key:
// `activity` is not an `AppEntry.key` and section 5.2.1 has no row for it, so
// the route gates on `home` like every other Work-hub page and then asks the
// same question the pills ask.
//
//   scope=team  needs reports, at any depth, solid or dotted
//   scope=all   needs the People team, Owner or Admin
//
// A PERSON'S OWN TEAMMATE ROWS ARE THEIRS (review round 1 of Phase 4). What a
// teammate did in someone's browser or Google, their browser sessions and
// take overs, and their Google connection (src/lib/access/personal-activity.ts
// PERSONAL_TEAMMATE_ACTIVITY_TYPES) reach My team and Everyone only for an
// Owner or an Admin; anyone else, in every scope, sees only the ones about
// them. A manager no longer reads which sites a report's teammate used.
//
// ONLY WHAT THE PAGE DRAWS (review round 1 of Phase 4). A row answers its id,
// type, sentence, target, time and actor, and of its metadata only the name
// keys the page's chip falls back to; never the rest of its metadata, its IP
// address or its user agent, which are the audit log's.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { parsePaginationParams, skipTake } from "@/lib/pagination";
import { loadOrgFacts } from "@/lib/access/facts";
import { getTeamUserIds } from "@/lib/team";
import { parseActivityScope, scopeAllowed, viewerScopeFacts } from "@/lib/activity-scope";
import { activityTargets, nodeCtxFromViewer } from "@/lib/access/node-access";
import { activityScopeWhere } from "@/lib/access/personal-activity";
import type { Viewer } from "@/lib/access/types";
import type { Prisma } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  try {
    const { viewer } = await requireCan("view", { type: "app", key: "home" });
    const sp = new URL(req.url).searchParams;
    const pagination = parsePaginationParams(req);
    const scope = parseActivityScope(sp.get("scope"));

    const org = await loadOrgFacts(viewer.organizationId).catch(() => ({ peopleTeamIds: [] as string[] }));
    if (!scopeAllowed(scope, viewerScopeFacts(viewer, org.peopleTeamIds))) {
      // Explicit, not a silent narrowing: the caller learns the pill is not
      // theirs instead of being handed somebody else's answer.
      return jsonError("no_access", 403);
    }

    // Your own rows are part of your team's activity; a manager looking at
    // "My team" with nothing of their own in it reads as a bug.
    // scope === "all": no actor filter, and only a viewer who passed the gate.
    const teamIds = scope === "team" ? await getTeamUserIds(viewer.organizationId, viewer.userId) : [];
    const where: Prisma.ActivityLogWhereInput = activityScopeWhere(viewer, scope, teamIds);

    const types = (sp.get("type") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (types.length) where.type = { in: types };

    const targetTypes = (sp.get("targetType") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (targetTypes.length) where.targetType = { in: targetTypes };

    const actorIds = (sp.get("actorIds") ?? sp.get("actorId") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (actorIds.length && scope !== "my") {
      // Narrow within the scope, never outside it: intersecting keeps a
      // ?actorIds= from reaching past what the scope already allows.
      const allowed = where.actorId && typeof where.actorId === "object" && "in" in where.actorId
        ? new Set(where.actorId.in as string[])
        : null;
      const ids = allowed ? actorIds.filter((id) => allowed.has(id)) : actorIds;
      where.actorId = { in: ids.length ? ids : ["__none"] };
    }

    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) {
      where.createdAt = {
        ...(from && !Number.isNaN(Date.parse(from)) ? { gte: new Date(from) } : {}),
        ...(to && !Number.isNaN(Date.parse(to)) ? { lte: new Date(to) } : {}),
      };
    }

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        select: ROW_SELECT,
        orderBy: { createdAt: "desc" },
        ...skipTake(pagination),
      }),
      prisma.activityLog.count({ where }),
    ]);

    // WHETHER THE CHIP IS A LINK IS DECIDED HERE, NOT GUESSED IN THE BROWSER.
    //
    // `targetHref(type, id, readable)` has always taken a readability flag and
    // documented it as the reason a chip can be plain text ("a link that 404s
    // is worse"), and the page called it with two arguments, so the flag was
    // always true and the guard never ran. The client cannot answer the
    // question; the server can, for every node the one access resolver knows
    // (Spaces, Folders, Lists, docs, tables, canvases, forms). A type it does
    // not know stays readable, which is the behaviour the page had before, so
    // nothing that used to link stops linking.
    const data = await withReadability(viewer, activities.map(rowView));

    return jsonSuccess({
      data,
      scope,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        hasMore: pagination.page < Math.ceil(total / pagination.limit),
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}

/** The columns the page draws (activity-client.tsx ActivityRow), and the metadata its chip's name falls back to. */
const ROW_SELECT = {
  id: true,
  type: true,
  description: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
} as const;

/** The metadata keys the page reads a chip's name from (activity-client.tsx targetName), strings only. */
const NAME_KEYS = ["name", "title", "label", "targetName"] as const;

/**
 * A row as the page reads it (see the header): its metadata cut to the name
 * keys, each a string of at most 200 characters; null when it has none.
 */
function rowView<T extends { metadata: unknown }>(row: T): Omit<T, "metadata"> & { metadata: Record<string, string> | null } {
  const m = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const names: Record<string, string> = {};
  for (const k of NAME_KEYS) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) names[k] = v.slice(0, 200);
  }
  return { ...row, metadata: Object.keys(names).length ? names : null };
}

/**
 * Per-row `targetReadable`, for every node target the one resolver answers
 * for, over ONE world for the whole page of rows. Every other type is left
 * readable: this narrows links that would 404, it is not a second access
 * gate.
 *
 * And per-row `targetName`: the node's name as it is now, for a node the
 * viewer can open, null otherwise. The access rows (access.granted and the
 * rest) are name-free by design, since the Everyone feed is read by people
 * who may not open the node, so without this a row read "VerifyAdmin Bot
 * granted" with no chip and no link. The name is resolved here, per viewer,
 * and never stored. `targetHref` is the node's page for the same readers:
 * a Space chip had no link at all, because its address takes a slug.
 */
async function withReadability<T extends { targetType: string | null; targetId: string | null }>(
  viewer: Viewer,
  rows: T[],
): Promise<Array<T & { targetReadable: boolean; targetName: string | null; targetHref: string | null }>> {
  // An answer we could not compute must not turn every chip into plain text.
  const targets = await activityTargets(nodeCtxFromViewer(viewer), rows).catch(() => rows.map(() => ({ readable: null, name: null, href: null })));
  return rows.map((r, i) => ({
    ...r,
    targetReadable: targets[i]?.readable ?? true,
    targetName: targets[i]?.name ?? null,
    targetHref: targets[i]?.href ?? null,
  }));
}
