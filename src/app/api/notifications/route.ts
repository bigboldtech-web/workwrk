import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);

  const now = new Date();
  // Snooze filter: a notification is "visible" when it isn't snoozed
  // or its snooze window has elapsed. Applies to listings + counts
  // alike so the badge stays in sync with the panel.
  const visibleFilter = {
    OR: [
      { snoozedUntil: null },
      { snoozedUntil: { lte: now } },
    ],
  };

  // Run all three queries in parallel. `unreadByType` powers the sidebar
  // section badges (Kudos / Surveys / SOPs / etc.); the shape is
  // `{ KUDOS: 3, SURVEY: 1, ... }` so consumers can look up by type
  // without another round trip.
  const [notifications, unreadCount, unreadByTypeRows] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...visibleFilter },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId, read: false, ...visibleFilter } }),
    prisma.notification.groupBy({
      by: ["type"],
      where: { userId, read: false, ...visibleFilter },
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

  // Snooze — defer a notification until `snoozeUntil` (ISO timestamp).
  // Pass `snoozeUntil: null` to clear the snooze immediately. Scope is
  // always the caller's own rows; bulk via `ids` is supported.
  if (Object.prototype.hasOwnProperty.call(body, "snoozeUntil")) {
    const raw = body.snoozeUntil;
    let value: Date | null;
    if (raw === null || raw === "") {
      value = null;
    } else {
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) return jsonError("Invalid snoozeUntil");
      value = parsed;
    }
    if (typeof body.id === "string" && body.id) {
      const r = await prisma.notification.updateMany({
        where: { id: body.id, userId },
        data: { snoozedUntil: value },
      });
      return jsonSuccess({ snoozed: r.count, until: value });
    }
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const r = await prisma.notification.updateMany({
        where: { id: { in: body.ids as string[] }, userId },
        data: { snoozedUntil: value },
      });
      return jsonSuccess({ snoozed: r.count, until: value });
    }
    return jsonError("Provide id or ids to snooze");
  }

  return jsonError("Invalid request");
}

/**
 * DELETE — remove notifications. Always scoped to the current user
 * (you can never delete someone else's row).
 *
 * Body shapes:
 *   { id: "<id>" }    delete a single notification
 *   { ids: ["..."] }  delete a batch
 *   { allRead: true } sweep every notification the user has marked
 *                    read — useful for "clear inbox" actions
 */
export async function DELETE(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const userId = getUserId(session);
  const body = await req.json().catch(() => ({}));

  if (typeof body?.id === "string" && body.id) {
    const r = await prisma.notification.deleteMany({
      where: { id: body.id, userId },
    });
    return jsonSuccess({ deleted: r.count });
  }

  if (Array.isArray(body?.ids) && body.ids.length > 0) {
    const r = await prisma.notification.deleteMany({
      where: { id: { in: body.ids as string[] }, userId },
    });
    return jsonSuccess({ deleted: r.count });
  }

  if (body?.allRead === true) {
    const r = await prisma.notification.deleteMany({
      where: { userId, read: true },
    });
    return jsonSuccess({ deleted: r.count });
  }

  return jsonError("Provide id, ids, or allRead");
}
