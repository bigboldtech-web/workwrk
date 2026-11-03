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
// A PERSON'S STATUS IN EACH WORKSPACE (docs/plans/workspace-status.md, step
// 3). Everyone who belongs here is acted on here: someone anchored here, and
// someone who works here through a membership (D11), each at THIS
// workspace's seat (acting-workspace.ts personSeatIn: the level, the status
// and the removal held here). A deactivation and a removal end that seat
// only (workspace-status.ts endSeat): someone anchored here with a usable
// seat elsewhere moves there in the same transaction (D3), someone with
// nowhere else ends as before, signed out (D4), and a membership ends alone
// (D5). Their other workspaces are not affected, and no other tokenVersion is
// bumped. A reactivation and a restore bring the seat back through
// restoreSeat (D6), under the same seat check; its refusals are plain
// sentences. The API keys they made here are revoked with the seat (D15).
// For someone who works here through a membership only the role and the
// status are this workspace's: their profile (name, manager, department, job
// title and the rest) is the account's, kept by the workspace it belongs to,
// so any other field is refused with one sentence (PROFILE_ELSEWHERE), and
// the record answers identity, role and status only.
//
// When the end of the seat ends the account too (D4), the reports whose line
// another workspace relies on, which the handover leaves while the account
// is live, move HERE, in the same role-locked transaction, right before the
// seat is ended (docs-found fixes batch 8; handover.server.ts
// moveReliedReportsAtEnd), to the person the dialog picked (`handoverTo`, in
// PATCH's body or DELETE's query), with that workspace's record of each.
// When the person still works elsewhere (D3, D5) they stay: that workspace's
// line is its own (endSeatWould says which, under the same lock).
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
import { levelsHeldIn, personSeatIn, type PersonSeat } from "@/lib/access/acting-workspace";
import { MEMBERSHIP_PROFILE_SELECT, ownHere, placementsHere, seatPlacementsHere } from "@/lib/access/profile-here";
import { ratingHere } from "@/lib/people/skill-ratings";
import { SEAT_PLAN_CHANGED_WORDS, SeatPlanChanged, endSeat, endSeatWould, restoreSeat, type EndSeatResult, type RestoreSeatResult } from "@/lib/access/workspace-status";
import { lockPerson } from "@/lib/access/workspace-anchor";
import { identityShared, SHARED_IDENTITY_REFUSAL, SHARED_PERSON_FIELDS } from "@/lib/access/shared-identity";
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
  PATCHABLE_PERSON_FIELDS,
  PROFILE_ELSEWHERE,
  SEAT_FIELDS,
  canWritePersonField,
  checkPersonPatch,
  dobOverwriteAllowed,
  seesFullBirthday,
  visibleStatus,
  type PersonRelation,
} from "@/lib/people/person-fields";
import { wouldCreateCycle } from "@/lib/people/reporting-lines";
import { followAccountEndLines, moveReliedReportsAtEnd, pendingHandover, type AccountEndLines } from "@/lib/people/handover.server";
import { presenceFor } from "@/lib/people/directory-list.server";
import { getScoringBands } from "@/lib/review-cadence";
import { scoreBand } from "@/lib/people/score-band";
import { subjectRowView } from "@/lib/people/review-visibility";
import { profileFieldRows, readProfileFieldDefs, validateProfileValues } from "@/lib/people/profile-fields";
import { effectivePersonSchedule, nominalWeekHours, readPersonScheduleOverride, validatePersonScheduleOverride } from "@/lib/work-schedule";
import { readOrgWorkSchedule } from "@/lib/work-schedule-server";
import { applyRoleChange, isLiveOwner, liveCompanyAdminCount, lockOrgRoles, roleChangeSentence, wouldRemoveLastOwner, type AppliedRoleChange, type MemberRole } from "@/lib/access/membership";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { freshActorRefusal, freshWorkspaceActor } from "@/lib/access/workspace-admin";
import { lockWorkspaceSeats, seatsFor } from "@/lib/seats";
import { JOIN_ROW_SELECT, joinedHere } from "@/lib/access/joined-here";
import { endTeammateAccessFor } from "@/lib/agents/leaver-hooks";
import { skillsBackFor } from "@/lib/skills/store";
import { ACCOUNT_ERASED, isErasedAccount } from "@/lib/compliance/erased-account";
import { clearedLineSentence, managerCandidateIn, staleLineWords, staleLinesOf, wouldLoopIn, type StaleLine } from "@/lib/access/manager-candidate";
import { rolesBusyOrThrow } from "@/lib/access/roles-busy";
import { LOCKED_TX } from "@/lib/access/org-roles-busy";
import { afterRoleChanges } from "@/lib/access/role-change-after";

/** The statuses PATCH writes (UserStatus). */
const STATUSES = ["ACTIVE", "INACTIVE", "ON_LEAVE", "PROBATION", "PIP", "NOTICE_PERIOD"] as const;
type UserStatusValue = (typeof STATUSES)[number];

/** The AccessLevel enum's values (a bad value is a 400, never a Prisma 500). */
const ACCESS_LEVELS = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "MANAGER", "TEAM_LEAD", "EMPLOYEE", "AGENT", "HR"] as const;

const err = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

/**
 * The person as PATCH answers them, at the seat they hold here. For someone
 * who works here through a membership (D11), identity, status and level
 * only: their profile is not this workspace's to send.
 */
type PatchUser =
  | { id: string; firstName: string; lastName: string; roleId: string | null; departmentId: string | null; officeId: string | null; managerId: string | null; status: string; accessLevel: string }
  | { id: string; firstName: string; lastName: string; status: string; accessLevel: string; profileHere: false };

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

/**
 * The person of this workspace this route acts on (D11): their account row
 * with `accessLevel`, `status` and `deletedAt` read from the seat they hold
 * here (personSeatIn), so every gate below reads this workspace's answer.
 * `profileHere` is false for someone who works here through a membership.
 * Null when they hold no seat here, a removed one included.
 */
async function personHere(organizationId: string, id: string) {
  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, roleId: true, managerId: true, organizationId: true, accessLevel: true, status: true, deletedAt: true, adminScopes: true },
  });
  if (!row) return null;
  const seat = await personSeatIn(organizationId, id, prisma, row);
  if (!seat) return null;
  return { ...row, accessLevel: seat.level, status: seat.status, deletedAt: seat.removedAt, seat, profileHere: seat.kind === "anchor" };
}

/**
 * restoreSeat's refusal as a plain sentence (step 3), or null when it
 * restored. `duplicate` names the other account to an Admin only.
 */
async function restoreRefusal(
  r: RestoreSeatResult,
  kind: "reactivated" | "restored",
  viewerIsAdmin: boolean,
): Promise<{ status: 404 | 409; error: string; code: string } | null> {
  switch (r.outcome) {
    case "restored":
      return null;
    case "erased":
      return { status: 409, error: ACCOUNT_ERASED.error, code: ACCOUNT_ERASED.code };
    case "removed":
      return { status: 409, error: "They were removed from this workspace. Restore them first.", code: "removed" };
    case "not_ended":
      return kind === "restored"
        ? { status: 409, error: "They are not removed from this workspace, so there is nothing to restore.", code: "not_ended" }
        : { status: 409, error: "They are not deactivated here, so there is nothing to reactivate.", code: "not_ended" };
    case "duplicate": {
      const other = viewerIsAdmin ? await prisma.user.findUnique({ where: { id: r.otherAccountId }, select: { firstName: true, lastName: true, email: true } }) : null;
      const who = other ? `${`${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || other.email} (${other.email})` : null;
      return {
        status: 409,
        error: who
          ? `Another account with this address is already active here: ${who}. The two accounts need to be merged first.`
          : "Another account with this address is already active here.",
        code: "duplicate_account",
      };
    }
    case "not_here":
      return { status: 404, error: "User not found", code: "not_found" };
  }
}

/** What the audit row says the end of a seat did (step 3): which seat, and whether and where the account moved. */
function endedMetadata(seat: PersonSeat, ended: EndSeatResult | null) {
  if (!ended) return { seat: seat.kind };
  // That the account moved, never where: another workspace's id stays out of
  // this workspace's log (batch 7's rule; the step 3 review L5).
  return {
    seat: seat.kind,
    outcome: ended.outcome,
    accountMoved: ended.outcome === "moved",
    ...("apiKeysRevoked" in ended ? { apiKeysRevoked: ended.apiKeysRevoked } : {}),
  };
}

/** The answer when the seat changed between PATCH's first read and its write (the step 3 review M1). */
const SEAT_CHANGED_WORDS = "Their status here changed a moment ago, so nothing was saved. Reload and try again.";

/** Whether two reads of a seat here are the same seat, in the same state. */
function sameSeat(a: PersonSeat, b: PersonSeat | null): boolean {
  return !!b && a.kind === b.kind && a.status === b.status && (a.removedAt?.getTime() ?? null) === (b.removedAt?.getTime() ?? null);
}

/** A removal that leaves the account working elsewhere (D3, D5) moves no line itself. */
const NOTHING_MOVED: AccountEndLines = { reportsMoved: 0, reportsReassigned: 0, reportsRehomed: [], reportsAlsoElsewhere: [], reportIds: [] };

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
  profileHere = true,
) {
  // Someone who works here through a membership (D11): this workspace holds
  // their role and status only. Their profile and people data are the
  // account's, so nothing of them is read or written here; Remove, Restore,
  // the handover and Members (role, status) stay under the same gates.
  if (!profileHere) {
    const canRemove = mayRemovePerson(ctx, relation, subject);
    return {
      relation,
      peopleData: false,
      editable: [] as string[],
      remove: canRemove && !subject.deletedAt,
      restore: canRemove && !!subject.deletedAt,
      handover: !subject.deletedAt && mayHandOverPerson(ctx, subject.id, subject),
      avatar: false,
      manageAlignment: false,
      rateSkills: false,
      addSkills: false,
      removeSkills: false,
      tags: false,
      dottedLines: false,
      manageMembers: ctx.isAdmin,
      fullBirthday: false,
      profileHere: false,
    };
  }
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
    profileHere: true,
  };
}

/** A direct report as a record lists them: with where they are anchored and the placement ids the account holds. */
const REPORT_SELECT = { id: true, firstName: true, lastName: true, avatar: true, organizationId: true, roleId: true, departmentId: true } as const;
type ReportRow = Prisma.UserGetPayload<{ select: typeof REPORT_SELECT }>;

/**
 * Each report's job title and department as THIS workspace holds them (the
 * final review, security M1; D18): the account's own for someone anchored
 * here, the membership's here for someone who works here through one, each
 * only when it is one of this workspace's own rows. Before, a membership
 * report's title and department were the account's, which are the
 * workspace it is anchored to, today: every Member here read another
 * company's HR placement on their manager's record.
 */
async function reportsShownHere(organizationId: string, reports: readonly ReportRow[]) {
  const held = await seatPlacementsHere(organizationId, reports);
  const placed = await placementsHere(organizationId, [...held.values()]);
  return reports.map((r) => {
    const h = held.get(r.id);
    const role = h?.roleId ? placed.role.get(h.roleId) : undefined;
    const dept = h?.departmentId ? placed.department.get(h.departmentId) : undefined;
    return { id: r.id, firstName: r.firstName, lastName: r.lastName, avatar: r.avatar, role: role ? { id: role.id, title: role.title } : null, department: dept ? { id: dept.id, name: dept.name } : null };
  });
}

/**
 * The kudos a record lists: this workspace's only (D18), with their
 * reactions as this viewer sees them, and their count when asked (the
 * anchored record counts them with its own read). Guests get none.
 */
async function kudosHere(ctx: PeopleCtx, id: string, opts: { count?: boolean } = {}) {
  if (ctx.orgRole === "GUEST") return { count: 0, rows: [] };
  const [count, received] = await Promise.all([
    opts.count ? prisma.kudos.count({ where: { receiverId: id, organizationId: ctx.organizationId } }) : Promise.resolve(0),
    prisma.kudos.findMany({
      where: { receiverId: id, organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        giver: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        reactions: { select: { emoji: true, userId: true } },
      },
    }),
  ]);
  const rows = received.map((k) => {
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
  return { count, rows };
}

/**
 * The record of someone who works here through a membership (D11), agreeing
 * with the Directory and Members (the final review, product H1 and M3):
 * identity (name, email, photo), the role and the status they hold HERE,
 * the job title, department and office their membership here holds
 * (resolved to this workspace's own rows; never the account's, which are
 * the workspace it is anchored to), their join date here (the membership's,
 * else when they joined here), the manager they report to when that
 * manager holds a seat here, their reports here, the kudos given here, and
 * what this viewer may do. No people data (phone, birthday, KPIs, reviews,
 * skills): this workspace holds none of theirs yet. `profileHere: false`,
 * so the page says once why the rest is read-only.
 */
async function membershipRecord(ctx: PeopleCtx, relation: PersonRelation, id: string, seat: PersonSeat) {
  const [who, joined] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true, firstName: true, lastName: true, email: true, avatar: true, createdAt: true,
        manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        directReports: { where: { deletedAt: null }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: REPORT_SELECT },
      },
    }),
    prisma.organizationMembership.findUnique({ where: { userId_organizationId: { userId: id, organizationId: ctx.organizationId } }, select: { ...JOIN_ROW_SELECT, ...MEMBERSHIP_PROFILE_SELECT } }),
  ]);
  if (!who) return err(404, "User not found");
  const access = accessFor(ctx, relation, { id, deletedAt: seat.removedAt, accessLevel: seat.level }, false, false);
  const isGuest = ctx.orgRole === "GUEST";
  const [placed, here, kudos] = await Promise.all([
    placementsHere(ctx.organizationId, joined ? [joined] : []),
    // Kept seats, as the anchored record names them (step 1 review M2).
    levelsHeldIn(ctx.organizationId, [...(who.manager ? [who.manager.id] : []), ...who.directReports.map((r) => r.id)], prisma, { keptSeats: true }),
    kudosHere(ctx, id, { count: true }),
  ]);
  const role = joined?.roleId ? placed.role.get(joined.roleId) ?? null : null;
  const reports = isGuest ? [] : await reportsShownHere(ctx.organizationId, who.directReports.filter((r) => here.has(r.id)));
  const { createdAt: _made, manager, directReports: _all, ...identity } = who;
  void _made;
  void _all;
  return NextResponse.json(
    {
      ...identity,
      status: visibleStatus(seat.status, ctx.isAdmin || ctx.peopleTeam || relation === "self"),
      isDeactivated: seat.status === "INACTIVE",
      // Their join date here: the membership's, else when they joined here
      // (access/joined-here.ts, the step 4 review H1), as the Directory says.
      joinDate: joined ? joined.joinDate ?? joinedHere(joined, who) : null,
      deletedAt: seat.removedAt,
      isAgent: seat.level === "AGENT",
      role: role ? { id: role.id, title: role.title, description: role.description, seniority: role.level } : null,
      department: joined?.departmentId ? placed.department.get(joined.departmentId) ?? null : null,
      office: joined?.officeId ? placed.office.get(joined.officeId) ?? null : null,
      manager: manager && here.has(manager.id) ? manager : null,
      managerElsewhere: false,
      dottedManagers: [],
      dottedElsewhere: 0,
      directReports: reports,
      presenceStatus: null,
      presenceUntil: null,
      skills: [],
      kudosCount: kudos.count,
      kudosReceived: kudos.rows,
      access,
      minimal: true,
      profileHere: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
      // With their workspace, so only this workspace's own are shown (D18).
      role: { select: { id: true, title: true, description: true, level: true, organizationId: true } },
      department: { select: { id: true, name: true, color: true, organizationId: true } },
      office: { select: { id: true, name: true, city: true, country: true, isHeadquarters: true, organizationId: true } },
      manager: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      dottedLineToManagers: {
        select: { manager: { select: { id: true, firstName: true, lastName: true, avatar: true, deletedAt: true } } },
      },
      directReports: {
        where: { deletedAt: null },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        // Their placement as this workspace holds it (reportsShownHere, security M1).
        select: REPORT_SELECT,
      },
      // The manager rating this workspace gave (managerRatings, security M2).
      skills: { orderBy: { name: "asc" }, select: { id: true, name: true, selfRating: true, managerRatings: true } },
      // Kudos are this workspace's (D18: history is read through this workspace's own parents).
      _count: { select: { kudosReceived: { where: { organizationId: ctx.organizationId } } } },
    },
  });
  if (!card) {
    // Not anchored here: someone who works here through a membership has a
    // record here too (D11), with this workspace's role and status only.
    const seat = await personSeatIn(ctx.organizationId, id);
    if (seat?.kind === "membership") return membershipRecord(ctx, relation, id, seat);
    return err(404, "User not found");
  }

  const presence = (await presenceFor([id])).get(id) ?? null;
  const dobRow = relation === "none" ? null : await prisma.user.findUnique({ where: { id }, select: { dateOfBirth: true } });
  const access = accessFor(ctx, relation, card, !!dobRow?.dateOfBirth);
  const isGuest = ctx.orgRole === "GUEST";
  // Only people of this workspace are named (batch 6, src/lib/people/named-here.ts),
  // and a line another workspace counts is said to be there, never named (batch 7).
  const related = { manager: card.manager, dottedManagers: card.dottedLineToManagers.map((d) => d.manager), directReports: card.directReports };
  const [here, others] = await Promise.all([
    // Kept seats: someone deactivated here is still named, as when anchored here (step 1 review M2).
    levelsHeldIn(ctx.organizationId, namedIds(related), prisma, { keptSeats: true }),
    recordLinesOfOthers(ctx.organizationId, id, card.managerId, related.dottedManagers.map((d) => d.id)),
  ]);
  const named = namedHere(related, here, others);
  const reportsHere = isGuest ? [] : await reportsShownHere(ctx.organizationId, named.directReports);
  const ownRole = ownHere(card.role, ctx.organizationId);
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
    // A department, job role or office of another workspace is never shown
    // here (D18, the step 3 review H2; profile-here.ts).
    role: ownRole ? { id: ownRole.id, title: ownRole.title, description: ownRole.description, seniority: ownRole.level } : null,
    department: ownHere(card.department, ctx.organizationId),
    office: ownHere(card.office, ctx.organizationId),
    manager: named.manager,
    // "Reports to someone in another workspace" (batch 7): never who.
    managerElsewhere: named.managerElsewhere,
    dottedManagers: named.dottedManagers,
    // Dotted lines kept for another workspace: counted, never named.
    dottedElsewhere: named.dottedElsewhere,
    directReports: reportsHere,
    presenceStatus: presence?.presenceStatus ?? null,
    presenceUntil: presence?.presenceUntil ?? null,
    // Skill names are for everyone (who knows Figma?); ratings are people data.
    skills: card.skills.map((s) => ({
      id: s.id,
      name: s.name,
      selfRating: access.peopleData ? s.selfRating : null,
      // This workspace's own rating only (security M2): another workspace's is never read here.
      managerRating: access.peopleData ? ratingHere(s.managerRatings, ctx.organizationId) : null,
    })),
    kudosCount: isGuest ? 0 : card._count.kudosReceived,
    access,
  };

  // Kudos are public inside the workspace (/kudos lists them all), so every
  // Member sees the ones on a record. Guests never do.
  const kudos = (await kudosHere(ctx, id)).rows;

  if (!access.peopleData) {
    return NextResponse.json({ ...base, kudosReceived: kudos, minimal: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const [full, extra, latestScore, scoreHistory, org] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        phone: true,
        dateOfBirth: true,
        // A certification has no workspace (no parent to read it through,
        // and no writer in the product): a personal credential, kept
        // account-wide like the phone and the date of birth (D18 note).
        certifications: { orderBy: { issuedAt: "desc" } },
        // History tied to the person is read through THIS workspace's own
        // parents (D18): its KPIs, its review cycles, its scores.
        kpiRecords: {
          where: { kpi: { organizationId: ctx.organizationId } },
          orderBy: [{ period: "desc" }, { updatedAt: "desc" }],
          take: 12,
          select: {
            id: true, period: true, actualValue: true, targetValue: true, score: true, status: true, reviewedById: true,
            kpi: { select: { name: true, unit: true } },
          },
        },
        reviewsAsSubject: {
          where: { cycle: { organizationId: ctx.organizationId } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true, cycleId: true, status: true, outcome: true, overallScore: true, calibratedScore: true, reviewerId: true,
            cycle: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
          },
        },
        _count: { select: { kpiRecords: { where: { kpi: { organizationId: ctx.organizationId } } }, reviewsAsSubject: { where: { cycle: { organizationId: ctx.organizationId } } } } },
      },
    }),
    tolerantPeopleFields(id),
    getLatestScore(id, ctx.organizationId),
    getScoreHistory(id, 6, ctx.organizationId),
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

  // At the seat they hold HERE (D11): level, status and removal are this
  // workspace's, for someone anchored here and for a membership alike.
  const target = await personHere(ctx.organizationId, id);
  if (!target) return err(404, "User not found");

  const relation = relationTo(ctx, id);
  if (relation === "none") return err(403, "You can only edit your own record or your reports'.");
  // Someone who works here through a membership: only their role and status
  // are this workspace's (D11). Any other field is the account's profile.
  if (!target.profileHere) {
    const profile = Object.keys(body).filter((k) => body[k] !== undefined && PATCHABLE_PERSON_FIELDS.has(k) && !SEAT_FIELDS.has(k));
    if (profile.length) return err(403, PROFILE_ELSEWHERE, { code: "profile_elsewhere", fields: profile });
  }
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
  // A name, phone, photo or birthday shared with another workspace (the
  // final review, security H1, and the fixes review L8;
  // src/lib/access/shared-identity.ts): the account holds a membership in
  // another workspace, in any state, so they are theirs everywhere and only
  // the person changes them. Read again under the person's row lock at the
  // write below.
  const sharedAsked = SHARED_PERSON_FIELDS.filter((k) => body[k] !== undefined);
  const guardShared = sharedAsked.length > 0 && relation !== "self";
  if (guardShared && (await identityShared(prisma, id, ctx.organizationId))) {
    return err(403, SHARED_IDENTITY_REFUSAL, { code: "identity_shared", fields: sharedAsked });
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
  // The status is the seat's (D1, D11): written by endSeat, restoreSeat or,
  // for a label on a live seat, onto the row that holds the seat here, never
  // with the rest of `data` (a move would carry it to another workspace).
  let statusNext: UserStatusValue | null = null;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !(STATUSES as readonly string[]).includes(body.status)) return err(400, "Unknown status", { field: "status" });
    statusNext = body.status as UserStatusValue;
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
  // Owner out is the worst case), never the last Owner. The seat here ends
  // (endSeat): their sessions acting here lose it at once, and only when
  // they have nowhere else to work does the account end, signed out (D4).
  const deactivating = statusNext === "INACTIVE";
  if (deactivating) {
    if (id === ctx.userId) return err(400, "You cannot deactivate yourself.");
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
  }

  // Reactivating takes a seat again (src/lib/seats.ts): a deactivated person
  // does not count against the plan, an active one does. And the person
  // comes back only under lines that still hold, as a restore does (batch
  // 5): while they were away their manager may have been deactivated, left,
  // or been an Agent from before rule 6.
  const reactivating = statusNext !== null && statusNext !== "INACTIVE" && target.status === "INACTIVE" && !target.deletedAt;
  // Any other status on a removed seat would bring them back without the
  // restore's seat check and line check (before, it wrote ACTIVE beside the
  // removal): a restore brings them back (restoreSeat answers "removed").
  if (statusNext !== null && statusNext !== "INACTIVE" && target.deletedAt) {
    return err(409, "They were removed from this workspace. Restore them first.", { code: "removed", fields: ["status"] });
  }
  // A label (On leave, Probation, Improvement plan, Notice period, or back to
  // Active) on a live seat: written to the row that holds the seat here.
  const relabel = statusNext !== null && statusNext !== "INACTIVE" && !reactivating && statusNext !== target.status;
  // This edit names a new manager itself: that one is checked below instead.
  // The manager they already have, sent again, is no new Reports to: the
  // reactivation's own check reads it (batch 6; before, it passed with
  // `live: false`, so the person came back under a deactivated manager).
  const managerInBody = body.managerId !== undefined && (data.managerId ?? null) !== (target.managerId ?? null);

  if (Object.keys(data).length === 0 && !profilePatch && !roleNext && statusNext === null) return err(400, "Nothing to change");

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
        user: PatchUser | null;
        /** Lines a reactivation cleared (batch 5). */
        stale: { manager: StaleLine | null; dotted: StaleLine[] } | null;
        /** The reports a deactivation moved itself (batch 8; only when it ended the account, D4). */
        endLines: AccountEndLines | null;
        /** What the deactivation did to the seat here (endSeat). */
        ended: EndSeatResult | null;
        /** What the reactivation brought back (restoreSeat). */
        restored: Extract<RestoreSeatResult, { outcome: "restored" }> | null;
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
    const select = { id: true, firstName: true, lastName: true, roleId: true, departmentId: true, officeId: true, managerId: true, status: true, accessLevel: true } as const;
    // The profile first (never for someone who works here through a
    // membership: refused above), while the account is still anchored where
    // it was: a deactivation below may move it to another workspace (D3).
    const write = stale?.manager ? { ...data, managerId: null } : data;
    // A profile write or a status label acts on the seat read before this
    // transaction (the step 3 review M1): a deactivation landing in between
    // would be undone by the label, or (a D3 move) the label and the
    // profile written onto the account now anchored in another workspace.
    // So the person's row lock first, the seat read again under it, and a
    // seat that changed is refused, with nothing written.
    if (Object.keys(write).length > 0 || profilePatch || relabel) {
      await lockPerson(tx, id);
      if (!sameSeat(target.seat, await personSeatIn(ctx.organizationId, id, tx))) {
        return refuse({ status: 409, error: SEAT_CHANGED_WORDS, code: "seat_changed", fields: statusNext !== null ? ["status"] : Object.keys(write) });
      }
      if (guardShared && (await identityShared(tx, id, ctx.organizationId))) {
        return refuse({ status: 403, error: SHARED_IDENTITY_REFUSAL, code: "identity_shared", fields: [...sharedAsked] });
      }
    }
    if (Object.keys(write).length > 0) await tx.user.update({ where: { id }, data: write as Prisma.UserUncheckedUpdateInput, select: { id: true } });
    if (profilePatch) {
      const json = JSON.stringify(profilePatch.set);
      await tx.$executeRaw`
      UPDATE "User"
      SET "customFields" = ((CASE WHEN jsonb_typeof("customFields") = 'object' THEN "customFields" ELSE '{}'::jsonb END) - ${profilePatch.remove}::text[]) || ${json}::jsonb
      WHERE "id" = ${id} AND "organizationId" = ${ctx.organizationId}`;
    }
    let endLines: AccountEndLines | null = null;
    let ended: EndSeatResult | null = null;
    let restored: Extract<RestoreSeatResult, { outcome: "restored" }> | null = null;
    if (deactivating) {
      // The reports whose line another workspace relies on move now, with
      // the deactivation that ends the ACCOUNT (D4: they have nowhere else to
      // work), never before it (batch 8): after every refusal above, right
      // before the seat ends, in this transaction, so a refusal or a failure
      // moves nothing. To the person the handover gave the rest to
      // (`handoverTo`), with that workspace's record of each. When they still
      // work elsewhere (D3, D5) those lines are that workspace's and stay.
      const will = await endSeatWould(tx, { userId: id, organizationId: ctx.organizationId, kind: "deactivated" });
      if (will === "account_ended") {
        endLines = await moveReliedReportsAtEnd(tx, { organizationId: ctx.organizationId, leaverId: id, recipientId: handoverTo, actorId: ctx.userId, ends: "deactivated" });
      }
      // The end planned is the end written (the step 3 review L1): a plan
      // changed in between rolls the moved lines back, and they try again.
      try {
        ended = await endSeat(tx, { userId: id, organizationId: ctx.organizationId, kind: "deactivated", actor: { id: ctx.userId }, expect: will });
      } catch (e) {
        if (e instanceof SeatPlanChanged) return refuse({ status: 409, error: SEAT_PLAN_CHANGED_WORDS, code: "seat_plan_changed", fields: ["status"] });
        throw e;
      }
    } else if (reactivating && statusNext) {
      const r = await restoreSeat(tx, { userId: id, organizationId: ctx.organizationId, kind: "reactivated", status: statusNext === "INACTIVE" ? "ACTIVE" : statusNext });
      const no = await restoreRefusal(r, "reactivated", ctx.isAdmin);
      if (no) return refuse({ ...no, fields: ["status"] });
      restored = r.outcome === "restored" ? r : null;
    } else if (relabel && statusNext) {
      // A label on a live seat, on the row that holds it here (D1), and only
      // while it is still live here (M1): a guarded write that refuses when
      // it touched nothing.
      const n =
        target.seat.kind === "anchor"
          ? await tx.user.updateMany({ where: { id, organizationId: ctx.organizationId, deletedAt: null, status: { not: "INACTIVE" } }, data: { status: statusNext } })
          : await tx.organizationMembership.updateMany({ where: { userId: id, organizationId: ctx.organizationId, status: { not: "INACTIVE" }, removedAt: null }, data: { status: statusNext } });
      if (n.count === 0) return refuse({ status: 409, error: SEAT_CHANGED_WORDS, code: "seat_changed", fields: ["status"] });
    }
    // Answered at the seat held here now (after a move, the membership the
    // move left: deactivated), never the account's other workspace.
    const row = await tx.user.findUnique({ where: { id }, select });
    const seatNow = row ? await personSeatIn(ctx.organizationId, id, tx) : null;
    const u: PatchUser | null = row
      ? seatNow?.kind === "membership"
        ? { id: row.id, firstName: row.firstName, lastName: row.lastName, status: seatNow.status, accessLevel: seatNow.level, profileHere: false }
        : row
      : null;
    return { ok: true, roleChange: rc, user: u, stale, endLines, ended, restored };
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
    // never failing the edit; the sweep clears what this misses. So do
    // theirs in each workspace whose seat came back with the anchored one
    // (the seats the one-time step ended with the account, D16).
    if (reactivating) {
      for (const org of [ctx.organizationId, ...(outcome.restored?.alsoRestoredIn ?? [])]) await skillsBackFor(org, [id]);
    }
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
  if (roleNext && Object.keys(data).length === 0 && !profilePatch && statusNext === null) return NextResponse.json(user);

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

  if (statusNext !== null) {
    void logActivity({
      type: "membership.changed",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `${deactivating ? "Deactivated" : reactivating ? "Reactivated" : "Changed the status of"} ${user.firstName} ${user.lastName}${endLines ? alsoElsewhereLogWords(endLines.reportsAlsoElsewhere.length, "deactivation") : ""}`,
      targetId: id,
      targetType: "user",
      severity: deactivating ? "warning" : "info",
      newValue: { status: statusNext },
      // Which seat it was, and whether the account moved and where (step 3).
      metadata: deactivating
        ? endedMetadata(target.seat, outcome.ended)
        : {
            seat: target.seat.kind,
            // That the account moved here, never from where (L5).
            ...(outcome.restored ? { accountMoved: outcome.restored.movedFrom !== null } : {}),
          },
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

  const keysNote = outcome.ended && "apiKeysRevoked" in outcome.ended && outcome.ended.apiKeysRevoked > 0 ? { apiKeysRevoked: outcome.ended.apiKeysRevoked } : {};
  return NextResponse.json({ ...user, ...reactivationNote, ...endNote, ...keysNote });
}

// DELETE: remove (soft) or restore a person.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await peopleCtx();
  if (!ctx) return err(401, "Unauthorized");
  // A tab still showing another workspace than the session's: refused, never written here (src/lib/access/tab-workspace-check.ts).
  const staleTab = await staleTabRefusal(ctx.organizationId);
  if (staleTab) return staleTab;
  const { id } = await params;
  if (id === ctx.userId) return err(400, "You cannot remove yourself.");

  // At the seat they hold HERE (D11): anchored here, or a membership here,
  // removed or not (a restore needs the removed one).
  const user = await personHere(ctx.organizationId, id);
  if (!user) return err(404, "User not found");
  const relation = relationTo(ctx, id);
  const access = accessFor(ctx, relation, user, false, user.profileHere);
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
    //
    // The seat itself comes back through restoreSeat (D6), for someone
    // anchored here and for a membership alike: when their account is ended
    // where it is anchored, it moves here in the same transaction. Its
    // refusals are plain sentences (restoreRefusal), with nothing written.
    type Restored =
      | { refused: string }
      | { no: { status: 404 | 409; error: string; code: string } }
      | { stale: Awaited<ReturnType<typeof staleLinesOf>>; restored: Extract<RestoreSeatResult, { outcome: "restored" }> };
    class RestoreRefused extends Error {
      constructor(readonly no: { status: 404 | 409; error: string; code: string }) {
        super("refused");
      }
    }
    const done: Restored | NextResponse = await prisma.$transaction(async (tx): Promise<Restored> => {
      await lockOrgRoles(tx, ctx.organizationId);
      // Bounded, after the role lock (batch 5): a busy seat lock answers the
      // same 503, never a 500 with the role lock still held.
      await lockWorkspaceSeats(tx, ctx.organizationId, { bounded: true });
      const seats = await seatsFor(ctx.organizationId, 1, tx);
      if (!seats.ok) return { refused: seats.message };
      const stale = await staleLinesOf(ctx.organizationId, id, tx);
      const r = await restoreSeat(tx, { userId: id, organizationId: ctx.organizationId, kind: "restored" });
      const no = await restoreRefusal(r, "restored", ctx.isAdmin);
      // Thrown, so nothing this transaction wrote stays.
      if (no || r.outcome !== "restored") throw new RestoreRefused(no ?? { status: 404, error: "User not found", code: "not_found" });
      if (stale.manager) await tx.user.update({ where: { id }, data: { managerId: null } });
      if (stale.dotted.length) {
        await tx.userDottedLine.deleteMany({ where: { userId: id, managerId: { in: stale.dotted.map((d) => d.managerId) } } });
      }
      return { stale, restored: r };
    }, LOCKED_TX).catch((e: unknown) => (e instanceof RestoreRefused ? { no: e.no } : rolesBusyOrThrow(e)));
    if (done instanceof NextResponse) return done;
    if ("refused" in done) return err(403, done.refused, { code: "seat_limit" });
    if ("no" in done) return err(done.no.status, done.no.error, { code: done.no.code });
    const name = `${user.firstName} ${user.lastName}`.trim();
    const back = done.restored;
    void logActivity({
      type: "user_restored",
      actorId: ctx.userId,
      organizationId: ctx.organizationId,
      description: `Restored ${name}`,
      targetId: id,
      targetType: "user",
      // Which seat, and whether the account moved here, never from where
      // (another workspace's id stays out of this log, L5).
      metadata: {
        seat: back.seat,
        accountMoved: back.movedFrom !== null,
        ...(back.anchorEnded ? { anchorEnded: true } : {}),
      },
    });
    // Back here: their skills with AI teammates stop their 30 days, as on a
    // reactivation (the removal marked them), and so do theirs in each
    // workspace whose seat came back with the anchored one (D16). After the
    // commit, never failing the restore; the sweep clears what this misses.
    for (const org of [ctx.organizationId, ...back.alsoRestoredIn]) await skillsBackFor(org, [id]);
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
    // Restored here, but their account is ended where it belongs and another
    // account with their address belongs here, so it cannot move here
    // (restoreSeat's anchorEnded, a data fault): said, never hidden.
    const stuck = back.anchorEnded
      ? " They can't sign in here yet: another account with their address belongs to this workspace, so the two accounts need to be merged. Ask WorkwrK support."
      : "";
    return NextResponse.json({
      message: done.stale.manager
        ? `${name} has been restored with no manager, because ${staleLineWords(done.stale.manager)}. Set who they report to in Members.${stuck}`
        : stuck ? `${name} has been restored.${stuck}` : `${name} has been restored`,
      linesCleared: cleared.map((l) => ({ managerId: l.managerId, kind: l === done.stale.manager ? "manager" : "dotted", reason: l.why })),
    });
  }

  // The handover comes first, as for a deactivation (invariant 13, batch 8):
  // a direct DELETE left the person's open tasks, reports and Spaces under a
  // removed account. The Remove dialogs run POST /api/users/[id]/handover
  // first; the reports whose line another workspace relies on are moved by
  // this removal itself when it ends the account, below, so they never hold
  // it up.
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
  const removed = await prisma.$transaction(async (tx): Promise<NextResponse | { endLines: AccountEndLines; ended: EndSeatResult }> => {
    await lockOrgRoles(tx, ctx.organizationId);
    // The level they hold HERE, and every other live Company Admin, a
    // membership one included (D11; live only, the step 3 review L7).
    if (user.accessLevel === "COMPANY_ADMIN") {
      const others = await liveCompanyAdminCount(tx, ctx.organizationId, { except: id });
      if (others < 1) return err(400, "This is the last Company Admin. Make someone else an Admin first.");
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
    // What the removal will do, under the person's row lock (endSeatWould).
    // Removed already (the read above can be stale, and an account removed
    // or erased since keeps its deletedAt, review round 9 of Phase 3):
    // nothing is written.
    const will = await endSeatWould(tx, { userId: id, organizationId: ctx.organizationId, kind: "removed" });
    if (will === "already_ended" || will === "not_here") throw new AlreadyRemoved();
    // The reports whose line another workspace relies on move now, with the
    // removal that ends the ACCOUNT (D4), never before it (batch 8): after
    // every refusal above, right before the seat ends. When they still work
    // elsewhere (D3, D5) those lines are that workspace's and stay.
    const endLines = will === "account_ended"
      ? await moveReliedReportsAtEnd(tx, { organizationId: ctx.organizationId, leaverId: id, recipientId: handoverTo, actorId: ctx.userId, ends: "removed" })
      : NOTHING_MOVED;
    // The seat ends (endSeat): a removed person's sessions acting here lose
    // it at once, and only an account with nowhere else to work ends and is
    // signed out (D4). Removed meanwhile: the lines moved above roll back.
    // The end planned is the end written (the step 3 review L1): a plan
    // changed in between throws, and the lines moved above roll back.
    const ended = await endSeat(tx, { userId: id, organizationId: ctx.organizationId, kind: "removed", actor: { id: ctx.userId }, expect: will });
    if (ended.outcome === "already_ended" || ended.outcome === "not_here") throw new AlreadyRemoved();
    return { endLines, ended };
  }, LOCKED_TX).catch((e: unknown) => (e instanceof AlreadyRemoved ? ("already" as const) : e instanceof SeatPlanChanged ? ("changed" as const) : rolesBusyOrThrow(e)));
  // Removed already: a harmless success, nothing written or logged again.
  if (removed === "already") return NextResponse.json({ message: `${user.firstName} ${user.lastName} has been removed` });
  if (removed === "changed") return err(409, SEAT_PLAN_CHANGED_WORDS, { code: "seat_plan_changed" });
  if (removed instanceof NextResponse) return removed;
  const { endLines, ended } = removed;
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
    description: `Removed ${user.firstName} ${user.lastName} from organization${alsoElsewhereLogWords(endLines.reportsAlsoElsewhere.length, "removal")}`,
    targetId: id,
    targetType: "user",
    // Which seat, and whether the account moved and where (step 3).
    metadata: endedMetadata(user.seat, ended),
  });
  return NextResponse.json({
    message: `${user.firstName} ${user.lastName} has been removed`,
    // What the removal moved itself (batch 8), for the dialog's last word.
    ...(endLines.reportsMoved > 0 ? { reportsAlsoElsewhere: endLines.reportsAlsoElsewhere, reportsRehomed: endLines.reportsRehomed } : {}),
    ...("apiKeysRevoked" in ended && ended.apiKeysRevoked > 0 ? { apiKeysRevoked: ended.apiKeysRevoked } : {}),
  });
}
