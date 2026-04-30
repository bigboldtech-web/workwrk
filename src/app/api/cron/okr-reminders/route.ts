import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Cron — surfaces "you haven't checked in" nudges for OKR owners.
 *
 * For every Key Result whose owner OKR has gone past its cadence
 * window without a check-in, we drop a Notification row. The
 * topbar bell already polls /api/notifications, so the user sees
 * the nudge on their next page load.
 *
 * Idempotency: each KR carries `lastReminderAt`. We refuse to fire
 * a second reminder until at least one cadence interval has passed
 * since the previous reminder, so the bell doesn't spam someone who
 * goes a fortnight without a check-in.
 *
 * Schedule (Vercel cron): once a day at the start of the workday,
 * e.g. 09:00 UTC. The reminder is opt-out via cadence=NONE if you
 * ever want to stop one — but right now the cadence is WEEKLY
 * (default), BIWEEKLY, or MONTHLY.
 *
 * Guard with CRON_SECRET in production (same pattern as the
 * email-queue cron).
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const cadenceDays: Record<string, number> = {
    WEEKLY: 7,
    BIWEEKLY: 14,
    MONTHLY: 30,
  };

  const now = Date.now();
  let nudgesCreated = 0;
  let krsScanned = 0;

  // Pull every active KR + its OKR cadence + most recent check-in. We
  // only care about OKRs that have an owner — Company OKRs without an
  // explicit owner get a nudge in the team manager dashboard later.
  const krs = await prisma.keyResult.findMany({
    where: {
      okr: {
        ownerId: { not: null },
        status: { not: "COMPLETED" },
      },
    },
    select: {
      id: true,
      lastReminderAt: true,
      okr: {
        select: {
          id: true, title: true, ownerId: true,
          checkInCadence: true, organizationId: true,
        },
      },
      checkIns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  krsScanned = krs.length;

  for (const kr of krs) {
    if (!kr.okr.ownerId) continue;

    const cadenceMs = (cadenceDays[kr.okr.checkInCadence] ?? 7) * 86_400_000;
    const lastCheckIn = kr.checkIns[0]?.createdAt;
    const sinceCheckIn = lastCheckIn ? now - new Date(lastCheckIn).getTime() : Infinity;

    // Not due yet.
    if (sinceCheckIn < cadenceMs) continue;

    // Already nudged this cycle — wait a full cadence before nudging again.
    const sinceReminder = kr.lastReminderAt ? now - new Date(kr.lastReminderAt).getTime() : Infinity;
    if (sinceReminder < cadenceMs) continue;

    await prisma.$transaction([
      prisma.notification.create({
        data: {
          userId: kr.okr.ownerId,
          type: "okr_check_in_due",
          title: "Check in on your OKR",
          message: `"${kr.okr.title}" — your last update was more than ${kr.okr.checkInCadence.toLowerCase()} ago.`,
          link: "/okrs",
        },
      }),
      prisma.keyResult.update({
        where: { id: kr.id },
        data: { lastReminderAt: new Date() },
      }),
    ]);
    nudgesCreated++;
  }

  return Response.json({
    ran: true,
    at: new Date().toISOString(),
    krsScanned,
    nudgesCreated,
  });
}
