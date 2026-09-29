// The Teams hub's viewer facts and sidebar counts, computed in the boot
// pass (spec-teams-performance section 1 "Counts": the badges ride the one
// boot `counts` payload, zero pollers, zero round trips).
//
// Every query is the SAME clause as the page the badge points at, through a
// shared helper where one exists (countReviewsAwaitingManager for
// /team/reviews, listAwaitingKpiNumbers for /team/kpi-reviews), so a
// badge and its page can never disagree.
//
// Every read is wrapped: a badge is chrome, and a boot payload that will not
// mount because a count query threw is a far worse failure than a missing
// number. A failure logs and answers 0 (or false), and the new
// "CandorRespondent" table being absent for one release degrades to "nobody
// has answered anything", never to a crash.
//
// Server only (prisma).

import { currentKpiPeriod } from "@/lib/kpi-period";
import { prisma } from "@/lib/prisma";
import { countAwaitingKpiNumbers } from "@/lib/kpi-review.server";
import { countChainReviewsAwaiting, countReviewsAwaitingManager } from "@/lib/weekly-review";
import { getUserTagIds } from "@/lib/user-tags";
import { inSurveyAudience, surveyOpenNow } from "./survey-audience";

export interface TeamsViewerFacts {
  /** Reports, solid or dotted: the same rule as the access engine's viewer. */
  hasReports: boolean;
  /** In the scope of at least one open candor session, or has answered one. */
  candorInvited: boolean;
  /** In the audience of at least one open survey, or has answered one. */
  surveyTargeted: boolean;
}

export interface TeamsCounts {
  /** Weekly reviews awaiting the viewer's decision (/team/reviews, direct reports). */
  weeklyReviews: number;
  /**
   * The same over the viewer's whole chain (solid any depth plus dotted):
   * My team's attention row and its sidebar badge (spec-teams-people /team,
   * the PO-16 decision). Always at least weeklyReviews.
   */
  weeklyReviewsChain: number;
  /** Review forms awaiting the viewer: own self review plus manager reviews owed. */
  reviewForms: number;
  /** Open candor sessions in scope the viewer has not answered. */
  candorOpen: number;
  /** Open surveys the viewer is targeted by and has not answered. */
  surveysOpen: number;
  /** KPI numbers awaiting the viewer's approval (/team/kpi-reviews). */
  kpiReviews: number;
  /** The viewer's own KPIs this month with no number yet (Work > My KRAs & KPIs). */
  myKpisDue: number;
}

export const EMPTY_TEAMS_COUNTS: TeamsCounts = {
  weeklyReviews: 0,
  weeklyReviewsChain: 0,
  reviewForms: 0,
  candorOpen: 0,
  surveysOpen: 0,
  kpiReviews: 0,
  myKpisDue: 0,
};

function safe<T>(label: string, fallback: T, p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    console.error(`boot teams: ${label}`, e);
    return fallback;
  });
}

/** "YYYY-MM" for the current month: the one helper the Record numbers view uses too. */
export { currentKpiPeriod };

export async function hasReportsFor(userId: string): Promise<boolean> {
  // The engine's viewer (src/lib/access/viewer.ts reportTreeFor) counts the
  // solid tree plus direct dotted reports; one of each is enough here.
  const [solid, dotted] = await Promise.all([
    prisma.user.count({ where: { managerId: userId, deletedAt: null } }),
    prisma.userDottedLine.count({ where: { managerId: userId } }),
  ]);
  return solid > 0 || dotted > 0;
}

/** Candor sessions open to the viewer as a respondent (never their own). */
async function openCandorIds(userId: string, orgId: string, departmentId: string | null): Promise<string[]> {
  const scope: { departmentId: string | null }[] = [{ departmentId: null }];
  if (departmentId) scope.push({ departmentId });
  const rows = await prisma.candorSession.findMany({
    where: { organizationId: orgId, status: "ACTIVE", createdBy: { not: userId }, OR: scope },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function answeredCandorIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.candorRespondent.findMany({ where: { userId }, select: { sessionId: true } });
  return new Set(rows.map((r) => r.sessionId));
}

/**
 * The viewer facts and the counts in one pass. `me` carries the fields the
 * audience rules read, from the boot's own user row.
 */
export async function teamsFactsAndCounts(
  userId: string,
  orgId: string,
  me: { officeId: string | null; departmentId: string | null },
  now: Date = new Date(),
): Promise<{ facts: TeamsViewerFacts; counts: TeamsCounts }> {
  const [hasReports, candorIds, answeredCandor, surveys, tagIds, weeklyReviews, kpiReviews, reviewForms, myKpisDue, weeklyReviewsChain] =
    await Promise.all([
      safe("hasReports", false, hasReportsFor(userId)),
      safe("candor", [] as string[], openCandorIds(userId, orgId, me.departmentId)),
      safe("candorRespondent", new Set<string>(), answeredCandorIds(userId)),
      safe(
        "surveys",
        [] as Array<{
          id: string; status: string; closesAt: Date | null; audienceType: string;
          officeIds: string[]; departmentIds: string[]; userIds: string[]; tagIds: string[];
          responses: { id: string }[];
        }>,
        prisma.pulseSurvey.findMany({
          where: { organizationId: orgId, OR: [{ status: "ACTIVE" }, { responses: { some: { userId } } }] },
          select: {
            id: true, status: true, closesAt: true, audienceType: true,
            officeIds: true, departmentIds: true, userIds: true, tagIds: true,
            responses: { where: { userId }, select: { id: true } },
          },
        }),
      ),
      safe("tags", [] as string[], getUserTagIds(orgId, userId)),
      safe("weeklyReviews", 0, countReviewsAwaitingManager(userId)),
      safe("kpiReviews", 0, countAwaitingKpiNumbers(userId)),
      safe(
        "reviewForms",
        0,
        prisma.review.count({
          where: {
            cycle: { organizationId: orgId, status: "ACTIVE" },
            OR: [
              { subjectId: userId, status: "PENDING" },
              { reviewerId: userId, subjectId: { not: userId }, status: { in: ["PENDING", "SELF_ASSESSMENT"] } },
            ],
          },
        }),
      ),
      safe(
        "myKpisDue",
        0,
        prisma.kPIRecord.count({ where: { userId, period: currentKpiPeriod(now), status: "PENDING", kpi: { organizationId: orgId } } }),
      ),
      safe("weeklyReviewsChain", 0, countChainReviewsAwaiting(userId)),
    ]);

  const viewer = { userId, officeId: me.officeId, departmentId: me.departmentId, tagIds };
  let surveysOpen = 0;
  let surveyTargeted = false;
  for (const s of surveys) {
    const answered = s.responses.length > 0;
    if (surveyDoorOpen(s, viewer, now)) surveyTargeted = true;
    if (surveyOpenNow(s, now) && inSurveyAudience(s, viewer) && !answered) surveysOpen += 1;
  }

  const candorOpen = candorIds.filter((id) => !answeredCandor.has(id)).length;
  // The respondent door: an ACTIVE session in the viewer's audience that
  // someone else runs (answered or not, it is still listed to them). A
  // session they answered that has since CLOSED is not: GET /api/candor
  // lists only active sessions to a respondent, so the row would open an
  // empty page forever.
  const candorInvited = candorIds.length > 0;

  return {
    facts: { hasReports, candorInvited, surveyTargeted },
    counts: { weeklyReviews, weeklyReviewsChain: Math.max(weeklyReviewsChain, weeklyReviews), reviewForms, candorOpen, surveysOpen, kpiReviews, myKpisDue },
  };
}

/**
 * The candorInvited fact alone, for the /candor page gate: the same clause
 * the boot pass uses, so the Candor row and the page it opens always agree.
 */
export async function candorInvitedFor(userId: string, orgId: string, departmentId: string | null): Promise<boolean> {
  const open = await safe("candor", [] as string[], openCandorIds(userId, orgId, departmentId));
  return open.length > 0;
}

/**
 * The survey respondent door, the rule GET /api/pulse-surveys lists by: a
 * live (not Draft) survey whose audience includes the viewer today, which
 * is open now or which they answered. A survey they answered before moving
 * out of its audience is not listed to them, so it does not hold the row.
 */
function surveyDoorOpen(
  s: { status: string; closesAt: Date | null; audienceType: string; officeIds: string[]; departmentIds: string[]; userIds: string[]; tagIds: string[]; responses: { id: string }[] },
  viewer: { userId: string; officeId: string | null; departmentId: string | null; tagIds: string[] },
  now: Date,
): boolean {
  if (s.status === "DRAFT" || !inSurveyAudience(s, viewer)) return false;
  return s.responses.length > 0 || surveyOpenNow(s, now);
}

/**
 * The surveyTargeted fact alone, for the /surveys page gate: the same rule
 * as the boot pass (surveyDoorOpen).
 */
export async function surveyTargetedFor(
  userId: string,
  orgId: string,
  me: { officeId: string | null; departmentId: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  const [surveys, tagIds] = await Promise.all([
    safe(
      "surveys",
      [] as Array<{
        status: string; closesAt: Date | null; audienceType: string;
        officeIds: string[]; departmentIds: string[]; userIds: string[]; tagIds: string[];
        responses: { id: string }[];
      }>,
      prisma.pulseSurvey.findMany({
        where: { organizationId: orgId, OR: [{ status: "ACTIVE" }, { responses: { some: { userId } } }] },
        select: {
          status: true, closesAt: true, audienceType: true,
          officeIds: true, departmentIds: true, userIds: true, tagIds: true,
          responses: { where: { userId }, select: { id: true } },
        },
      }),
    ),
    safe("tags", [] as string[], getUserTagIds(orgId, userId)),
  ]);
  const viewer = { userId, officeId: me.officeId, departmentId: me.departmentId, tagIds };
  return surveys.some((s) => surveyDoorOpen(s, viewer, now));
}
