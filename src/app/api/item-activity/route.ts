// /api/item-activity — read-only feed of activity entries for an
// entity. Activity rows are written by mutations (PATCH handlers,
// workflows) via the logItemActivity() helper; never POSTed by the
// client.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType + entityId required" }, { status: 400 });
  }

  const activity = await prisma.itemActivity.findMany({
    where: { organizationId: ctx.orgId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const actorIds = Array.from(new Set(activity.map((a) => a.actorId).filter(Boolean) as string[]));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  return NextResponse.json({
    activity: activity.map((a) => {
      const actor = a.actorId ? actorMap.get(a.actorId) : null;
      return {
        id: a.id,
        action: a.action,
        meta: a.meta,
        actorId: a.actorId,
        actorName: actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || actor.email : null,
        actorImage: actor?.avatar ?? null,
        createdAt: a.createdAt,
      };
    }),
  });
}
