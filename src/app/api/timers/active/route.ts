// GET /api/timers/active — the current user's running session (if any).
// Used by the topbar indicator to badge "you have a timer running" and
// to surface a click-through link to the entity being timed.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSuiteContext } from "@/lib/suites/auth";

export async function GET() {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const active = await prisma.timerSession.findFirst({
    where: { organizationId: ctx.orgId, userId: ctx.userId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, entityType: true, entityId: true, startedAt: true },
  });

  if (!active) return NextResponse.json({ active: null });

  // Hydrate the entity's title where we know how. For now we only
  // resolve BOARD_ITEM (the main timer surface). Other types fall
  // through with a generic label.
  let title: string | null = null;
  let url: string | null = null;
  if (active.entityType === "BOARD_ITEM") {
    const item = await prisma.item.findFirst({
      where: { id: active.entityId, organizationId: ctx.orgId },
      select: { id: true, title: true, boardId: true, board: { select: { slug: true } } },
    });
    if (item) {
      title = item.title;
      url = `/boards/${item.board?.slug ?? item.boardId}?item=${item.id}`;
    }
  }

  return NextResponse.json({
    active: {
      id: active.id,
      entityType: active.entityType,
      entityId: active.entityId,
      startedAt: active.startedAt,
      title,
      url,
    },
  });
}
