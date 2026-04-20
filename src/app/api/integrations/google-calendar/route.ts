import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { revokeToken } from "@/services/googleCalendar";

/** GET: Current connection status + list of per-calendar subscriptions. */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const subs = await prisma.calendarSubscription.findMany({
    where: { userId, provider: "GOOGLE" },
    select: {
      id: true,
      externalCalendarId: true,
      direction: true,
      shareTitles: true,
      enabled: true,
      lastSyncAt: true,
      createdAt: true,
    },
  });
  const master = subs.find((s) => s.externalCalendarId === null) ?? null;
  const perCalendar = subs.filter((s) => s.externalCalendarId !== null);

  return jsonSuccess({
    connected: !!master,
    subscriptions: perCalendar,
    connectedAt: master?.createdAt ?? null,
    lastSyncAt: master?.lastSyncAt ?? null,
  });
}

/** DELETE: Disconnect — revokes the Google OAuth token, drops every
 *  subscription row for this user, and deletes all GCAL-sourced tasks
 *  so the calendar no longer shows stale external events. */
export async function DELETE() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const master = await prisma.calendarSubscription.findFirst({
    where: { userId, provider: "GOOGLE", externalCalendarId: null },
  });
  if (master?.accessToken) {
    await revokeToken(master.accessToken);
  }

  await prisma.$transaction([
    prisma.task.deleteMany({
      where: { assigneeId: userId, externalSource: "GCAL" },
    }),
    prisma.calendarSubscription.deleteMany({
      where: { userId, provider: "GOOGLE" },
    }),
  ]);

  return jsonSuccess({ disconnected: true });
}
