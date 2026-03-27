import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({ where: { userId, read: false } });

  return jsonSuccess({ notifications, unreadCount });
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

  if (body.id) {
    await prisma.notification.update({
      where: { id: body.id },
      data: { read: true },
    });
    return jsonSuccess({ message: "Marked as read" });
  }

  return jsonError("Invalid request");
}
