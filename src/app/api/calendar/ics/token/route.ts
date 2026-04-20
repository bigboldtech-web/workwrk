import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getUserId, jsonSuccess } from "@/lib/api-helpers";

/**
 * Issues (or rotates) the per-user token that powers the public iCal
 * feed. Apple / Outlook / Google will poll the returned URL on their
 * own cadence — everything downstream is read-only.
 *
 * Rotation semantics: calling POST again replaces the existing token,
 * instantly invalidating the old URL without the user having to dig
 * through external calendar app settings. Useful if they accidentally
 * shared the URL.
 */

export async function POST() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const token = randomBytes(24).toString("base64url");

  // One ICS_EXPORT subscription per user. externalCalendarId stays null —
  // the token lives in accessToken (the schema's generic credential slot).
  const existing = await prisma.calendarSubscription.findFirst({
    where: { userId, provider: "ICS_EXPORT" },
    select: { id: true },
  });
  if (existing) {
    await prisma.calendarSubscription.update({
      where: { id: existing.id },
      data: { accessToken: token, enabled: true, direction: "OUT" },
    });
  } else {
    await prisma.calendarSubscription.create({
      data: {
        userId,
        provider: "ICS_EXPORT",
        externalCalendarId: null,
        accessToken: token,
        direction: "OUT",
      },
    });
  }

  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return jsonSuccess({
    token,
    url: `${baseUrl}/api/calendar/ics/${token}.ics`,
    // Webcal scheme gets Apple Calendar to subscribe automatically on click.
    webcalUrl: `${baseUrl.replace(/^https?:/, "webcal:")}/api/calendar/ics/${token}.ics`,
  });
}

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  const sub = await prisma.calendarSubscription.findFirst({
    where: { userId, provider: "ICS_EXPORT" },
    select: { accessToken: true, createdAt: true },
  });
  if (!sub?.accessToken) return jsonSuccess({ token: null });

  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  return jsonSuccess({
    token: sub.accessToken,
    url: `${baseUrl}/api/calendar/ics/${sub.accessToken}.ics`,
    webcalUrl: `${baseUrl.replace(/^https?:/, "webcal:")}/api/calendar/ics/${sub.accessToken}.ics`,
    createdAt: sub.createdAt,
  });
}

export async function DELETE() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const userId = getUserId(session);

  await prisma.calendarSubscription.deleteMany({
    where: { userId, provider: "ICS_EXPORT" },
  });
  return jsonSuccess({ revoked: true });
}
