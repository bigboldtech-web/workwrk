import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { sendEmail } from "@/lib/email";
import { genericNotificationTemplate } from "@/lib/email-templates";

const AUDIENCE_TYPES = new Set(["ALL", "OFFICES", "DEPARTMENTS", "USERS"]);

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const userId = getUserId(session);

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, officeId: true, departmentId: true, accessLevel: true },
  });
  const viewerIsManager = isManager(session);

  const surveys = await prisma.pulseSurvey.findMany({
    where: { organizationId: orgId },
    include: {
      responses: { where: { userId }, select: { id: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const totalUsers = await prisma.user.count({ where: { organizationId: orgId, deletedAt: null } });

  // Count audience size per survey (for response rate)
  async function audienceSize(s: typeof surveys[number]): Promise<number> {
    if (s.audienceType === "ALL") return totalUsers;
    const where: any = { organizationId: orgId, deletedAt: null };
    if (s.audienceType === "OFFICES") where.officeId = { in: s.officeIds };
    if (s.audienceType === "DEPARTMENTS") where.departmentId = { in: s.departmentIds };
    if (s.audienceType === "USERS") where.id = { in: s.userIds };
    return prisma.user.count({ where });
  }

  function viewerIsInAudience(s: typeof surveys[number]) {
    if (s.audienceType === "ALL") return true;
    if (s.audienceType === "OFFICES") return !!viewer?.officeId && s.officeIds.includes(viewer.officeId);
    if (s.audienceType === "DEPARTMENTS") return !!viewer?.departmentId && s.departmentIds.includes(viewer.departmentId);
    if (s.audienceType === "USERS") return s.userIds.includes(userId);
    return false;
  }

  const sizes = await Promise.all(surveys.map(audienceSize));

  const shaped = surveys
    .map((s, i) => ({ survey: s, size: sizes[i] }))
    .filter(({ survey }) => viewerIsManager || viewerIsInAudience(survey))
    .map(({ survey: s, size }) => ({
      ...s,
      hasResponded: s.responses.length > 0,
      inAudience: viewerIsInAudience(s),
      audienceSize: size,
      responseRate: size > 0 ? Math.round((s._count.responses / size) * 100) : 0,
      totalResponses: s._count.responses,
      totalUsers,
    }));

  return jsonSuccess(shaped);
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const body = await req.json();
  const { title, questions, frequency, audienceType, officeIds, departmentIds, userIds, anonymous, closesAt } = body;

  if (!title?.trim() || !Array.isArray(questions) || questions.length === 0) {
    return jsonError("Title and questions required");
  }

  // Normalize closesAt — reject malformed strings and past dates. Past
  // dates would trigger immediate close on the next cron tick, which
  // is almost always a user mistake.
  let resolvedClosesAt: Date | null = null;
  if (closesAt) {
    const d = new Date(closesAt);
    if (isNaN(d.getTime())) return jsonError("Invalid close date");
    if (d.getTime() <= Date.now()) return jsonError("Close date must be in the future");
    resolvedClosesAt = d;
  }

  const VALID_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);
  const resolvedFrequency = typeof frequency === "string" && VALID_FREQUENCIES.has(frequency) ? frequency : null;
  if (resolvedFrequency && !resolvedClosesAt) {
    return jsonError("Recurring surveys need a close date so we know when to rotate");
  }

  const resolvedAudienceType = typeof audienceType === "string" && AUDIENCE_TYPES.has(audienceType) ? audienceType : "ALL";
  const resolvedOfficeIds = resolvedAudienceType === "OFFICES" && Array.isArray(officeIds) ? officeIds.filter((x: unknown) => typeof x === "string") : [];
  const resolvedDepartmentIds = resolvedAudienceType === "DEPARTMENTS" && Array.isArray(departmentIds) ? departmentIds.filter((x: unknown) => typeof x === "string") : [];
  const resolvedUserIds = resolvedAudienceType === "USERS" && Array.isArray(userIds) ? userIds.filter((x: unknown) => typeof x === "string") : [];

  if (resolvedAudienceType === "OFFICES" && resolvedOfficeIds.length === 0) return jsonError("Pick at least one office");
  if (resolvedAudienceType === "DEPARTMENTS" && resolvedDepartmentIds.length === 0) return jsonError("Pick at least one department");
  if (resolvedAudienceType === "USERS" && resolvedUserIds.length === 0) return jsonError("Pick at least one user");

  // Validate IDs belong to the org
  if (resolvedOfficeIds.length > 0) {
    const valid = await prisma.office.findMany({ where: { id: { in: resolvedOfficeIds }, organizationId: orgId }, select: { id: true } });
    if (valid.length !== resolvedOfficeIds.length) return jsonError("One or more offices invalid", 400);
  }
  if (resolvedDepartmentIds.length > 0) {
    const valid = await prisma.department.findMany({ where: { id: { in: resolvedDepartmentIds }, organizationId: orgId }, select: { id: true } });
    if (valid.length !== resolvedDepartmentIds.length) return jsonError("One or more departments invalid", 400);
  }
  if (resolvedUserIds.length > 0) {
    const valid = await prisma.user.findMany({ where: { id: { in: resolvedUserIds }, organizationId: orgId, deletedAt: null }, select: { id: true } });
    if (valid.length !== resolvedUserIds.length) return jsonError("One or more users invalid", 400);
  }

  const survey = await prisma.pulseSurvey.create({
    data: {
      title: title.trim(),
      questions: questions as any,
      frequency: resolvedFrequency,
      status: "ACTIVE",
      audienceType: resolvedAudienceType,
      officeIds: resolvedOfficeIds,
      departmentIds: resolvedDepartmentIds,
      userIds: resolvedUserIds,
      // Default anonymous unless the caller explicitly opts out.
      anonymous: anonymous === false ? false : true,
      closesAt: resolvedClosesAt,
      organizationId: orgId,
    },
  });

  // Resolve audience → in-app notifications + emails (non-blocking)
  notifyAudience(
    orgId,
    survey.id,
    survey.title,
    resolvedAudienceType,
    resolvedOfficeIds,
    resolvedDepartmentIds,
    resolvedUserIds,
  ).catch((e) => console.error("[Survey] notifyAudience failed:", e));

  return jsonSuccess(survey, 201);
}

async function notifyAudience(
  orgId: string,
  surveyId: string,
  title: string,
  audienceType: string,
  officeIds: string[],
  departmentIds: string[],
  userIds: string[],
) {
  const where: any = { organizationId: orgId, deletedAt: null };
  if (audienceType === "OFFICES") where.officeId = { in: officeIds };
  else if (audienceType === "DEPARTMENTS") where.departmentId = { in: departmentIds };
  else if (audienceType === "USERS") where.id = { in: userIds };
  // ALL → no extra filter

  const audience = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  });

  if (audience.length === 0) return;

  const message = `A new pulse survey "${title}" is waiting for your input.`;
  await prisma.notification.createMany({
    data: audience.map((u) => ({
      title: "New pulse survey",
      message,
      type: "SURVEY",
      link: "/surveys",
      userId: u.id,
    })),
  });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const actionLink = `${baseUrl}/surveys`;

  // Respect per-user email preferences (dailyDigest opt-in stays digest-only)
  const userIdList = audience.map((u) => u.id);
  const prefs = await prisma.emailPreference.findMany({
    where: { userId: { in: userIdList } },
    select: { userId: true },
  });
  // Users without an EmailPreference row: default to email on (consistent with schema defaults)
  const prefMap = new Map(prefs.map((p) => [p.userId, true]));

  for (const u of audience) {
    if (!u.email) continue;
    if (prefMap.has(u.id) === false) prefMap.set(u.id, true); // default on
    const { subject, html } = genericNotificationTemplate({
      heading: "New Pulse Survey",
      recipientName: u.firstName,
      subjectText: "You've been included in a new pulse survey. Your responses stay anonymous and help shape the team.",
      itemTitle: title,
      itemDetails: "Takes about a minute",
      actionLabel: "Respond now",
      actionLink,
    });
    sendEmail({
      to: u.email,
      subject,
      html,
      template: "survey-published",
      variables: { surveyId, title },
      organizationId: orgId,
      userId: u.id,
      category: "survey",
    }).catch((err) => console.error(`[Survey] email to ${u.email} failed:`, err));
  }
}
