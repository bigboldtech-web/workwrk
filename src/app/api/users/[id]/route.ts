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
// The legacy Task table (dead since Phase 2) and the check-ins no writer
// ever fed are no longer read here.

import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
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
import { presenceFor } from "@/lib/people/directory-list.server";
import { getScoringBands } from "@/lib/review-cadence";
import { scoreBand } from "@/lib/people/score-band";
import { subjectRowView } from "@/lib/people/review-visibility";
import { profileFieldRows, readProfileFieldDefs, validateProfileValues } from "@/lib/people/profile-fields";
import { effectivePersonSchedule, nominalWeekHours, readPersonScheduleOverride, validatePersonScheduleOverride } from "@/lib/work-schedule";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";

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
  const opts = { managerTierSelf: relation === "self" && ctx.managerTier };
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
    select: { id: true, accessLevel: true, roleId: true, managerId: true, deletedAt: true },
  });
  if (!target) return err(404, "User not found");

  const relation = relationTo(ctx, id);
  if (relation === "none") return err(403, "You can only edit your own record or your reports'.");
  const opts = { managerTierSelf: relation === "self" && ctx.managerTier };
  const { unknown, forbidden } = checkPersonPatch(body, relation, opts);
  if (unknown.length) return err(400, `Unknown field: ${unknown.join(", ")}`, { code: "unknown_field", fields: unknown });
  if (forbidden.length) {
    const words = forbidden.map((f) => PERSON_FIELD_LABEL[f] ?? f).join(", ");
    return err(403, relation === "self" ? `Ask your manager or the People team to change: ${words}` : `You can't change: ${words}`, {
      code: "field_forbidden",
      fields: forbidden,
    });
  }

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

  if (body.accessLevel !== undefined) {
    if (typeof body.accessLevel !== "string" || !(ACCESS_LEVELS as readonly string[]).includes(body.accessLevel)) {
      return err(400, "Unknown access level", { field: "accessLevel" });
    }
    if (target.accessLevel === "COMPANY_ADMIN" && body.accessLevel !== "COMPANY_ADMIN") {
      const adminCount = await prisma.user.count({ where: { organizationId: ctx.organizationId, accessLevel: "COMPANY_ADMIN", deletedAt: null } });
      if (adminCount <= 1) return err(400, "Cannot demote the last Company Admin. Promote another user first.");
    }
    if (body.accessLevel === "SUPER_ADMIN" && ctx.accessLevel !== "SUPER_ADMIN") return err(403, "Only WorkwrK staff grant Super Admin.", { code: "field_forbidden", fields: ["accessLevel"] });
    data.accessLevel = body.accessLevel;
  }

  if (Object.keys(data).length === 0 && !profilePatch) return err(400, "Nothing to change");

  const user = await prisma.user.update({
    where: { id },
    data: data as Prisma.UserUncheckedUpdateInput,
    select: { id: true, firstName: true, lastName: true, roleId: true, departmentId: true, officeId: true, managerId: true, status: true, accessLevel: true },
  });
  if (profilePatch) {
    const json = JSON.stringify(profilePatch.set);
    await prisma.$executeRaw`
      UPDATE "User"
      SET "customFields" = ((CASE WHEN jsonb_typeof("customFields") = 'object' THEN "customFields" ELSE '{}'::jsonb END) - ${profilePatch.remove}::text[]) || ${json}::jsonb
      WHERE "id" = ${id} AND "organizationId" = ${ctx.organizationId}`;
  }

  if (data.managerId !== undefined && data.managerId !== target.managerId) {
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

  if (restore) {
    await prisma.user.update({ where: { id }, data: { deletedAt: null, status: "ACTIVE" } });
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

  if (user.accessLevel === "COMPANY_ADMIN") {
    const admins = await prisma.user.count({ where: { organizationId: ctx.organizationId, accessLevel: "COMPANY_ADMIN", deletedAt: null } });
    if (admins <= 1) return err(400, "This is the last Company Admin. Make someone else an Admin first.");
  }

  await prisma.user.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
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
