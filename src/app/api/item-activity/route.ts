// /api/item-activity — read-only feed of activity entries for an
// entity. Activity rows are written by mutations (PATCH handlers,
// workflows) via the logItemActivity() helper; never POSTed by the
// client.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";
import { canReadBoard } from "@/lib/board";

export async function GET(req: Request) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  // ?boardId= — board-wide feed across every item on the board (the
  // ACTIVITY view). Gated by the board read resolver; rows come back
  // with the owning item's id + title for context.
  const boardId = url.searchParams.get("boardId");

  if (boardId) {
    const canRead = await canReadBoard(boardId, ctx.userId, ctx.accessLevel ?? "EMPLOYEE");
    if (!canRead) return NextResponse.json({ error: "not found" }, { status: 404 });
    const items = await prisma.item.findMany({
      where: { boardId },
      select: { id: true, title: true },
    });
    const titleByItem = new Map(items.map((i) => [i.id, i.title]));
    const rows = items.length
      ? await prisma.itemActivity.findMany({
          where: {
            organizationId: ctx.orgId,
            entityType: "BOARD_ITEM",
            entityId: { in: items.map((i) => i.id) },
          },
          orderBy: { createdAt: "desc" },
          take: 300,
        })
      : [];
    const actorIdsB = Array.from(new Set(rows.map((a) => a.actorId).filter(Boolean) as string[]));
    const actorsB = actorIdsB.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIdsB } },
          select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
        })
      : [];
    const actorMapB = new Map(actorsB.map((a) => [a.id, a]));
    return NextResponse.json({
      activity: rows.map((a) => {
        const actor = a.actorId ? actorMapB.get(a.actorId) : null;
        return {
          id: a.id,
          action: a.action,
          meta: a.meta,
          actorId: a.actorId,
          actorName: actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() || actor.email : null,
          actorImage: actor?.avatar ?? null,
          createdAt: a.createdAt,
          itemId: a.entityId,
          itemTitle: titleByItem.get(a.entityId) ?? null,
        };
      }),
    });
  }

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType + entityId required" }, { status: 400 });
  }

  const activity = await prisma.itemActivity.findMany({
    where: { organizationId: ctx.orgId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // The actors, PLUS the people ids stored inside meta (an assignee added or
  // removed, an owner handed over). Resolved in the same query because the only
  // alternative for the renderer is to print a raw cuid at a person, or to say
  // "someone" when the name was one join away.
  const metaPersonIds = activity.flatMap((a) =>
    personIdsInMeta(a.action, (a.meta as Record<string, unknown> | null) ?? {}),
  );
  const actorIds = Array.from(
    new Set([...(activity.map((a) => a.actorId).filter(Boolean) as string[]), ...metaPersonIds]),
  );
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  const people: Record<string, string> = {};
  for (const a of actors) {
    const name = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.email;
    if (name) people[a.id] = name;
  }

  return NextResponse.json({
    // Shared by every row in this response, the same shape ThreadActivity uses.
    people,
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

/**
 * The user ids stored inside one activity row's meta.
 *
 * Only the actions that actually carry people are read, and only the keys those
 * actions write, so a meta blob from an automation cannot turn an arbitrary
 * string into a user lookup.
 */
function personIdsInMeta(action: string, meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x) out.push(x);
  };
  if (action === "ASSIGNEES_CHANGED") {
    push(meta.added);
    push(meta.removed);
  } else if (action === "OWNER_CHANGED" || action === "ASSIGNED") {
    push(meta.from);
    push(meta.to);
  }
  return out;
}
