// Is a person in a pulse survey's audience? The ONE pure rule, so the
// /surveys list, the survey page, the Teams sidebar row and its count all
// answer the same (spec-teams-performance section 1: the Surveys row renders
// for every TARGETED Member, and its count is the open surveys they have
// not answered).
//
// Mirrors the audience branch of GET /api/pulse-surveys exactly. Pure: no
// prisma, no imports.

export interface SurveyAudienceRow {
  audienceType: string;
  officeIds: string[];
  departmentIds: string[];
  userIds: string[];
  tagIds: string[];
}

export interface SurveyAudienceViewer {
  userId: string;
  officeId: string | null;
  departmentId: string | null;
  tagIds: readonly string[];
}

export function inSurveyAudience(s: SurveyAudienceRow, v: SurveyAudienceViewer): boolean {
  switch (s.audienceType) {
    case "ALL":
      return true;
    case "OFFICES":
      return !!v.officeId && s.officeIds.includes(v.officeId);
    case "DEPARTMENTS":
      return !!v.departmentId && s.departmentIds.includes(v.departmentId);
    case "USERS":
      return s.userIds.includes(v.userId);
    case "TAGS":
      return s.tagIds.some((t) => v.tagIds.includes(t));
    default:
      // An audience type this build does not know targets nobody: the safe
      // direction for a survey (a person is never shown a form not meant
      // for them).
      return false;
  }
}

/**
 * Is a survey open for answers right now? ACTIVE and not past its close
 * date. The respond route relies on the nightly cron to close a survey, so
 * a survey whose closesAt has passed but whose status has not flipped yet
 * is not counted as open here.
 */
export function surveyOpenNow(s: { status: string; closesAt: Date | string | null }, now: Date): boolean {
  if (s.status !== "ACTIVE") return false;
  if (!s.closesAt) return true;
  return new Date(s.closesAt).getTime() > now.getTime();
}

/**
 * Who may launch, close and edit a survey (access-model-spec 3.3 Survey:
 * "creator FULL; Admin + People team FULL"). A survey made before Phase 6
 * has no recorded creator; it stays with every organiser who could manage
 * it yesterday (the manager tier), so nobody loses a survey they ran.
 */
export function canManageSurvey(i: {
  callerId: string;
  createdById: string | null | undefined;
  peopleTeamOrAdmin: boolean;
  legacyManagerTier: boolean;
}): boolean {
  if (i.peopleTeamOrAdmin) return true;
  if (i.createdById) return i.createdById === i.callerId;
  return i.legacyManagerTier;
}

/**
 * A live survey's questions freeze once the first answer exists: answers are
 * stored as [{ questionId, value }], so an edit after that would orphan them.
 * Title, close date and status stay editable.
 */
export function surveyQuestionsLocked(responseCount: number): boolean {
  return responseCount > 0;
}
