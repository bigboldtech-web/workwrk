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

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";
import { parsePaginationParams, skipTake } from "@/lib/pagination";
import { loadOrgFacts } from "@/lib/access/facts";
import { getTeamUserIds } from "@/lib/team";
import { parseActivityScope, scopeAllowed, viewerScopeFacts } from "@/lib/activity-scope";
import { accessibleIds } from "@/lib/access/ids";
import { normaliseTargetType } from "@/lib/activity-targets";
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

    const where: Prisma.ActivityLogWhereInput = { organizationId: viewer.organizationId };

    if (scope === "my") {
      where.actorId = viewer.userId;
    } else if (scope === "team") {
      const ids = await getTeamUserIds(viewer.organizationId, viewer.userId);
      // Your own rows are part of your team's activity; a manager looking at
      // "My team" with nothing of their own in it reads as a bug.
      where.actorId = { in: [...new Set([viewer.userId, ...ids])] };
    }
    // scope === "all": no actor filter, and only a viewer who passed the gate.

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
        include: { actor: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
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
    // question; the server can, for the container types `accessibleIds` knows.
    // A type it does not know stays readable, which is the behaviour the page
    // had before, so nothing that used to link stops linking.
    const data = await withReadability(viewer, activities);

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

/**
 * Per-row `targetReadable`, for the container types the access engine answers
 * for. Every other type is left readable: this narrows links that would 404,
 * it is not a second access gate.
 */
async function withReadability<T extends { targetType: string | null; targetId: string | null }>(
  viewer: Parameters<typeof accessibleIds>[0],
  rows: T[],
): Promise<Array<T & { targetReadable: boolean }>> {
  const KNOWN = { list: "list", board: "list", folder: "folder", space: "space" } as const;
  const wanted = new Set<"list" | "folder" | "space">();
  for (const r of rows) {
    const key = KNOWN[normaliseTargetType(r.targetType) as keyof typeof KNOWN];
    if (key) wanted.add(key);
  }
  if (wanted.size === 0) return rows.map((r) => ({ ...r, targetReadable: true }));
  const sets = new Map<string, Set<string>>();
  await Promise.all(
    [...wanted].map(async (type) => {
      const ids = await accessibleIds(viewer, type, "VIEW").catch(() => null);
      // A set we could not compute must not turn every chip into plain text.
      if (ids) sets.set(type, new Set(ids.readable));
    }),
  );
  return rows.map((r) => {
    const key = KNOWN[normaliseTargetType(r.targetType) as keyof typeof KNOWN];
    const set = key ? sets.get(key) : undefined;
    return { ...r, targetReadable: !set || !r.targetId || set.has(r.targetId) };
  });
}
