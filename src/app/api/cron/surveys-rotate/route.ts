import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";
import { resolveUserIdsByTags } from "@/lib/user-tags";
import { cronRefusal } from "@/lib/cron-auth";
import { cronResult } from "@/lib/cron-result";

/**
 * Survey rotation + reminder cron.
 *
 * Does two independent passes against PulseSurvey:
 *
 *   1. Auto-close expired active surveys. If a survey had a `frequency`
 *      set, spawn the next cycle — same questions/audience/title,
 *      parent pointer back to the closing survey, new closesAt computed
 *      from the cadence. Notify the audience about the new cycle.
 *
 *   2. Send pre-close reminder emails. Any ACTIVE survey closing in the
 *      next 24 hours that hasn't already sent its reminder gets one
 *      email per audience member who hasn't yet responded. Idempotent
 *      via `reminderSentAt`.
 *
 * Run frequency recommendation: every 15 minutes. Both passes take O(N)
 * surveys and the queries are indexed on (status, closesAt). Guard with
 * CRON_SECRET in production.
 */

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h before close

function nextCloseAt(from: Date, frequency: string | null): Date | null {
  if (!frequency) return null;
  const d = new Date(from);
  switch (frequency) {
    case "WEEKLY":    d.setUTCDate(d.getUTCDate() + 7); return d;
    case "BIWEEKLY":  d.setUTCDate(d.getUTCDate() + 14); return d;
    case "MONTHLY":   d.setUTCMonth(d.getUTCMonth() + 1); return d;
    case "QUARTERLY": d.setUTCMonth(d.getUTCMonth() + 3); return d;
    default: return null;
  }
}

async function resolveAudienceUserIds(s: {
  organizationId: string;
  audienceType: string;
  officeIds: string[];
  departmentIds: string[];
  userIds: string[];
  tagIds: string[];
}): Promise<string[]> {
  // Tags are polymorphic (no User relation), so resolve them separately.
  if (s.audienceType === "TAGS") return resolveUserIdsByTags(s.organizationId, s.tagIds);
  const where: Prisma.UserWhereInput = { organizationId: s.organizationId, deletedAt: null };
  if (s.audienceType === "OFFICES") where.officeId = { in: s.officeIds };
  else if (s.audienceType === "DEPARTMENTS") where.departmentId = { in: s.departmentIds };
  else if (s.audienceType === "USERS") where.id = { in: s.userIds };
  const rows = await prisma.user.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}

async function rotateOne(survey: {
  id: string;
  title: string;
  questions: Prisma.JsonValue;
  frequency: string | null;
  audienceType: string;
  officeIds: string[];
  departmentIds: string[];
  userIds: string[];
  tagIds: string[];
  anonymous: boolean;
  organizationId: string;
  closesAt: Date | null;
  createdById?: string | null;
}): Promise<{ closed: string; spawned?: string }> {
  // Close the current cycle.
  await prisma.pulseSurvey.update({
    where: { id: survey.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  if (!survey.frequency) return { closed: survey.id };

  // Spawn the next cycle. Anchor the new close date on the previous one
  // so cadence doesn't drift when the cron fires a bit late.
  const anchor = survey.closesAt || new Date();
  const nextClose = nextCloseAt(anchor, survey.frequency);
  if (!nextClose) return { closed: survey.id };

  const child = await prisma.pulseSurvey.create({
    data: {
      title: survey.title,
      questions: survey.questions as Prisma.InputJsonValue,
      frequency: survey.frequency,
      status: "ACTIVE",
      audienceType: survey.audienceType,
      officeIds: survey.officeIds,
      departmentIds: survey.departmentIds,
      userIds: survey.userIds,
      tagIds: survey.tagIds,
      anonymous: survey.anonymous,
      closesAt: nextClose,
      parentSurveyId: survey.id,
      // The next round belongs to whoever ran this one.
      createdById: survey.createdById ?? null,
      organizationId: survey.organizationId,
    },
  });

  // Notify the audience of the new cycle. Mirrors POST /api/pulse-surveys
  // behaviour: in-app notification row + email (queued, respects prefs).
  const audienceIds = await resolveAudienceUserIds(survey);
  if (audienceIds.length > 0) {
    const audience = await prisma.user.findMany({
      where: { id: { in: audienceIds } },
      select: { id: true, email: true, firstName: true },
    });
    await prisma.notification.createMany({
      data: audience.map((u) => ({
        // The survey itself, never the list (MA-6), under the survey_open kind.
        title: `${child.title} is open`,
        message: `A new round of ${survey.title} is waiting for you.`,
        type: "survey_open",
        link: `/surveys/${child.id}`,
        userId: u.id,
      })),
    });
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    for (const u of audience) {
      if (!u.email) continue;
      const { subject, html } = genericNotificationTemplate({
        heading: "New Pulse Survey",
        recipientName: u.firstName,
        subjectText: "The next cycle of a recurring pulse survey is live.",
        itemTitle: survey.title,
        itemDetails: "Takes about a minute",
        actionLabel: "Respond now",
        actionLink: `${baseUrl}/surveys`,
      });
      sendEmail({
        to: u.email,
        subject,
        html,
        template: "survey-recurrence",
        variables: { surveyId: child.id, title: survey.title },
        organizationId: survey.organizationId,
        userId: u.id,
        category: "survey",
      }).catch(() => {});
    }
  }

  return { closed: survey.id, spawned: child.id };
}

async function sendReminders(survey: {
  id: string;
  title: string;
  audienceType: string;
  officeIds: string[];
  departmentIds: string[];
  userIds: string[];
  tagIds: string[];
  organizationId: string;
  closesAt: Date | null;
}): Promise<number> {
  const audienceIds = await resolveAudienceUserIds(survey);
  if (audienceIds.length === 0) return 0;

  const responded = await prisma.surveyResponse.findMany({
    where: { surveyId: survey.id, userId: { in: audienceIds } },
    select: { userId: true },
  });
  const respondedSet = new Set(responded.map((r) => r.userId));
  const pendingIds = audienceIds.filter((id) => !respondedSet.has(id));

  await prisma.pulseSurvey.update({
    where: { id: survey.id },
    data: { reminderSentAt: new Date() },
  });

  if (pendingIds.length === 0) return 0;

  const pending = await prisma.user.findMany({
    where: { id: { in: pendingIds } },
    select: { id: true, email: true, firstName: true },
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const closesIn = survey.closesAt
    ? Math.max(0, Math.round((survey.closesAt.getTime() - Date.now()) / (60 * 60 * 1000)))
    : 24;

  // In-app notifications in one batch
  await prisma.notification.createMany({
    data: pending.map((u) => ({
      title: `${survey.title} closes soon`,
      message: `It closes in about ${closesIn} hours and you have not answered yet.`,
      type: "survey_open",
      link: `/surveys/${survey.id}`,
      userId: u.id,
    })),
  });

  for (const u of pending) {
    if (!u.email) continue;
    const { subject, html } = genericNotificationTemplate({
      heading: "Survey closing soon",
      recipientName: u.firstName,
      subjectText: `"${survey.title}" closes in about ${closesIn} hours and we haven't heard from you yet.`,
      itemTitle: survey.title,
      itemDetails: `Closes in ~${closesIn}h`,
      actionLabel: "Respond now",
      actionLink: `${baseUrl}/surveys`,
    });
    sendEmail({
      to: u.email,
      subject,
      html,
      template: "survey-reminder",
      variables: { surveyId: survey.id, title: survey.title },
      organizationId: survey.organizationId,
      userId: u.id,
      category: "survey",
    }).catch(() => {});
  }

  return pending.length;
}

export async function POST(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;

  const now = new Date();
  const rotations: { closed: string; spawned?: string }[] = [];
  const reminderCounts: { surveyId: string; reminded: number }[] = [];
  let failed = 0;

  // Pass 1: rotate expired
  const expired = await prisma.pulseSurvey.findMany({
    where: { status: "ACTIVE", closesAt: { lte: now } },
    select: {
      id: true, title: true, questions: true, frequency: true,
      audienceType: true, officeIds: true, departmentIds: true, userIds: true, tagIds: true,
      anonymous: true, organizationId: true, closesAt: true, createdById: true,
    },
  });
  for (const s of expired) {
    try {
      rotations.push(await rotateOne(s));
    } catch (err) {
      failed += 1;
      console.error(`[surveys-rotate] failed to rotate ${s.id}:`, err);
    }
  }

  // Pass 2: reminders — surveys that haven't closed yet but will within
  // the window and haven't already sent a reminder.
  const soonEnding = await prisma.pulseSurvey.findMany({
    where: {
      status: "ACTIVE",
      reminderSentAt: null,
      closesAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) },
    },
    select: {
      id: true, title: true, audienceType: true,
      officeIds: true, departmentIds: true, userIds: true, tagIds: true,
      organizationId: true, closesAt: true,
    },
  });
  for (const s of soonEnding) {
    try {
      reminderCounts.push({ surveyId: s.id, reminded: await sendReminders(s) });
    } catch (err) {
      failed += 1;
      console.error(`[surveys-rotate] failed to remind for ${s.id}:`, err);
    }
  }

  return cronResult("surveys-rotate", {
    ran: true,
    at: now.toISOString(),
    rotated: rotations.length,
    rotations,
    remindedSurveys: reminderCounts.length,
    reminders: reminderCounts,
    failed,
  }, failed);
}

