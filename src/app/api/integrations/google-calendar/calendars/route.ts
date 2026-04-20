import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { ensureFreshToken, listCalendars } from "@/services/googleCalendar";

/**
 * After OAuth connect, the user picks which calendars to actually sync.
 * This endpoint lists every calendar their Google account owns /
 * subscribes to, plus which ones are currently being synced on the
 * Workwrk side (the subscription rows with non-null externalCalendarId).
 */
export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  // Master subscription holds the tokens; per-calendar subs track which
  // calendars are synced.
  const master = await prisma.calendarSubscription.findFirst({
    where: { userId, provider: "GOOGLE", externalCalendarId: null },
  });
  if (!master) return jsonSuccess({ connected: false, calendars: [], synced: [] });

  try {
    const token = await ensureFreshToken(master);
    const calendars = await listCalendars(token);

    const perCalendarSubs = await prisma.calendarSubscription.findMany({
      where: { userId, provider: "GOOGLE", externalCalendarId: { not: null } },
      select: { externalCalendarId: true, direction: true, shareTitles: true, enabled: true },
    });

    return jsonSuccess({
      connected: true,
      calendars: calendars.map((c) => ({
        id: c.id,
        name: c.summary,
        primary: !!c.primary,
        color: c.backgroundColor ?? null,
        accessRole: c.accessRole ?? null,
      })),
      synced: perCalendarSubs,
    });
  } catch (err: any) {
    console.error("[GCal calendars] fetch failed:", err?.message ?? err);
    return jsonError(err?.message || "Failed to list calendars", 500);
  }
}
