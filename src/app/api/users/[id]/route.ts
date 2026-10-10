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
//           the org's own.
//   DELETE  remove (soft) or ?restore=true, unchanged gate: Admins, and the
//           manager tier over their own chain.
//
// An account its own person erased (POST /api/me/delete) is never restored
// or edited here: 409 `account_erased` (review round 8 of Phase 3). Before, a
// restore set deletedAt back to null and an edit could name the "Deleted
// User" again, and the erasure sweep then never recognised the account, so
// their AI teammates' words stayed for good. Only a deactivation, and a
// removal, still go through: switching someone off is never refused.
//
// The legacy Task table (dead since Phase 2) and the check-ins no writer
// ever fed are no longer read here.

import { NextResponse, type NextRequest } from "next/server";
import { accessV2Resolver } from "@/lib/access/flags";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { followReportingLine } from "@/lib/performance/review-cycle.server";
import { getLatestScore, getScoreHistory } from "@/services/performanceScoreService";
import { seedAlignmentForUser } from "@/lib/alignment-assign";
import {
  checkManagerCandidate,
  managerMapFor,
  peopleCtx,
  relationTo,
  type PeopleCtx,
} from "@/lib/people/person-access.server";
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
import { pendingHandover } from "@/lib/people/handover.server";
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
import { freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { endConnectionsFor } from "@/lib/connectors/connections";
import { ACCOUNT_ERASED, isErasedAccount } from "@/lib/compliance/erased-account";

/** The AccessLevel enum's values (a bad value is a 400, never a Prisma 500). */
const ACCESS_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"] as const;

const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

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
  const subjectIsAdmin = subject.accessLevel === "COMPANY_ADMIN" || subject.accessLevel === "SUPER_ADMIN";
  // Acting on a person (remove, photo, alignment, ratings, tags, dotted
  // lines) is yesterday's write door: self, Admin, the People team, the
  // org-wide levels, or a manager-tier viewer over their SOLID tree. A
  // dotted-line manager, or a report's manager below manager tier
  // (chain-view), reads the record and acts on nothing.
  const writes = relation !== "none" && relation !== "chain-view";
  const canRemove =
    relation !== "self" &&
    (ctx.isAdmin || (ctx.managerTier && writes && !subjectIsAdmin));
  const peopleData = relation !== "none";
  return {
    relation,
    peopleData,
    editable,
    remove: canRemove && !subject.deletedAt,
    restore: canRemove && !!subject.deletedAt,
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
    manager: card.manager,
    dottedManagers: card.dottedLineToManagers.map((d) => d.manager).filter((m) => !m.deletedAt),
    directReports: isGuest ? [] : card.directReports,
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
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return err(400, "Send a JSON object");
    body = raw as Record<string, unknown>;
  } catch {
    return err(400, "Send a JSON object");
  }

  const target = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, accessLevel: true, roleId: true, managerId: true, deletedAt: true, status: true },
  });
  if (!target) return err(404, "User not found");

  const relation = relationTo(ctx, id);
  if (relation === "none") return err(403, "You can only edit your own record or your reports'.");
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
    if (next) {
      const candidate = await checkManagerCandidate(ctx.organizationId, next);
      if (candidate === "not_found") return err(400, "That person isn't in this workspace", { field: "managerId" });
      if (candidate === "agent_cannot_manage") return err(400, "An Agent can't be anyone's manager", { code: "agent_cannot_manage", field: "managerId" });
      const managers = await managerMapFor(ctx.organizationId);
      if (wouldCreateCycle(id, next, managers)) {
        return err(409, "That would make a reporting loop: this person already manages them, directly or further down.", { code: "manager_cycle", field: "managerId" });
      }
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
    // The handover comes first, on every path (invariant 13): a leaver's
    // open tasks, reports and containers are never orphaned by a direct API
    // call. The Members transfer dialog and the Remove dialog run POST
    // /api/users/[id]/handover before this PATCH, which empties all three.
    if (target.status !== "INACTIVE") {
      const left = await pendingHandover(ctx.organizationId, id);
      if (left.openTasks + left.directReports + left.containers > 0) {
        return err(409, "Hand over their work first: they still own open tasks, direct reports or Spaces, Folders and Lists.", { code: "handover_first", fields: ["status"], pending: left });
      }
    }
    data.tokenVersion = { increment: 1 };
  }

  // Reactivating takes a seat again (src/lib/seats.ts): a deactivated person
  // does not count against the plan, an active one does.
  const reactivating = typeof data.status === "string" && data.status !== "INACTIVE" && target.status === "INACTIVE" && !target.deletedAt;

  if (Object.keys(data).length === 0 && !profilePatch && !roleNext) return err(400, "Nothing to change");

  // A role change or a deactivation changes who can do what: the actor is
  // re-read from the database first (an Admin demoted a moment ago is
  // refused now, not at the five-minute session check).
  let fresh: Awaited<ReturnType<typeof freshWorkspaceActor>> | null = null;
  if (roleNext || deactivating) {
    fresh = await freshWorkspaceActor(await getServerSession(authOptions));
    if (!fresh.ok) return err(fresh.status, fresh.error, { code: fresh.code });
  }

  // ONE transaction under the workspace's role lock: the Owner guards, the
  // role change and the rest of the edit land together or not at all, and a
  // second admin racing this one waits for it and then re-reads.
  type Outcome =
    | { ok: false; status: 400 | 403 | 404 | 409; error: string; code: string; fields?: string[] }
    | { ok: true; roleChange: AppliedRoleChange | null; user: { id: string; firstName: string; lastName: string; roleId: string | null; departmentId: string | null; officeId: string | null; managerId: string | null; status: string; accessLevel: string } | null };
  const outcome: Outcome = await prisma.$transaction(async (tx) => {
    if (roleNext || deactivating) await lockOrgRoles(tx, ctx.organizationId);
    if (reactivating) {
      await lockWorkspaceSeats(tx, ctx.organizationId);
      const seats = await seatsFor(ctx.organizationId, 1, tx);
      if (!seats.ok) return { ok: false, status: 403, error: seats.message, code: "seat_limit", fields: ["status"] };
    }
    if (deactivating) {
      if (await isLiveOwner(ctx.organizationId, id, tx)) {
        const actorOwner = fresh?.ok === true && fresh.admin && (await isLiveOwner(ctx.organizationId, ctx.userId, tx));
        if (!actorOwner) return { ok: false, status: 403, error: "Only an Owner can deactivate an Owner.", code: "owner_only", fields: ["status"] };
      }
      if (await wouldRemoveLastOwner(ctx.organizationId, id, tx)) {
        return { ok: false, status: 409, error: "This is the workspace's last Owner. Make someone else an Owner first.", code: "last_owner" };
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
      if (!r.ok) return { ok: false, status: r.status, error: r.error, code: r.status === 409 ? "last_owner" : "field_forbidden", fields: ["orgRole"] };
      rc = r;
    }
    const select = { id: true, firstName: true, lastName: true, roleId: true, departmentId: true, officeId: true, managerId: true, status: true, accessLevel: true } as const;
    const u =
      Object.keys(data).length > 0
        ? await tx.user.update({ where: { id }, data: data as Prisma.UserUncheckedUpdateInput, select })
        : await tx.user.findUnique({ where: { id }, select });
    if (profilePatch) {
      const json = JSON.stringify(profilePatch.set);
      await tx.$executeRaw`
      UPDATE "User"
      SET "customFields" = ((CASE WHEN jsonb_typeof("customFields") = 'object' THEN "customFields" ELSE '{}'::jsonb END) - ${profilePatch.remove}::text[]) || ${json}::jsonb
      WHERE "id" = ${id} AND "organizationId" = ${ctx.organizationId}`;
    }
    return { ok: true, roleChange: rc, user: u };
  });
  if (!outcome.ok) return err(outcome.status, outcome.error, { code: outcome.code, ...(outcome.fields ? { fields: outcome.fields } : {}) });
  const roleChange = outcome.roleChange;
  const user = outcome.user;
  if (!user) return err(404, "User not found");
  // A deactivated person's Google stops serving their AI teammates here, and
  // Google is told (docs/plans/ai-teammates-phase3.md Decision 20). After the
  // commit, never failing the edit: the cron sweep ends any this misses.
  if (deactivating) {
    await endConnectionsFor(ctx.organizationId, [id], "deactivated", ctx.userId).catch((e) => {
      console.error(`[connectors] deactivation hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
    });
  } else if (roleChange?.changed && roleChange.after.level === "AGENT") {
    // Made an agent account here, which can hold no Google connection for AI
    // teammates (Decision 27): it ends now, after the commit, never failing
    // the edit (review of step 2). This route's roles are Owner, Admin and
    // Member, so no Guest is made here; a Guest written elsewhere (the Guest
    // invitation's orgRole) is ended by the cron sweep (connections.ts
    // sweepConnections, no_access).
    await endConnectionsFor(ctx.organizationId, [id], "no_access", ctx.userId).catch((e) => {
      console.error(`[connectors] role change hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
    });
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

  if (data.status !== undefined) {
    void logActivity({
      type: "membership.changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `${deactivating ? "Deactivated" : "Changed the status of"} ${user.firstName} ${user.lastName}`,
      targetId: id,
      targetType: "user",
      severity: deactivating ? "warning" : "info",
      newValue: { status: data.status as string },
    });
  }

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

  return NextResponse.json(user);
}

// DELETE: remove (soft) or restore a person.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
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
    const refused = await prisma.$transaction(async (tx) => {
      await lockWorkspaceSeats(tx, ctx.organizationId);
      const seats = await seatsFor(ctx.organizationId, 1, tx);
      if (!seats.ok) return seats.message;
      await tx.user.update({ where: { id }, data: { deletedAt: null, status: "ACTIVE" } });
      return null;
    });
    if (refused) return err(403, refused, { code: "seat_limit" });
    void logActivity({
      type: "user_restored",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `Restored ${user.firstName} ${user.lastName}`,
      targetId: id,
      targetType: "user",
    });
    return NextResponse.json({ message: `${user.firstName} ${user.lastName} has been restored` });
  }

  // Removing someone who holds Admin changes who runs the workspace: the
  // actor is re-read from the database, and the guards and the write run
  // under the workspace's role lock so two admins removing each other can
  // never both pass.
  const fresh = await freshWorkspaceActor(await getServerSession(authOptions));
  if (!fresh.ok) return err(fresh.status, fresh.error, { code: fresh.code });
  const removed = await prisma.$transaction(async (tx) => {
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
    // tokenVersion: a removed person's open sessions end on their next check.
    await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE", tokenVersion: { increment: 1 } } });
    return null;
  });
  if (removed) return removed;
  // A removed person's Google stops serving their AI teammates, and Google is
  // told (Decision 20); the cron sweep ends any this misses.
  await endConnectionsFor(ctx.organizationId, [id], "left", ctx.userId).catch((e) => {
    console.error(`[connectors] removal hook failed: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`);
  });
  void logActivity({
    type: "user_removed",
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
    description: `Removed ${user.firstName} ${user.lastName} from organization`,
    targetId: id,
    targetType: "user",
  });
  return NextResponse.json({ message: `${user.firstName} ${user.lastName} has been removed` });
}
