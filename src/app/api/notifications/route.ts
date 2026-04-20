import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);

  // Run all three queries in parallel. `unreadByType` powers the sidebar
  // section badges (Kudos / Surveys / SOPs / etc.); the shape is
  // `{ KUDOS: 3, SURVEY: 1, ... }` so consumers can look up by type
  // without another round trip.
  const [notifications, unreadCount, unreadByTypeRows] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.notification.groupBy({
      by: ["type"],
      where: { userId, read: false },
      _count: { _all: true },
    }),
  ]);

  const unreadByType: Record<string, number> = {};
  for (const row of unreadByTypeRows) {
    unreadByType[row.type] = row._count._all;
  }

  return NextResponse.json({ notifications, unreadCount, unreadByType }, {
    headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" },
  });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const body = await req.json();

  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return jsonSuccess({ message: "All marked as read" });
  }

  if (typeof body.markAllReadOfType === "string" && body.markAllReadOfType.length > 0) {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false, type: body.markAllReadOfType },
      data: { read: true },
    });
    return jsonSuccess({ message: "Type marked as read", count: result.count });
  }

  if (body.id) {
    await prisma.notification.update({
      where: { id: body.id },
      data: { read: true },
    });
    return jsonSuccess({ message: "Marked as read" });
  }

  return jsonError("Invalid request");
}
