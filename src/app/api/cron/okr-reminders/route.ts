import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { shouldEmail } from "@/lib/notify-prefs";

/**
 * Cron — surfaces "you haven't checked in" nudges for OKR owners.
 *
 * For every Key Result whose owner OKR has gone past its cadence
 * window without a check-in, we drop a Notification row (topbar bell,
 * which polls /api/notifications) AND escalate with an email to the
 * goal owner, so a stale goal isn't buried behind a bell the owner
 * never opens.
 *
 * Opt-out: a goal with checkInCadence = "NONE" is skipped entirely —
 * no bell, no email. That is the per-goal reminder off switch exposed
 * in the goal modal (create-goal-modal). checkInCadence is a String
 * column, so NONE is just another value — no schema change.
 *
 * Idempotency + anti-spam:
 *  - Each KR carries `lastReminderAt`; we refuse to fire again until a
 *    full cadence interval has passed, so the bell doesn't spam someone.
 *  - The email respects the owner's /settings/notifications email prefs
 *    (shouldEmail → "due_reminders") and fires at most once per goal per
 *    run, even when several of the goal's KRs are stale at once.
 *
 * Schedule (Vercel cron): once a day at the start of the workday,
 * e.g. 09:00 UTC. Guard with CRON_SECRET in production (same pattern
 * as the email-queue cron).
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
  let skippedNone = 0;
  let emailsSent = 0;

  // Owner lookups are cached per run — OKR.ownerId is a bare column (no
  // Prisma relation), so we resolve email + name once per owner, not per KR.
  const ownerCache = new Map<string, { email: string | null; firstName: string | null } | null>();
  async function loadOwner(id: string) {
    if (ownerCache.has(id)) return ownerCache.get(id) ?? null;
    const u = await prisma.user.findUnique({
      where: { id },
      select: { email: true, firstName: true },
    });
    ownerCache.set(id, u ?? null);
    return u ?? null;
  }
  // At most one stale-check-in email per goal per run (a goal can have many
  // KRs go stale together — the owner gets one nudge, not one per KR).
  const emailedGoals = new Set<string>();

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

    // Per-goal opt-out: NONE means "don't remind me about this goal" —
    // no bell, no email. (The DB query can't easily de-dupe this by goal,
    // so we skip here; scanning is cheap.)
    if (kr.okr.checkInCadence === "NONE") { skippedNone++; continue; }

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

    // Email escalation — one per goal per run, prefs-gated. Reuses the
    // existing email sender + generic template; shouldEmail honors the
    // owner's /settings/notifications "due_reminders" toggle (and the
    // master email switch), so an opted-out owner never gets mailed.
    if (!emailedGoals.has(kr.okr.id)) {
      emailedGoals.add(kr.okr.id);
      try {
        const owner = await loadOwner(kr.okr.ownerId);
        if (owner?.email && (await shouldEmail(kr.okr.ownerId, "due_reminders"))) {
          const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
          const daysStale =
            sinceCheckIn === Infinity ? null : Math.floor(sinceCheckIn / 86_400_000);
          const { subject, html } = genericNotificationTemplate({
            heading: "Check-in overdue",
            recipientName: owner.firstName ?? undefined,
            subjectText: `Your goal is past its ${kr.okr.checkInCadence.toLowerCase()} check-in.`,
            itemTitle: kr.okr.title,
            itemDetails:
              daysStale === null
                ? "No check-ins yet"
                : `Last update ${daysStale} day${daysStale === 1 ? "" : "s"} ago`,
            actionLabel: "Check in now",
            actionLink: `${baseUrl}/okrs/${kr.okr.id}`,
          });
          await sendEmail({
            to: owner.email,
            subject,
            html,
            template: "okr-check-in-stale",
            variables: { goalId: kr.okr.id, title: kr.okr.title, cadence: kr.okr.checkInCadence },
            organizationId: kr.okr.organizationId,
            userId: kr.okr.ownerId,
            category: "reminder",
          });
          emailsSent++;
        }
      } catch (err) {
        console.error("[OKR reminders] Email escalation failed:", err);
      }
    }
  }

  return Response.json({
    ran: true,
    at: new Date().toISOString(),
    krsScanned,
    skippedNone,
    nudgesCreated,
    emailsSent,
  });
}
