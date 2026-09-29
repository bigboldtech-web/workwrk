// Pulse surveys on the server: who is in an audience, who runs a survey,
// and the one Inbox and email door (spec-teams-performance /surveys).
//
//   runner      the survey's creator, the People team, Owner and Admin (a
//               survey from before Phase 6 has no creator and stays with the
//               manager tier that ran it yesterday): edit a Draft, launch,
//               close, reopen, change the close date, remind, results
//   respondent  anyone in the audience while it is Open, and afterwards
//               anyone who has answered (to read their own answers)
//
// Server only.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { getUserTagIds, resolveUserIdsByTags } from "@/lib/user-tags";
import { canManageSurvey, inSurveyAudience, surveyOpenNow } from "@/lib/people/survey-audience";

export interface SurveyCtx {
  userId: string;
  organizationId: string;
  officeId: string | null;
  departmentId: string | null;
  tagIds: string[];
  peopleTeamOrAdmin: boolean;
  legacyManagerTier: boolean;
  isAgent: boolean;
}

export async function surveyCtx(session: unknown): Promise<SurveyCtx | null> {
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return null;
  const [me, tagIds] = await Promise.all([
    prisma.user.findUnique({ where: { id: v.userId }, select: { officeId: true, departmentId: true } }),
    getUserTagIds(v.organizationId, v.userId),
  ]);
  const { sessionOnLegacyManagerTier } = await import("@/lib/page-gates");
  return {
    userId: v.userId,
    organizationId: v.organizationId,
    officeId: me?.officeId ?? null,
    departmentId: me?.departmentId ?? null,
    tagIds,
    peopleTeamOrAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true,
    legacyManagerTier: await sessionOnLegacyManagerTier(session),
    isAgent: v.isAgent,
  };
}

type SurveyRow = { audienceType: string; officeIds: string[]; departmentIds: string[]; userIds: string[]; tagIds: string[]; createdById: string | null; status: string; closesAt: Date | null };

export function surveyFaces(ctx: SurveyCtx, s: SurveyRow, hasResponded: boolean) {
  const inAudience = inSurveyAudience(s, { userId: ctx.userId, officeId: ctx.officeId, departmentId: ctx.departmentId, tagIds: ctx.tagIds });
  const canManage = canManageSurvey({ callerId: ctx.userId, createdById: s.createdById, peopleTeamOrAdmin: ctx.peopleTeamOrAdmin, legacyManagerTier: ctx.legacyManagerTier });
  const open = surveyOpenNow(s, new Date());
  const canRespond = inAudience && open;
  const visible = canManage || (inAudience && (s.status === "ACTIVE" || hasResponded)) || hasResponded;
  return { inAudience, canManage, canSeeResults: canManage, canRespond, hasResponded, visible, open };
}

/** The users an audience reaches (active, not removed). */
export async function audienceUserWhere(organizationId: string, s: Pick<SurveyRow, "audienceType" | "officeIds" | "departmentIds" | "userIds" | "tagIds">): Promise<Prisma.UserWhereInput> {
  const where: Prisma.UserWhereInput = { organizationId, deletedAt: null };
  if (s.audienceType === "OFFICES") where.officeId = { in: s.officeIds };
  else if (s.audienceType === "DEPARTMENTS") where.departmentId = { in: s.departmentIds };
  else if (s.audienceType === "USERS") where.id = { in: s.userIds };
  else if (s.audienceType === "TAGS") where.id = { in: await resolveUserIdsByTags(organizationId, s.tagIds) };
  else if (s.audienceType !== "ALL") where.id = { in: [] };
  return where;
}

/**
 * The numbers a survey's results header and the survey list print: "N of M
 * answered, R% response rate". Pure, so the rule is tested without a
 * database.
 *
 * The audience is counted from membership NOW, but answers are kept for
 * good. Someone who answered and then changed department, lost a tag or left
 * the company drops out of the live count while their answer stays, which
 * printed "1 of 0 answered, 0% response rate". So M is everyone the survey
 * reached: the current audience plus every respondent who is no longer in
 * it. N can never pass M, and the rate is N over that same M, capped at 100.
 * M is 0 only when nobody answered either, and then "0 of 0, 0%" is true.
 */
export function surveyAudienceStatsFrom(counts: { currentAudience: number; responses: number; respondersStillInAudience: number }): { audienceSize: number; totalResponses: number; responseRate: number } {
  const responses = Math.max(0, counts.responses);
  const stillIn = Math.min(Math.max(0, counts.respondersStillInAudience), responses);
  const audienceSize = Math.max(0, counts.currentAudience) + (responses - stillIn);
  const responseRate = audienceSize > 0 ? Math.min(100, Math.round((responses / audienceSize) * 100)) : 0;
  return { audienceSize, totalResponses: responses, responseRate };
}

/**
 * surveyAudienceStatsFrom read from the database: the one door both
 * /api/pulse-surveys (All, Closed) and /api/pulse-surveys/[id] use, so the
 * list and the survey page never disagree.
 */
export async function surveyAudienceStats(organizationId: string, s: { id: string } & Pick<SurveyRow, "audienceType" | "officeIds" | "departmentIds" | "userIds" | "tagIds">) {
  const where = await audienceUserWhere(organizationId, s);
  const [currentAudience, responders] = await Promise.all([
    prisma.user.count({ where }),
    prisma.surveyResponse.findMany({ where: { surveyId: s.id }, select: { userId: true } }),
  ]);
  const responderIds = [...new Set(responders.map((r) => r.userId))];
  // A respondent whose user row is gone entirely is not in the audience
  // now, so they count once as someone the survey reached.
  const respondersStillInAudience = responderIds.length
    ? await prisma.user.count({ where: { AND: [where, { id: { in: responderIds } }] } })
    : 0;
  return surveyAudienceStatsFrom({ currentAudience, responses: responderIds.length, respondersStillInAudience });
}

/** "Everyone", "Engineering", "12 people" for a survey's audience. */
export async function audienceLabel(organizationId: string, s: Pick<SurveyRow, "audienceType" | "officeIds" | "departmentIds" | "userIds" | "tagIds">): Promise<string> {
  if (s.audienceType === "ALL") return "Everyone";
  if (s.audienceType === "USERS") return `${s.userIds.length} ${s.userIds.length === 1 ? "person" : "people"}`;
  if (s.audienceType === "DEPARTMENTS") {
    const d = await prisma.department.findMany({ where: { id: { in: s.departmentIds }, organizationId }, select: { name: true } });
    return d.map((x) => x.name).join(", ") || "Departments";
  }
  if (s.audienceType === "OFFICES") {
    const o = await prisma.office.findMany({ where: { id: { in: s.officeIds }, organizationId }, select: { name: true } });
    return o.map((x) => x.name).join(", ") || "Offices";
  }
  if (s.audienceType === "TAGS") {
    const t = await prisma.tag.findMany({ where: { id: { in: s.tagIds }, organizationId }, select: { name: true } });
    return t.map((x) => x.name).join(", ") || "Tags";
  }
  return "Nobody";
}

/**
 * The survey's one door to its audience: an Inbox row that links THE
 * SURVEY (never the list, MA-6) and an email whose copy tells the truth
 * about anonymity. `onlyUnanswered` is the reminder: only the people who
 * have not answered, and nobody reminded in the last 12 hours.
 */
export async function notifySurveyAudience(
  survey: { id: string; title: string; anonymous: boolean; closesAt: Date | null; questions: unknown } & Pick<SurveyRow, "audienceType" | "officeIds" | "departmentIds" | "userIds" | "tagIds">,
  organizationId: string,
  opts: { onlyUnanswered?: boolean; excludeUserId?: string } = {},
): Promise<number> {
  const where = await audienceUserWhere(organizationId, survey);
  let audience = await prisma.user.findMany({ where, select: { id: true, email: true, firstName: true } });
  if (opts.excludeUserId) audience = audience.filter((u) => u.id !== opts.excludeUserId);
  const link = `/surveys/${survey.id}`;
  if (opts.onlyUnanswered) {
    const answered = new Set((await prisma.surveyResponse.findMany({ where: { surveyId: survey.id }, select: { userId: true } })).map((r) => r.userId));
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const recent = new Set((await prisma.notification.findMany({ where: { link, type: "survey_open", createdAt: { gte: since } }, select: { userId: true } })).map((n) => n.userId));
    audience = audience.filter((u) => !answered.has(u.id) && !recent.has(u.id));
  }
  if (!audience.length) return 0;
  const count = Array.isArray(survey.questions) ? survey.questions.length : 0;
  const { surveyMinutes } = await import("./survey");
  await prisma.notification.createMany({
    data: audience.map((u) => ({
      userId: u.id,
      type: "survey_open",
      title: opts.onlyUnanswered ? `Reminder: ${survey.title} is open` : `${survey.title} is open`,
      message: `${count} ${count === 1 ? "question" : "questions"}, ${surveyMinutes(count)}`,
      link,
    })),
  });
  const { sendEmail } = await import("@/lib/email");
  const { genericNotificationTemplate } = await import("@/lib/email-templates");
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  for (const u of audience) {
    if (!u.email) continue;
    const { subject, html } = genericNotificationTemplate({
      heading: opts.onlyUnanswered ? "A survey is waiting for you" : "A new survey is open",
      recipientName: u.firstName,
      subjectText: survey.anonymous
        ? "Your answers are anonymous: your name is never shown with them."
        : "This survey is attributed: the people who run it see your name with your answers.",
      itemTitle: survey.title,
      itemDetails: `${count} ${count === 1 ? "question" : "questions"}, ${surveyMinutes(count)}`,
      actionLabel: "Answer",
      actionLink: `${baseUrl}${link}`,
    });
    sendEmail({
      to: u.email, subject, html, template: "survey-published",
      variables: { surveyId: survey.id, title: survey.title },
      organizationId, userId: u.id, category: "survey",
    }).catch((err) => console.error(`[Survey] email to ${u.email} failed:`, err));
  }
  return audience.length;
}
