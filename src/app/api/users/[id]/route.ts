// One person's record (spec-teams-people /people/[id]).
//
//   GET     the directory card for every Member; people data (phone, date
//           of birth, capacity, KRA and KPI history, reviews, ratings, the
//           score) only for self, the reporting chain (solid or dotted, any
//           depth), the People team, the org-wide levels and Admins. The
//           payload carries `access`, the server's answer to what the viewer
//           may do here, so the page renders only controls that will work.
//   PATCH   the per-field whitelist of src/lib/people/person-fields.ts: an
//           unknown key is a 400, a key the caller may not write is a 403
//           `field_forbidden` naming it. Reports to is checked for loops
//           (409 `manager_cycle`) and never lands on an Agent (400
//           `agent_cannot_manage`); job title, department and office must be
//           the org's own. Replacing a Reports to another workspace relies
//           on (the record says "someone in another workspace") is a 409
//           `manager_elsewhere` until the request carries
//           `replaceOtherWorkspaceLine: true`, which Edit details sends once
//           the person confirms (docs-found fixes batch 7). The whole edit is
//           one outcome: a refusal inside the transaction rolls back what it
//           wrote before it (a reactivation's cleared dotted lines included).
//   DELETE  remove (soft) or ?restore=true, unchanged gate: Admins, and a
//           manager-tier viewer whose relation writes (people-team, org-wide
//           or chain), never on an Admin (person-access.server.ts
//           mayRemovePerson). A removal waits for the handover, as a
//           deactivation does (409 `handover_first`, batch 8; before, a
//           direct DELETE left reports, tasks and Spaces under a removed
//           account). The handover's own gate is narrower (batch 9,
//           mayHandOverPerson: Admins, and the manager tier over their own
//           solid tree): an org-wide level or the People team outside that
//           tree removes only someone who holds nothing to hand over, and
//           the 409 says who can hand it over.
//
// A deactivation and a removal end the account in every workspace (status
// and deletedAt are one column each). So the reports whose line another
// workspace relies on, which the handover leaves while the account is live,
// move HERE, in the same role-locked transaction, right before status or
// deletedAt is written (docs-found fixes batch 8; handover.server.ts
// moveReliedReportsAtEnd), to the person the dialog picked (`handoverTo`, in
// PATCH's body or DELETE's query), with that workspace's record of each.
// Batch 7 moved them in the handover, before a step that could still be
// refused; now a refusal, a busy lock or a dropped connection moves nothing.
// `handoverTo` is read only from someone who may hand the person's work
// over (batch 9, mayHandOverPerson); from anyone else the reports go up the
// person's line, as with no `handoverTo`, so nobody outside that rule picks
// themselves to take another's reports. Under the lock the whole gate is read
// again, open tasks and Spaces, Folders and Lists as well as reports (batch
// 9: batch 8 read only the reports there, so a task given to the person
// after the first check went with them).
//
// A reactivation, like a restore, comes back only under reporting lines that
// still hold (docs-found fixes batch 5): checked again under the role lock,
// cleared and logged where they fail (manager-candidate.ts staleLinesOf).
// The seat lock after the role lock waits a bounded time and answers the
// same busy 503, never a 500.
//
// An account its own person erased (POST /api/me/delete) is never restored
// or edited here: 409 `account_erased` (review round 8 of Phase 3). Before, a
// restore set deletedAt back to null and an edit could name the "Deleted
// User" again, and the erasure sweep then never recognised the account, so
// their AI teammates' words stayed for good. Only a deactivation, and a
// removal, still go through: switching someone off is never refused.
// Review round 9 of Phase 3: "erased" means in the state its erasure left it
// (src/lib/compliance/erased-account.ts). An erased account an Admin restored
// before round 8 (deletedAt null), or removed after such a restore, is an
// ordinary account here: edited, removed and restored as anyone is. Before,
// every edit of it, a role change included, was refused while it was in use
// again. A removal sets deletedAt only where it is null, so it never moves
// an erased account's deletedAt off the erasure's moment.
//
// The legacy Task table (dead since Phase 2) and the check-ins no writer
// ever fed are no longer read here.

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { levelsHeldIn } from "@/lib/access/acting-workspace";
import { managerLineIsOthers, recordLinesOfOthers } from "@/lib/access/manager-lines";
import { namedHere, namedIds } from "@/lib/people/named-here";
import { logActivity } from "@/lib/activity";
import { followReportingLine } from "@/lib/performance/review-cycle.server";
import { getLatestScore, getScoreHistory } from "@/services/performanceScoreService";
import { seedAlignmentForUser } from "@/lib/alignment-assign";
import {
  checkManagerCandidate,
  managerMapFor,
  mayHandOverPerson,
  mayRemovePerson,
  peopleCtx,
  relationTo,
  type PeopleCtx,
} from "@/lib/people/person-access.server";
import { staleTabRefusal } from "@/lib/access/tab-workspace-check";
import {
  PERSON_FIELD_GROUP,
  PERSON_FIELD_LABEL,
  canWritePersonField,
  checkPersonPatch,
  dobOverwriteAllowed,
  seesFullBirthday,
  visibleStatus,
  type PersonRelation,
} from "@/lib/people/person-fields";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";
import { followAccountEndLines, moveReliedReportsAtEnd, pendingHandover, type AccountEndLines } from "@/lib/people/handover.server";
import { belongsElsewhere, homeAfterRemoval, reanchorUser } from "@/lib/access/workspace-anchor";
import { presenceFor } from "@/lib/people/directory-list.server";
import { getScoringBands } from "@/lib/review-cadence";
import { scoreBand } from "@/lib/people/score-band";
import { subjectRowView } from "@/lib/people/review-visibility";
import { profileFieldRows, readProfileFieldDefs, validateProfileValues } from "@/lib/people/profile-fields";
import { effectivePersonSchedule, nominalWeekHours, readPersonScheduleOverride, validatePersonScheduleOverride } from "@/lib/work-schedule";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { applyRoleChange, isLiveOwner, lockOrgRoles, roleChangeSentence, wouldRemoveLastOwner, type AppliedRoleChange, type MemberRole } from "@/lib/access/membership";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { freshActorRefusal, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { endTeammateAccessFor } from "@/lib/agents/leaver-hooks";
import { skillsBackFor } from "@/lib/skills/store";
import { ACCOUNT_ERASED, isErasedAccount } from "@/lib/compliance/erased-account";
import { clearedLineSentence, managerCandidateIn, staleLineWords, staleLinesOf, wouldLoopIn, type StaleLine } from "@/lib/access/manager-candidate";
import { rolesBusyOrThrow } from "@/lib/access/roles-busy";
import { LOCKED_TX } from "@/lib/access/org-roles-busy";
import { afterRoleChanges } from "@/lib/access/role-change-after";

/** The AccessLevel enum's values (a bad value is a 400, never a Prisma 500). */
const ACCESS_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"] as const;

const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

/** What PATCH answers when its transaction refuses the edit. */
type PatchRefusal = { ok: false; status: 400 | 403 | 404 | 409; error: string; code: string; fields?: string[] };

/** A refusal inside PATCH's transaction, thrown so the transaction rolls back (batch 7). */
class PatchRefused extends Error {
  constructor(readonly refusal: PatchRefusal) {
    super("refused");
    this.name = "PatchRefused";
  }
}

/** DELETE found the person removed already under its lock: thrown so the lines it moved roll back (batch 8). */
class AlreadyRemoved extends Error {
  constructor() {
    super("already removed");
    this.name = "AlreadyRemoved";
  }
}

/**
 * The 409 handover_first's words. A viewer who may remove the person but not
 * hand their work over (batch 9: an org-wide level or the People team outside
 * their own solid tree) is told who can, never "hand over their work first",
 * which they cannot do.
 */
function handoverFirstWords(canHandOver: boolean): string {
  return canHandOver
    ? "Hand over their work first: they still own open tasks, direct reports or Spaces, Folders and Lists."
    : "They still own open tasks, direct reports or Spaces, Folders and Lists, and only an Admin or a manager above them can hand those over. Ask one of them to, then try again.";
}

/** Anything a handover must move first (pendingHandover's counts). */
const holdsWork = (left: { openTasks: number; directReports: number; containers: number }) => left.openTasks + left.directReports + left.containers > 0;

/** The log's words for the reports a deactivation or removal moved itself (batch 8). */
function alsoElsewhereLogWords(n: number, step: "deactivation" | "removal"): string {
  if (n === 0) return "";
  return n === 1
    ? `. 1 of their reports also reported to them in another workspace: that line moved with the ${step}, and that workspace's Audit log records it`
    : `. ${n} of their reports also reported to them in another workspace: those lines moved with the ${step}, and that workspace's Audit log records it`;
}

function accessFor(
  ctx: PeopleCtx,
  relation: PersonRelation,
  subject: { id: string; deletedAt: Date | null; accessLevel: string },
  subjectHasDob = false,
) {
  const opts = { managerTierSelf: relation === "self" && ctx.managerTier, chainWritesMembership: !accessV2Resolver() };
  const editable = Object.keys(PERSON_FIELD_GROUP).filter(
    (f) =>
      f !== "accessLevel" &&
      f !== "avatar" &&
      canWritePersonField(f, relation, opts) &&
      (f !== "dateOfBirth" || dobOverwriteAllowed(relation, subjectHasDob)),
  );
  // Acting on a person (remove, photo, alignment, ratings, tags, dotted
  // lines) is yesterday's write door: self, Admin, the People team, the
  // org-wide levels, or a manager-tier viewer over their SOLID tree. A
  // dotted-line manager, or a report's manager below manager tier
  // (chain-view), reads the record and acts on nothing.
  const writes = relation !== "none" && relation !== "chain-view";
  const canRemove = mayRemovePerson(ctx, relation, subject);
  const peopleData = relation !== "none";
  return {
    relation,
    peopleData,
    editable,
    remove: canRemove && !subject.deletedAt,
    restore: canRemove && !!subject.deletedAt,
    // The handover's own, narrower rule (batch 9): the Remove dialog asks
    // for the summary and hands over only when this is true.
    handover: !subject.deletedAt && mayHandOverPerson(ctx, subject.id, subject),
    avatar: !subject.deletedAt && (relation === "self" || ctx.isAdmin || (writes && ctx.managerTier)),
    manageAlignment: relation !== "self" && writes,
    rateSkills: relation !== "self" && writes,
    addSkills: relation === "self" || ctx.isAdmin || ctx.peopleTeam,
    removeSkills: relation === "self" || ctx.isAdmin,
    tags: relation !== "self" && writes,
    dottedLines: relation !== "self" && writes,
    manageMembers: ctx.isAdmin,
    // Day and month of the birthday for the chain; the full date for self,
    // the People team and Admins.
    fullBirthday: seesFullBirthday(relation),
  };
}

async function tolerantPeopleFields(id: string): Promise<{ weeklyCapacityHours: number | null; customFields: unknown; workSchedule: unknown }> {
  try {
    const r = await prisma.user.findUnique({ where: { id }, select: { weeklyCapacityHours: true, customFields: true, workSchedule: true } });
    return { weeklyCapacityHours: r?.weeklyCapacityHours ?? null, customFields: r?.customFields ?? null, workSchedule: r?.workSchedule ?? null };
  } catch {
    // The Phase 6 columns are absent for one release: every reader falls back.
    return { weeklyCapacityHours: null, customFields: null, workSchedule: null };
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  const { id } = await params;
  const relation = relationTo(ctx, id);

  const card = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      status: true,
      accessLevel: true,
      joinDate: true,
      deletedAt: true,
      managerId: true,
      role: { select: { id: true, title: true, description: true, level: true } },
      department: { select: { id: true, name: true, color: true } },
      office: { select: { id: true, name: true, city: true, country: true, isHeadquarters: true } },
      manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      dottedLineToManagers: {
        select: { manager: { select: { id: true, firstName: true, lastName: true, avatar: true, deletedAt: true } } },
      },
      directReports: {
        where: { deletedAt: null },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: {
          id: true, firstName: true, lastName: true, avatar: true,
          role: { select: { id: true, title: true } },
          department: { select: { id: true, name: true } },
        },
      },
      skills: { orderBy: { name: "asc" }, select: { id: true, name: true, selfRating: true, managerRating: true } },
      _count: { select: { kudosReceived: true } },
    },
  });
  if (!card) return err(404, "User not found");

  const presence = (await presenceFor([id])).get(id) ?? null;
  const dobRow = relation === "none" ? null : await prisma.user.findUnique({ where: { id }, select: { dateOfBirth: true } });
  const access = accessFor(ctx, relation, card, !!dobRow?.dateOfBirth);
  const isGuest = ctx.orgRole === "GUEST";
  // Only people of this workspace are named (batch 6, src/lib/people/named-here.ts),
  // and a line another workspace counts is said to be there, never named (batch 7).
  const related = { manager: card.manager, dottedManagers: card.dottedLineToManagers.map((d) => d.manager), directReports: card.directReports };
  const [here, others] = await Promise.all([
    levelsHeldIn(ctx.organizationId, namedIds(related)),
    recordLinesOfOthers(ctx.organizationId, id, card.managerId, related.dottedManagers.map((d) => d.id)),
  ]);
  const named = namedHere(related, here, others);
  const base = {
    id: card.id,
    firstName: card.firstName,
    lastName: card.lastName,
    email: card.email,
    avatar: card.avatar,
    // Raw employment status (PIP, notice period, probation, leave) is people
    // data; everyone else learns only whether the account is deactivated.
    status: visibleStatus(card.status, access.peopleData),
    isDeactivated: card.status === "INACTIVE",
    joinDate: card.joinDate,
    deletedAt: card.deletedAt,
    isAgent: card.accessLevel === "AGENT",
    role: card.role ? { id: card.role.id, title: card.role.title, description: card.role.description, seniority: card.role.level } : null,
    department: card.department,
    office: card.office,
    manager: named.manager,
    // "Reports to someone in another workspace" (batch 7): never who.
    managerElsewhere: named.managerElsewhere,
    dottedManagers: named.dottedManagers,
    // Dotted lines kept for another workspace: counted, never named.
    dottedElsewhere: named.dottedElsewhere,
    directReports: isGuest ? [] : named.directReports,
    presenceStatus: presence?.presenceStatus ?? null,
    presenceUntil: presence?.presenceUntil ?? null,
    // Skill names are for everyone (who knows Figma?); ratings are people data.
    skills: card.skills.map((s) => ({
      id: s.id,
      name: s.name,
      selfRating: access.peopleData ? s.selfRating : null,
      managerRating: access.peopleData ? s.managerRating : null,
    })),
    kudosCount: isGuest ? 0 : card._count.kudosReceived,
    access,
  };

  // Kudos are public inside the workspace (/kudos lists them all), so every
  // Member sees the ones on a record. Guests never do.
  const kudosReceived = isGuest
    ? []
    : await prisma.kudos.findMany({
        where: { receiverId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          reactions: { select: { emoji: true, userId: true } },
        },
      });
  const kudos = kudosReceived.map((k) => {
    const byEmoji = new Map<string, number>();
    const mine: string[] = [];
    for (const r of k.reactions) {
      byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + 1);
      if (r.userId === ctx.userId) mine.push(r.emoji);
    }
    return {
      id: k.id,
      message: k.message,
      companyValue: k.companyValue,
      createdAt: k.createdAt,
      giver: k.giver,
      reactionCounts: [...byEmoji.entries()].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count),
      myReactions: mine,
    };
  });

  if (!access.peopleData) {
    return NextResponse.json({ ...base, kudosReceived: kudos, minimal: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const [full, extra, latestScore, scoreHistory, org] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        phone: true,
        dateOfBirth: true,
        certifications: { orderBy: { issuedAt: "desc" } },
        kpiRecords: {
          orderBy: [{ period: "desc" }, { updatedAt: "desc" }],
          take: 12,
          select: {
            id: true, period: true, actualValue: true, targetValue: true, score: true, status: true, reviewedById: true,
            kpi: { select: { name: true, unit: true } },
          },
        },
        reviewsAsSubject: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true, cycleId: true, status: true, outcome: true, overallScore: true, calibratedScore: true, reviewerId: true,
            cycle: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
          },
        },
        _count: { select: { kpiRecords: true, reviewsAsSubject: true } },
      },
    }),
    tolerantPeopleFields(id),
    getLatestScore(id),
    getScoreHistory(id, 6),
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { settings: true } }),
  ]);
  const orgSchedule = await readOrgWorkSchedule(ctx.organizationId);
  const bands = getScoringBands((org?.settings ?? {}) as Parameters<typeof getScoringBands>[0]);

  const reviewerIds = [...new Set((full?.kpiRecords ?? []).map((r) => r.reviewedById).filter((x): x is string => !!x))];
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const reviewerName = new Map(reviewers.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));

  let dateOfBirth: string | null = full?.dateOfBirth ? full.dateOfBirth.toISOString().slice(0, 10) : null;
  // The chain sees the day and month only (for the birthday), never the year.
  if (dateOfBirth && !access.fullBirthday) dateOfBirth = `--${dateOfBirth.slice(5)}`;

  return NextResponse.json(
    {
      ...base,
      kudosReceived: kudos,
      phone: full?.phone ?? null,
      dateOfBirth,
      weeklyCapacityHours: extra.weeklyCapacityHours,
      // The schedule this person works (their own days and hours, or the
      // org's) and the week it adds up to, so the record says
      // "Org default (40h)" instead of a bare "Org default".
      workSchedule: readPersonScheduleOverride(extra.workSchedule),
      orgSchedule: { workdays: orgSchedule.workdays, hoursPerDay: orgSchedule.hoursPerDay },
      defaultWeeklyHours: nominalWeekHours(effectivePersonSchedule(orgSchedule, extra.workSchedule)),
      // Only the fields the org defines, in its order; a value whose field
      // was removed stays stored but is not shown.
      profileFields: profileFieldRows(readProfileFieldDefs(org?.settings), extra.customFields),
      certifications: full?.certifications ?? [],
      kpiHistory: (full?.kpiRecords ?? []).map((r) => ({
        ...r,
        reviewedBy: r.reviewedById ? reviewerName.get(r.reviewedById) ?? null : null,
      })),
      kpiHistoryTotal: full?._count.kpiRecords ?? 0,
      reviewsTotal: full?._count.reviewsAsSubject ?? 0,
      // A review row is the subject's result; the written peer answers never
      // ride this payload (spec-teams-performance, the aggregate rule). The
      // subject's own rows go through the same lens as the cycle GET
      // (subjectRowView): no calibration ever, and the outcome and score
      // only once the review is COMPLETED, so a manager's draft rating or a
      // calibration in progress never reaches them early.
      reviews: (full?.reviewsAsSubject ?? []).map((r) => {
        const { reviewerId: _reviewerId, ...rest } = relation === "self" ? subjectRowView(r, ctx.userId) : r;
        void _reviewerId;
        return rest;
      }),
      score: latestScore ? { score: latestScore.score, breakdown: latestScore.breakdown, band: scoreBand(latestScore.score, bands) } : null,
      scoreHistory: scoreHistory.map((h) => ({ period: h.period, score: h.score })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return err(400, "Send a JSON object");
    body = raw as Record<string, unknown>;
  } catch {
    return err(400, "Send a JSON object");
  }
  // The confirmation that a Reports to another workspace relies on may be
  // replaced (batch 7). It writes nothing itself, so it is taken out before
  // the field whitelist.
  const replaceOtherWorkspaceLine = body.replaceOtherWorkspaceLine === true;
  delete body.replaceOtherWorkspaceLine;
  // Who takes the reports a deactivation moves itself (batch 8: those whose
  // line another workspace relies on, which the handover leaves until the
  // account ends): the person the transfer dialog handed the rest to. It
  // writes nothing on this person, so it is taken out before the whitelist
  // too. Absent, they go up the person's line (moveReliedReportsAtEnd).
  const handoverAsked = typeof body.handoverTo === "string" && body.handoverTo ? body.handoverTo : null;
  delete body.handoverTo;

  const target = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, accessLevel: true, roleId: true, managerId: true, deletedAt: true, status: true, firstName: true, lastName: true },
  });
  if (!target) return err(404, "User not found");

  const relation = relationTo(ctx, id);
  if (relation === "none") return err(403, "You can only edit your own record or your reports'.");
  // Read only from someone who may hand this person's work over (batch 9):
  // the org-wide levels and the People team write status for everyone, and
  // never pick who takes another's reports outside their own solid tree.
  const canHandOver = mayHandOverPerson(ctx, id, target);
  const handoverTo = canHandOver ? handoverAsked : null;
  const opts = { managerTierSelf: relation === "self" && ctx.managerTier, chainWritesMembership: !accessV2Resolver() };
  const { unknown, forbidden } = checkPersonPatch(body, relation, opts);
  if (unknown.length) return err(400, `Unknown field: ${unknown.join(", ")}`, { code: "unknown_field", fields: unknown });
  if (forbidden.length) {
    const words = forbidden.map((f) => PERSON_FIELD_LABEL[f] ?? f).join(", ");
    return err(403, relation === "self" ? `Ask your manager or the People team to change: ${words}` : `You can't change: ${words}`, {
      code: "field_forbidden",
      fields: forbidden,
    });
  }
  // An erased account keeps its anonymisation (see the header): only a
  // deactivation goes through (review round 8 of Phase 3).
  const deactivationOnly = Object.keys(body).length === 1 && body.status === "INACTIVE";
  if (!deactivationOnly && (await isErasedAccount(prisma, id))) return err(409, ACCOUNT_ERASED.error, { code: ACCOUNT_ERASED.code });

  const data: Record<string, unknown> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : v);

  for (const key of ["firstName", "lastName"] as const) {
    if (body[key] === undefined) continue;
    const v = str(body[key]);
    if (typeof v !== "string" || !v || v.length > 80) return err(400, `A ${PERSON_FIELD_LABEL[key]} is 1 to 80 characters`, { field: key });
    data[key] = v;
  }
  if (body.phone !== undefined) {
    const v = str(body.phone);
    if (v !== null && (typeof v !== "string" || v.length > 40)) return err(400, "A phone number is up to 40 characters", { field: "phone" });
    data.phone = v || null;
  }
  if (body.avatar !== undefined) data.avatar = body.avatar;
  if (body.dateOfBirth !== undefined && relation !== "self" && !seesFullBirthday(relation)) {
    // This viewer is shown the day and month only, so they cannot see what
    // they would overwrite: they may fill a missing date, never replace or
    // clear one.
    const cur = await prisma.user.findUnique({ where: { id }, select: { dateOfBirth: true } });
    if (!dobOverwriteAllowed(relation, !!cur?.dateOfBirth)) {
      return err(403, "A date of birth is already on file. The person, the People team or an Admin can change it.", {
        code: "field_forbidden",
        fields: ["dateOfBirth"],
      });
    }
  }
  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null || body.dateOfBirth === "") data.dateOfBirth = null;
    else {
      const raw = String(body.dateOfBirth);
      // A bare date is stored at noon UTC so no timezone shifts the day.
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw);
      if (Number.isNaN(d.getTime())) return err(400, "That date of birth isn't a date", { field: "dateOfBirth" });
      data.dateOfBirth = d;
    }
  }
  if (body.status !== undefined) {
    const allowed = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"];
    if (typeof body.status !== "string" || !allowed.includes(body.status)) return err(400, "Unknown status", { field: "status" });
    data.status = body.status;
  }
  if (body.weeklyCapacityHours !== undefined) {
    const v = body.weeklyCapacityHours;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 168)) {
      return err(400, "Weekly capacity is 0 to 168 hours, or blank for the org default", { field: "weeklyCapacityHours" });
    }
    data.weeklyCapacityHours = v;
  }
  if (body.workSchedule !== undefined) {
    const v = validatePersonScheduleOverride(body.workSchedule);
    if (!v.ok) return err(400, v.error, { field: "workSchedule" });
    data.workSchedule = v.value === null ? Prisma.DbNull : v.value;
  }
  // Profile fields are merged key by key in one statement after the update
  // (two editors saving different fields never overwrite each other).
  let profilePatch: { set: Record<string, string>; remove: string[] } | null = null;
  if (body.customFields !== undefined) {
    const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { settings: true } });
    const v = validateProfileValues(body.customFields, readProfileFieldDefs(org?.settings));
    if (!v.ok) return err(400, v.error, { field: "customFields" });
    profilePatch = { set: v.set, remove: v.remove };
  }

  // Placement must point at the org's own rows.
  const refChecks: Array<Promise<Response | null>> = [];
  if (body.roleId !== undefined && body.roleId !== null && body.roleId !== "") {
    refChecks.push(prisma.role.count({ where: { id: String(body.roleId), organizationId: ctx.organizationId } }).then((n) => (n ? null : err(400, "That job title isn't in this workspace", { field: "roleId" }))));
  }
  if (body.departmentId !== undefined && body.departmentId !== null && body.departmentId !== "") {
    refChecks.push(prisma.department.count({ where: { id: String(body.departmentId), organizationId: ctx.organizationId } }).then((n) => (n ? null : err(400, "That department isn't in this workspace", { field: "departmentId" }))));
  }
  if (body.officeId !== undefined && body.officeId !== null && body.officeId !== "") {
    refChecks.push(prisma.office.count({ where: { id: String(body.officeId), organizationId: ctx.organizationId } }).then((n) => (n ? null : err(400, "That office isn't in this workspace", { field: "officeId" }))));
  }
  for (const r of await Promise.all(refChecks)) if (r) return r;
  for (const key of ["roleId", "departmentId", "officeId"] as const) {
    if (body[key] !== undefined) data[key] = body[key] === null || body[key] === "" ? null : String(body[key]);
  }

  if (body.managerId !== undefined) {
    const next = body.managerId === null || body.managerId === "" ? null : String(body.managerId);
    // The manager they already have, sent again, is no new Reports to: it is
    // kept as it is (a reactivation reads it in staleLinesOf), never refused.
    if (next && next !== target.managerId) {
      const candidate = await checkManagerCandidate(ctx.organizationId, next);
      if (candidate === "not_found") return err(400, "That person isn't in this workspace", { field: "managerId" });
      if (candidate === "agent_cannot_manage") return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage", field: "managerId" });
      const managers = await managerMapFor(ctx.organizationId);
      if (wouldCreateCycle(id, next, managers)) {
        return err(409, "That would make a reporting loop: this person already manages them, directly or further down.", { code: "manager_cycle", field: "managerId" });
      }
    }
    // Another workspace they work in relies on the line to the manager they
    // report to now (batch 7), who holds no level here or (batch 8) holds the
    // Agent tier here. User.managerId is one column, so a change here, a
    // clear included, changes it there too. Nobody replaces it believing it
    // empty, or believing the Agent manages nobody anywhere: asked first,
    // then done when the request confirms.
    const others = next !== (target.managerId ?? null) && !replaceOtherWorkspaceLine ? await managerLineIsOthers(ctx.organizationId, id, target.managerId) : null;
    if (others) {
      const who = `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim() || "This person";
      // An Agent here is a person of this workspace, so they may be named;
      // someone who holds no level here never is.
      const agent = others === "agent" && target.managerId ? await prisma.user.findFirst({ where: { id: target.managerId }, select: { firstName: true, lastName: true } }) : null;
      const agentName = agent ? `${agent.firstName ?? ""} ${agent.lastName ?? ""}`.trim() : "";
      const error = agentName
        ? `${who} also reports to ${agentName} in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too.`
        : `${who} reports to someone in another workspace they work in, and that workspace still counts the line. Changing who they report to here changes it there too.`;
      return err(409, error, {
        code: "manager_elsewhere",
        field: "managerId",
        confirmWith: "replaceOtherWorkspaceLine",
      });
    }
    data.managerId = next;
  }

  // The org role (settings-architecture 9.2a): { orgRole, memberTier } from
  // the Members drawer, or the older { accessLevel } shape, both through ONE
  // planner (src/lib/access/membership.ts): Owner only for anything touching
  // Owner, never SUPER_ADMIN as a tier, the workspace keeps an Owner, and a
  // lowering bumps tokenVersion so it lands on the person's next request.
  let roleNext: { role: MemberRole; tier?: string | null } | null = null;
  if (body.orgRole !== undefined || body.memberTier !== undefined) {
    const role = body.orgRole ?? "MEMBER";
    if (role !== "OWNER" && role !== "ADMIN" && role !== "MEMBER") return err(400, "Unknown role", { field: "orgRole" });
    if (body.memberTier !== undefined && body.memberTier !== null && typeof body.memberTier !== "string") return err(400, "Unknown tier", { field: "memberTier" });
    roleNext = { role, tier: (body.memberTier as string | null | undefined) ?? null };
  } else if (body.accessLevel !== undefined) {
    if (typeof body.accessLevel !== "string" || !(ACCESS_LEVELS as readonly string[]).includes(body.accessLevel)) {
      return err(400, "Unknown access level", { field: "accessLevel" });
    }
    const lvl = body.accessLevel;
    roleNext = lvl === "SUPER_ADMIN" ? { role: "OWNER" } : lvl === "COMPANY_ADMIN" ? { role: "ADMIN" } : { role: "MEMBER", tier: lvl };
  }

  // Deactivating: only an Owner deactivates an Owner (an Admin locking the
  // Owner out is the worst case), never the last Owner; the session ends on
  // the next check.
  const deactivating = data.status === "INACTIVE";
  if (deactivating) {
    if (id === ctx.userId) return err(400, "You cannot deactivate yourself.");
    // Status lives on the account, not on this workspace: deactivating
    // someone who also belongs to another workspace locked them out of it
    // too (launch audit, 2026-10-31). Removing them here keeps their account
    // in the other one (DELETE moves it there), so that is the way.
    if (target.status !== "INACTIVE" && (await belongsElsewhere(id, ctx.organizationId))) {
      return err(409, "They also belong to another workspace, and deactivating would lock them out of it too. Remove them from this workspace instead: their account stays in the other one.", { code: "belongs_elsewhere", fields: ["status"] });
    }
    // The handover comes first, on every path (invariant 13): a leaver's
    // open tasks, reports and containers are never orphaned by a direct API
    // call. The Members transfer dialog runs POST /api/users/[id]/handover
    // before this PATCH, which empties all three, but for the reports whose
    // line another workspace relies on: this deactivation moves those itself,
    // below (batch 8), so they never hold it up (pendingHandover leaves them
    // out of its count).
    if (target.status !== "INACTIVE") {
      const left = await pendingHandover(ctx.organizationId, id);
      if (holdsWork(left)) return err(409, handoverFirstWords(canHandOver), { code: "handover_first", fields: ["status"], pending: left });
    }
    data.tokenVersion = { increment: 1 };
  }

  // Reactivating takes a seat again (src/lib/seats.ts): a deactivated person
  // does not count against the plan, an active one does. And the person
  // comes back only under lines that still hold, as a restore does (batch
  // 5): while they were away their manager may have been deactivated, left,
  // or been an Agent from before rule 6.
  const reactivating = typeof data.status === "string" && data.status !== "INACTIVE" && target.status === "INACTIVE" && !target.deletedAt;
  // This edit names a new manager itself: that one is checked below instead.
  // The manager they already have, sent again, is no new Reports to: the
  // reactivation's own check reads it (batch 6; before, it passed with
  // `live: false`, so the person came back under a deactivated manager).
  const managerInBody = body.managerId !== undefined && (data.managerId ?? null) !== (target.managerId ?? null);

  if (Object.keys(data).length === 0 && !profilePatch && !roleNext) return err(400, "Nothing to change");

  // A role change or a deactivation changes who can do what: the actor is
  // re-read from the database first (an Admin demoted a moment ago is
  // refused now, not at the five-minute session check).
  let fresh: Awaited<ReturnType<typeof freshWorkspaceActor>> | null = null;
  if (roleNext || deactivating) {
    fresh = await freshWorkspaceActor(await getServerSession(authOptions));
    if (!fresh.ok) return freshActorRefusal(fresh);
  }

  // ONE transaction under the workspace's role lock: the Owner guards, the
  // role change and the rest of the edit land together or not at all, and a
  // second admin racing this one waits for it and then re-reads. A refusal is
  // thrown (PatchRefused), never returned, so it rolls back whatever the
  // transaction wrote before it (batch 7: a reactivation that took off stale
  // dotted lines, then met a refused role change, committed the deletions
  // while the person stayed deactivated).
  type Outcome =
    | PatchRefusal
    | {
        ok: true;
        roleChange: AppliedRoleChange | null;
        user: { id: string; firstName: string; lastName: string; roleId: string | null; departmentId: string | null; officeId: string | null; managerId: string | null; status: string; accessLevel: string } | null;
        /** Lines a reactivation cleared (batch 5). */
        stale: { manager: StaleLine | null; dotted: StaleLine[] } | null;
        /** The reports a deactivation moved itself (batch 8). */
        endLines: AccountEndLines | null;
      };
  // A new Reports to takes the role lock too and is checked again under it
  // (rule 6's race, docs-found fixes batch 3): a role change making that
  // manager an Agent counts their reports under the same lock, so it either
  // waits for this edit and sees the report, or lands first and this sees
  // an Agent.
  const newManager = typeof data.managerId === "string" && data.managerId !== target.managerId ? data.managerId : null;
  // Clearing Reports to is a write of a reporting line too (batch 5): under
  // the lock, a handover's plan, read under it, is exactly what it moves.
  const lineWrite = data.managerId !== undefined;
  const refuse = (r: Omit<PatchRefusal, "ok">): never => {
    throw new PatchRefused({ ok: false, ...r });
  };
  const outcome: Outcome | NextResponse = await prisma.$transaction(async (tx): Promise<Outcome> => {
    if (roleNext || deactivating || lineWrite || reactivating) await lockOrgRoles(tx, ctx.organizationId);
    if (newManager) {
      // A new manager must be live too (docs-found fixes batch 4): a
      // deactivated person holds no reports (invariant 13), so a restore or
      // an acceptance would only clear the line again. The manager they
      // already have is no new manager (newManager is null for it).
      const again = await managerCandidateIn(ctx.organizationId, newManager, { db: tx, live: true });
      if (again === "agent_cannot_manage") return refuse({ status: 400, error: "An Agent can't be anyone's manager", code: "agent_cannot_manage", fields: ["managerId"] });
      if (again === "inactive") return refuse({ status: 400, error: "That person is deactivated, and a deactivated person can't have reports. Reactivate them first, or pick someone else.", code: "manager_inactive", fields: ["managerId"] });
      if (again !== "ok") return refuse({ status: 400, error: "That person isn't in this workspace", code: "manager_not_found", fields: ["managerId"] });
      // The loop check again, under the lock: two crossing edits checked
      // outside it could both pass and make a loop.
      if (await wouldLoopIn(ctx.organizationId, id, newManager, tx)) {
        return refuse({ status: 409, error: "That would make a reporting loop: this person already manages them, directly or further down.", code: "manager_cycle", fields: ["managerId"] });
      }
    }
    let stale: { manager: StaleLine | null; dotted: StaleLine[] } | null = null;
    if (reactivating) {
      // Bounded, after the role lock: a busy seat lock answers 503, never a 500.
      await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });
      const seats = await seatsFor(ctx.organizationId, 1, tx);
      if (!seats.ok) return refuse({ status: 403, error: seats.message, code: "seat_limit", fields: ["status"] });
      const found = await staleLinesOf(ctx.organizationId, id, tx);
      stale = { manager: managerInBody ? null : found.manager, dotted: found.dotted };
      if (stale.dotted.length) {
        await tx.userDottedLine.deleteMany({ where: { userId: id, managerId: { in: stale.dotted.map((d) => d.managerId) } } });
      }
    }
    if (deactivating) {
      // The gate again, under the role lock (batch 6): every write of a
      // reporting line takes it, so a Reports to naming this person that
      // landed after the first check is seen here. It counts every report
      // who works here (handoverReportCount) but those whose line another
      // workspace relies on, which this deactivation moves itself below
      // (batch 8), so a deactivated person is never left holding a report
      // who works here (invariant 13). A report who works only in another
      // workspace is that workspace's line: its own handover moves them.
      // Their open tasks and Spaces, Folders and Lists are counted again
      // here too (batch 9: batch 8 counted them once, before the lock, so a
      // task or a List given to them in between went with the account).
      if (target.status !== "INACTIVE" && holdsWork(await pendingHandover(ctx.organizationId, id, tx))) {
        return refuse({ status: 409, error: handoverFirstWords(canHandOver), code: "handover_first", fields: ["status"] });
      }
      if (await isLiveOwner(ctx.organizationId, id, tx)) {
        const actorOwner = fresh?.ok === true && fresh.admin && (await isLiveOwner(ctx.organizationId, ctx.userId, tx));
        if (!actorOwner) return refuse({ status: 403, error: "Only an Owner can deactivate an Owner.", code: "owner_only", fields: ["status"] });
      }
      if (await wouldRemoveLastOwner(ctx.organizationId, id, tx)) {
        return refuse({ status: 409, error: "This is the workspace's last Owner. Make someone else an Owner first.", code: "last_owner" });
      }
    }
    let rc: AppliedRoleChange | null = null;
    if (roleNext) {
      const r = await applyRoleChange(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorIsAdmin: fresh?.ok === true && fresh.admin,
        actorIsOwner: fresh?.ok === true && fresh.owner,
        targetId: id,
        next: roleNext,
      });
      // The planner names its refusal (an Agent with reports, or the last
      // Owner); every other refusal is a field this actor may not write.
      if (!r.ok) return refuse({ status: r.status, error: r.error, code: r.code ?? (r.status === 409 ? "last_owner" : "field_forbidden"), fields: ["orgRole"] });
      rc = r;
    }
    // The reports whose line another workspace relies on move now, with the
    // deactivation that ends the account in every workspace, never before it
    // (batch 8): after every refusal above, right before status is written,
    // in this transaction, so a refusal or a failure moves nothing. To the
    // person the handover gave the rest to (`handoverTo`), with that
    // workspace's record of each.
    const endLines =
      deactivating && target.status !== "INACTIVE"
        ? await moveReliedReportsAtEnd(tx, { organizationId: ctx.organizationId, leaverId: id, recipientId: handoverTo, actorId: ctx.userId, ends: "deactivated" })
        : null;
    const select = { id: true, firstName: true, lastName: true, roleId: true, departmentId: true, officeId: true, managerId: true, status: true, accessLevel: true } as const;
    const write = stale?.manager ? { ...data, managerId: null } : data;
    const u =
      Object.keys(write).length > 0
        ? await tx.user.update({ where: { id }, data: write as Prisma.UserUncheckedUpdateInput, select })
        : await tx.user.findUnique({ where: { id }, select });
    if (profilePatch) {
      const json = JSON.stringify(profilePatch.set);
      await tx.$executeRaw`
      UPDATE "User"
      SET "customFields" = ((CASE WHEN jsonb_typeof("customFields") = 'object' THEN "customFields" ELSE '{}'::jsonb END) - ${profilePatch.remove}::text[]) || ${json}::jsonb
      WHERE "id" = ${id} AND "organizationId" = ${ctx.organizationId}`;
    }
    return { ok: true, roleChange: rc, user: u, stale, endLines };
  }, LOCKED_TX).catch((e: unknown) => (e instanceof PatchRefused ? e.refusal : rolesBusyOrThrow(e)));
  if (outcome instanceof NextResponse) return outcome;
  if (!outcome.ok) return err(outcome.status, outcome.error, { code: outcome.code, ...(outcome.fields ? { fields: outcome.fields } : {}) });
  const roleChange = outcome.roleChange;
  const user = outcome.user;
  if (!user) return err(404, "User not found");
  // A deactivated person's Google stops serving their AI teammates here, and
  // Google is told (docs/plans/ai-teammates-phase3.md Decision 20), and their
  // teammates' browsers close (docs/plans/ai-teammates-phase4.md Decision 27).
  // After the commit, never failing the edit: the cron sweeps end any this misses.
  const endLines = outcome.endLines;
  if (deactivating) {
    await endTeammateAccessFor(ctx.organizationId, [id], "deactivated", ctx.userId).catch((e) => {
      console.error(`[connectors] deactivation hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
    });
    // Open reviews follow the reports the deactivation moved (batch 8).
    if (endLines) await followAccountEndLines(ctx.organizationId, endLines, ctx.userId);
  } else {
    // Reactivated: their skills with AI teammates here stop their 30 days
    // (docs/plans/ai-teammates-phase5.md Decision 14), after the commit,
    // never failing the edit; the sweep clears what this misses.
    if (reactivating) await skillsBackFor(ctx.organizationId, [id]);
    // Made an agent account here, which can hold no Google connection for AI
    // teammates (Decision 27): it ends now, after the commit, never failing
    // the edit (review of step 2). The one path the bulk role change takes
    // too (role-change-after.ts, docs-found fixes batch 5).
    await afterRoleChanges(ctx.organizationId, [{ userId: id, change: roleChange }], ctx.userId);
  }
  if (roleChange?.changed) {
    void logActivity({
      type: "org_role.changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: roleChangeSentence(roleChange.targetName, roleChange),
      targetId: id,
      targetType: "user",
      severity: "warning",
      oldValue: { role: roleChange.before.role, level: roleChange.before.level },
      newValue: { role: roleChange.after.role, level: roleChange.after.level },
      metadata: { tokenVersionBumped: roleChange.bumped },
    });
  }
  if (roleNext && Object.keys(data).length === 0 && !profilePatch) return NextResponse.json(user);

  // A reactivation that cleared lines says so, in the log and the answer,
  // and open reviews follow a cleared manager (as a restore does).
  const stale = outcome.stale;
  const name = `${user.firstName} ${user.lastName}`.trim();
  const cleared: StaleLine[] = stale ? [...(stale.manager ? [stale.manager] : []), ...stale.dotted] : [];
  for (const line of cleared) {
    const solid = line === stale?.manager;
    void logActivity({
      type: "reporting_line_changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: clearedLineSentence("Reactivated", name, line, solid),
      targetId: id,
      targetType: "user",
      oldValue: solid ? { managerId: line.managerId } : { dottedManagerId: line.managerId },
      newValue: solid ? { managerId: null } : { dottedManagerId: null },
      metadata: { onReactivate: true, reason: line.why },
    });
  }
  if (stale?.manager) {
    await followReportingLine(ctx.organizationId, [id], ctx.userId).catch((e: unknown) => console.error("followReportingLine failed", e));
  }
  const reactivationNote = cleared.length
    ? {
        linesCleared: cleared.map((l) => ({ managerId: l.managerId, kind: l === stale?.manager ? "manager" : "dotted", reason: l.why })),
        ...(stale?.manager ? { message: `${name} has been reactivated with no manager, because ${staleLineWords(stale.manager)}. Set who they report to in Members.` } : {}),
      }
    : {};

  if (data.status !== undefined) {
    void logActivity({
      type: "membership.changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `${deactivating ? "Deactivated" : "Changed the status of"} ${user.firstName} ${user.lastName}${endLines ? alsoElsewhereLogWords(endLines.reportsAlsoElsewhere.length, "deactivation") : ""}`,
      targetId: id,
      targetType: "user",
      severity: deactivating ? "warning" : "info",
      newValue: { status: data.status as string },
    });
  }
  // What the deactivation moved itself (batch 8), for the dialog's last word.
  const endNote = endLines && endLines.reportsMoved > 0 ? { reportsAlsoElsewhere: endLines.reportsAlsoElsewhere, reportsRehomed: endLines.reportsRehomed } : {};

  if (data.managerId !== undefined && data.managerId !== target.managerId) {
    // Open review cycles follow the new line: the former manager stops
    // writing this person's manager review on the next request.
    try {
      await followReportingLine(ctx.organizationId, [id], ctx.userId);
    } catch (e) {
      console.error("followReportingLine failed", e);
    }
    void logActivity({
      type: "reporting_line_changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `Changed who ${user.firstName} ${user.lastName} reports to`,
      targetId: id,
      targetType: "user",
      oldValue: { managerId: target.managerId },
      newValue: { managerId: (data.managerId as string | null) ?? null },
    });
  }

  // Moving into a (new) job title seeds its KRA and SOP defaults; best
  // effort, a seeding hiccup never fails the edit.
  if (data.roleId && data.roleId !== target.roleId) {
    try {
      await seedAlignmentForUser({ userId: id, roleId: data.roleId as string, organizationId: ctx.organizationId, assignedBy: ctx.userId });
    } catch (e) {
      console.error("seedAlignmentForUser failed", e);
    }
  }

  return NextResponse.json({ ...user, ...reactivationNote, ...endNote });
}

// DELETE: remove (soft) or restore a person.
/** A removal that ends no account elsewhere moves no other workspace's reports. */
const NO_END_LINES: AccountEndLines = { reportsMoved: 0, reportsReassigned: 0, reportsRehomed: [], reportsAlsoElsewhere: [], reportIds: [] };

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id } = await params;
  if (id === ctx.userId) return err(400, "You cannot remove yourself.");

  const user = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true, deletedAt: true, accessLevel: true },
  });
  if (!user) return err(404, "User not found");
  const relation = relationTo(ctx, id);
  const access = accessFor(ctx, relation, user);
  const restore = new URL(req.url).searchParams.get("restore") === "true";
  if (restore ? !access.restore : !access.remove) {
    return err(403, "You can only remove people in your reporting line.");
  }
  // An erased account is never brought back (see the header; review round 8
  // of Phase 3): a restore set deletedAt back to null.
  if (restore && (await isErasedAccount(prisma, id))) return err(409, ACCOUNT_ERASED.error, { code: ACCOUNT_ERASED.code });

  if (restore) {
    // A restored person takes a seat again (src/lib/seats.ts), checked and
    // taken under the workspace's lock.
    //
    // And comes back only under lines that still hold (docs-found fixes
    // batch 3). Removal keeps a person's manager and dotted lines, and while
    // they were gone that manager may have moved to the Agent tier (rule 6
    // never counted them: removed people are left out of reportCountOf), or
    // been deactivated, or left. Restored as stored, they would report to an
    // Agent again, who would read their people data and be their manager
    // reviewer. So the lines are checked again here (staleLinesOf), under
    // the role lock so a role change to Agent waits for this restore or is
    // seen by it, and what fails is cleared and logged. The role lock
    // first, then the seats, the order PATCH takes them in.
    type Restored = { refused: string } | { stale: Awaited<ReturnType<typeof staleLinesOf>> };
    const done: Restored | NextResponse = await prisma.$transaction(async (tx): Promise<Restored> => {
      await lockOrgRoles(tx, ctx.organizationId);
      // Bounded, after the role lock (batch 5): a busy seat lock answers the
      // same 503, never a 500 with the role lock still held.
      await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });
      const seats = await seatsFor(ctx.organizationId, 1, tx);
      if (!seats.ok) return { refused: seats.message };
      const stale = await staleLinesOf(ctx.organizationId, id, tx);
      await tx.user.update({ where: { id }, data: { deletedAt: null, status: "ACTIVE", ...(stale.manager ? { managerId: null } : {}) } });
      if (stale.dotted.length) {
        await tx.userDottedLine.deleteMany({ where: { userId: id, managerId: { in: stale.dotted.map((d) => d.managerId) } } });
      }
      return { stale };
    }, LOCKED_TX).catch(rolesBusyOrThrow);
    if (done instanceof NextResponse) return done;
    if ("refused" in done) return err(403, done.refused, { code: "seat_limit" });
    const name = `${user.firstName} ${user.lastName}`.trim();
    void logActivity({
      type: "user_restored",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `Restored ${name}`,
      targetId: id,
      targetType: "user",
    });
    const cleared: StaleLine[] = [...(done.stale.manager ? [done.stale.manager] : []), ...done.stale.dotted];
    for (const line of cleared) {
      const solid = line === done.stale.manager;
      void logActivity({
        type: "reporting_line_changed",
        actorId: ctx.userId,
        organizationId: ctx.organizationId,
        description: clearedLineSentence("Restored", name, line, solid),
        targetId: id,
        targetType: "user",
        oldValue: solid ? { managerId: line.managerId } : { dottedManagerId: line.managerId },
        newValue: solid ? { managerId: null } : { dottedManagerId: null },
        metadata: { onRestore: true, reason: line.why },
      });
    }
    if (done.stale.manager) {
      // Open review cycles follow the cleared line, as on any Reports to edit.
      await followReportingLine(ctx.organizationId, [id], ctx.userId).catch((e: unknown) => console.error("followReportingLine failed", e));
    }
    return NextResponse.json({
      message: done.stale.manager
        ? `${name} has been restored with no manager, because ${staleLineWords(done.stale.manager)}. Set who they report to in Members.`
        : `${name} has been restored`,
      linesCleared: cleared.map((l) => ({ managerId: l.managerId, kind: l === done.stale.manager ? "manager" : "dotted", reason: l.why })),
    });
  }

  // The handover comes first, as for a deactivation (invariant 13, batch 8):
  // a direct DELETE left the person's open tasks, reports and Spaces under a
  // removed account. The Remove dialogs run POST /api/users/[id]/handover
  // first; the reports whose line another workspace relies on are moved by
  // this removal itself, below, so they never hold it up.
  const canHandOver = mayHandOverPerson(ctx, id, user);
  const pending = await pendingHandover(ctx.organizationId, id);
  if (holdsWork(pending)) return err(409, handoverFirstWords(canHandOver), { code: "handover_first", pending });
  // Read only from someone who may hand this person's work over (batch 9);
  // from anyone else the reports this removal moves go up the person's line.
  const handoverTo = canHandOver ? new URL(req.url).searchParams.get("handoverTo") || null : null;

  // Removing someone who holds Admin changes who runs the workspace: the
  // actor is re-read from the database, and the guards and the write run
  // under the workspace's role lock so two admins removing each other can
  // never both pass.
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return freshActorRefusal(fresh);
  const removed = await prisma.$transaction(async (tx): Promise<NextResponse | { endLines: AccountEndLines; movedTo: string | null }> => {
    await lockOrgRoles(tx, ctx.organizationId);
    if (user.accessLevel === "COMPANY_ADMIN") {
      const admins = await tx.user.count({ where: { organizationId: ctx.organizationId, accessLevel: "COMPANY_ADMIN", deletedAt: null } });
      if (admins <= 1) return err(400, "This is the last Company Admin. Make someone else an Admin first.");
    }
    if (await isLiveOwner(ctx.organizationId, id, tx)) {
      const actorOwner = fresh.admin && (await isLiveOwner(ctx.organizationId, ctx.userId, tx));
      if (!actorOwner) return err(403, "Only an Owner can remove an Owner.", { code: "owner_only" });
    }
    if (await wouldRemoveLastOwner(ctx.organizationId, id, tx)) {
      return err(409, "This is the workspace's last Owner. Make someone else an Owner first.", { code: "last_owner" });
    }
    // The whole gate again, under the role lock, as PATCH's deactivation
    // reads it: reports, open tasks and Spaces, Folders and Lists (batch 9).
    if (holdsWork(await pendingHandover(ctx.organizationId, id, tx))) {
      return err(409, handoverFirstWords(canHandOver), { code: "handover_first" });
    }
    // AN ACCOUNT THAT ALSO BELONGS ELSEWHERE IS NOT ENDED, IT LEAVES (launch
    // audit, 2026-10-31). The anchor is only where the person last was, and
    // status lives on the account, so this removal ended their account in
    // every workspace: an Owner of their own company who last switched in
    // here lost it. It moves to that workspace instead (homeAfterRemoval,
    // the company-delete rule), loses this workspace's membership, and its
    // sessions end once so the next one is the other workspace's. Their
    // lines there hold, so nothing is moved there.
    const home = await homeAfterRemoval(id, ctx.organizationId, tx);
    if (home) {
      await reanchorUser({ userId: id, to: home }, tx);
      await tx.organizationMembership.deleteMany({ where: { userId: id, organizationId: ctx.organizationId } });
      await tx.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
      return { endLines: NO_END_LINES, movedTo: home.organizationId };
    }
    // The reports whose line another workspace relies on move now, with the
    // removal that ends the account there too, never before it (batch 8):
    // after every refusal above, right before deletedAt is written.
    const endLines = await moveReliedReportsAtEnd(tx, { organizationId: ctx.organizationId, leaverId: id, recipientId: handoverTo, actorId: ctx.userId, ends: "removed" });
    // tokenVersion: a removed person's open sessions end on their next check.
    // Only where deletedAt is still null (review round 9 of Phase 3): the
    // read above can be stale, and an account removed or erased since then
    // keeps its deletedAt. Before, a removal racing the person's own erasure
    // moved deletedAt off the erasure's moment, so the account left the
    // erased state and its words were never blanked. Removed already: the
    // lines moved above roll back (thrown), nothing is written.
    const n = await tx.user.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), status: "INACTIVE", tokenVersion: { increment: 1 } } });
    if (n.count === 0) throw new AlreadyRemoved();
    return { endLines, movedTo: null };
  }, LOCKED_TX).catch((e: unknown) => (e instanceof AlreadyRemoved ? ("already" as const) : rolesBusyOrThrow(e)));
  // Removed already: a harmless success, nothing written or logged again.
  if (removed === "already") return NextResponse.json({ message: `${user.firstName} ${user.lastName} has been removed` });
  if (removed instanceof NextResponse) return removed;
  const { endLines, movedTo } = removed;
  await followAccountEndLines(ctx.organizationId, endLines, ctx.userId);
  // A removed person's Google stops serving their AI teammates, and Google is
  // told (Decision 20), and their teammates' browsers close (Phase 4 Decision
  // 27); the cron sweeps end any this misses.
  await endTeammateAccessFor(ctx.organizationId, [id], "left", ctx.userId).catch((e) => {
    console.error(`[connectors] removal hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });
  void logActivity({
    type: "user_removed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: movedTo
      ? `Removed ${user.firstName} ${user.lastName} from this workspace; their account stays in another workspace they belong to`
      : `Removed ${user.firstName} ${user.lastName} from organization${alsoElsewhereLogWords(endLines.reportsAlsoElsewhere.length, "removal")}`,
    targetId: id,
    targetType: "user",
    ...(movedTo ? { metadata: { accountKept: true } } : {}),
  });
  return NextResponse.json({
    message: movedTo
      ? `${user.firstName} ${user.lastName} has been removed from this workspace. Their account stays in another workspace they belong to.`
      : `${user.firstName} ${user.lastName} has been removed`,
    ...(movedTo ? { accountKept: true } : {}),
    // What the removal moved itself (batch 8), for the dialog's last word.
    ...(endLines.reportsMoved > 0 ? { reportsAlsoElsewhere: endLines.reportsAlsoElsewhere, reportsRehomed: endLines.reportsRehomed } : {}),
  });
}
