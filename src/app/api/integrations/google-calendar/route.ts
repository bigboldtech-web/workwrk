import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonSuccess } from "@/lib/api-helpers";
import { revokeToken, isGoogleEnabled } from "@/services/googleCalendar";

/** GET: Current connection status + list of per-calendar subscriptions.
 *
 *  `available` is the field Phase 4 adds and it is the whole difference
 *  between an honest state and a dead end. Without it the client cannot
 *  tell "this deployment has no Google credentials" from "you have not
 *  connected yet", so it offered a Connect button that led to the OAuth
 *  route answering a bare 501 JSON page (audit P-6). When `available` is
 *  false the Calendar's connect line renders nothing at all: no Connect,
 *  and no "Coming soon" either. */
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
    available: isGoogleEnabled(),
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

  // The synced rows go with the connection, in BOTH homes: the CalendarEvent
  // rows the sync writes now, and the legacy Task rows it wrote before
  // Phase 4 and still writes for one release
  // (src/services/googleCalendarSync.ts says why). Missing either one
  // leaves a disconnected calendar still showing Google events, which is
  // what "Disconnect" is for.
  //
  // The CalendarEvent delete is its own statement wrapped in a try, not a
  // member of the transaction, so a deployment that has not applied
  // prisma/sql/2026-09-22-calendar-event.sql yet still disconnects.
  try {
    await prisma.calendarEvent.deleteMany({ where: { userId, externalSource: "GCAL" } });
  } catch {
    // The table is not there on this deployment. Nothing to remove from it.
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
