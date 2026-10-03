// Goal audience, who a goal belongs to, resolved at READ time.
//
// A goal (OKR) is ONE record with ONE accountable owner (ownerId, the DRI)
// and MANY assignees (GoalAssignee rows). An assignee row points at exactly
// one subject, a user, a department, or a role (DB CHECK
// `GoalAssignee_one_subject` guarantees it; the API validators here enforce
// the same rule before anything reaches Prisma).
//
// Department/role rows store the department/role, NEVER a frozen list of
// people: membership is resolved on every read, so a new hire inherits
// their team's goals and a leaver drops out automatically. "Active" uses
// the same filter as seedKraToRoleHolders (status ACTIVE) plus
// deletedAt: null, the org-wide soft-delete rule.

import { prisma } from "@/lib/prisma";
import { getOrgId, getUserId, isManager } from "@/lib/api-helpers";
import { canEditGoal, isOrgWideAlignment } from "@/lib/alignment-scope";
import { getTeamUserIds } from "@/lib/team";
import { GOAL_EDIT_REFUSED, mayEditGoal, type GoalRightsActor, type GoalRightsTarget } from "@/lib/goals/goal-rights";
import type { Prisma } from "@/generated/prisma";
import { getUserTagIds } from "@/lib/user-tags";

export const GOAL_AUDIENCE_TYPES = ["USER", "DEPARTMENT", "ROLE", "TAG"] as const;
export type GoalAudienceType = (typeof GOAL_AUDIENCE_TYPES)[number];

/** One audience entry as the API accepts/returns it: `{ type, id }`. */
export interface GoalAudienceRef {
  type: GoalAudienceType;
  id: string;
}

/** Audience entry enriched with a display label (picker/edit surfaces). */
export interface GoalAudienceEntry extends GoalAudienceRef {
  label: string;
  avatar?: string | null;
}

export interface GoalMemberUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

/** What GET /api/okrs attaches per goal: avatars + an overflow count. */
export interface GoalAudienceSummary {
  /** Resolved members preview (owner first), capped at MEMBER_PREVIEW. */
  members: GoalMemberUser[];
  /** Full de-duplicated member count (drives the "+N" overflow chip). */
  totalMembers: number;
  /** Raw audience row count (people + departments + roles assigned). */
  assigneeCount: number;
}

const MEMBER_PREVIEW = 5;

/** Leaver safety, mirrors seedKraToRoleHolders' ACTIVE filter. */
const ACTIVE_USER = { status: "ACTIVE", deletedAt: null } as const;

const keyOf = (e: GoalAudienceRef) => `${e.type}:${e.id}`;

function rowKey(r: { userId: string | null; departmentId: string | null; roleId: string | null; tagId: string | null }): string {
  if (r.userId) return `USER:${r.userId}`;
  if (r.departmentId) return `DEPARTMENT:${r.departmentId}`;
  if (r.roleId) return `ROLE:${r.roleId}`;
  return `TAG:${r.tagId}`;
}

/** GoalAssignee create payload for one entry, exactly one subject set. */
function rowFor(okrId: string, e: GoalAudienceRef) {
  return {
    okrId,
    userId: e.type === "USER" ? e.id : null,
    departmentId: e.type === "DEPARTMENT" ? e.id : null,
    roleId: e.type === "ROLE" ? e.id : null,
    tagId: e.type === "TAG" ? e.id : null,
  };
}

/* ────────────────────────── resolution (read time) ───────────────────── */

/**
 * Batch resolver, one pass for a page of goals. Returns, per okrId, the
 * ordered de-duplicated member users: owner first, then directly-assigned
 * users, then members of assigned departments, then holders of assigned
 * roles. Only ACTIVE, non-soft-deleted users ever appear.
 */
export async function resolveGoalMembersBatch(
  orgId: string,
  okrs: { id: string; ownerId: string | null }[],
): Promise<Map<string, GoalMemberUser[]>> {
  const result = new Map<string, GoalMemberUser[]>();
  if (okrs.length === 0) return result;

  const rows = await prisma.goalAssignee.findMany({
    where: { okrId: { in: okrs.map((o) => o.id) } },
    select: { okrId: true, userId: true, departmentId: true, roleId: true, tagId: true },
    orderBy: { createdAt: "asc" },
  });

  const userIds = new Set<string>(okrs.map((o) => o.ownerId).filter((x): x is string => !!x));
  const deptIds = new Set<string>();
  const roleIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const r of rows) {
    if (r.userId) userIds.add(r.userId);
    if (r.departmentId) deptIds.add(r.departmentId);
    if (r.roleId) roleIds.add(r.roleId);
    if (r.tagId) tagIds.add(r.tagId);
  }

  // Resolve each targeted tag to its current holders (entityType USER) and add
  // them to the id set so their details load in the single user query below.
  const tagHolders = new Map<string, string[]>();
  if (tagIds.size > 0) {
    const holderRows = await prisma.tagAssignment.findMany({
      where: { organizationId: orgId, entityType: "USER", tagId: { in: [...tagIds] }, tag: { archived: false } },
      select: { tagId: true, entityId: true },
    });
    for (const h of holderRows) {
      const list = tagHolders.get(h.tagId);
      if (list) list.push(h.entityId);
      else tagHolders.set(h.tagId, [h.entityId]);
      userIds.add(h.entityId);
    }
  }

  const or: Prisma.UserWhereInput[] = [];
  if (userIds.size > 0) or.push({ id: { in: [...userIds] } });
  if (deptIds.size > 0) or.push({ departmentId: { in: [...deptIds] } });
  if (roleIds.size > 0) or.push({ roleId: { in: [...roleIds] } });
  if (or.length === 0) {
    for (const o of okrs) result.set(o.id, []);
    return result;
  }

  const users = await prisma.user.findMany({
    where: { organizationId: orgId, ...ACTIVE_USER, OR: or },
    select: { id: true, firstName: true, lastName: true, avatar: true, departmentId: true, roleId: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const byId = new Map(users.map((u) => [u.id, u]));
  const byDept = new Map<string, typeof users>();
  const byRole = new Map<string, typeof users>();
  for (const u of users) {
    if (u.departmentId) {
      if (!byDept.has(u.departmentId)) byDept.set(u.departmentId, []);
      byDept.get(u.departmentId)!.push(u);
    }
    if (u.roleId) {
      if (!byRole.has(u.roleId)) byRole.set(u.roleId, []);
      byRole.get(u.roleId)!.push(u);
    }
  }
  // tagId → resolved holder users (active ones that survived the main query).
  const byTag = new Map<string, typeof users>();
  for (const [tagId, holderIds] of tagHolders) {
    const members = holderIds
      .map((id) => byId.get(id))
      .filter((u): u is (typeof users)[number] => !!u);
    if (members.length > 0) byTag.set(tagId, members);
  }

  const rowsByOkr = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!rowsByOkr.has(r.okrId)) rowsByOkr.set(r.okrId, []);
    rowsByOkr.get(r.okrId)!.push(r);
  }

  const toMember = (u: (typeof users)[number]): GoalMemberUser => ({
    id: u.id, firstName: u.firstName, lastName: u.lastName, avatar: u.avatar,
  });

  for (const o of okrs) {
    const seen = new Set<string>();
    const members: GoalMemberUser[] = [];
    const push = (u: (typeof users)[number] | undefined) => {
      if (!u || seen.has(u.id)) return;
      seen.add(u.id);
      members.push(toMember(u));
    };
    if (o.ownerId) push(byId.get(o.ownerId));
    for (const r of rowsByOkr.get(o.id) ?? []) {
      if (r.userId) push(byId.get(r.userId));
      else if (r.departmentId) (byDept.get(r.departmentId) ?? []).forEach(push);
      else if (r.roleId) (byRole.get(r.roleId) ?? []).forEach(push);
      else if (r.tagId) (byTag.get(r.tagId) ?? []).forEach(push);
    }
    result.set(o.id, members);
  }
  return result;
}

/**
 * All resolved member userIds of one goal, owner + direct users + members
 * of assigned departments + holders of assigned roles, de-duplicated.
 * Resolution happens NOW, never from a stored snapshot.
 */
export async function resolveGoalMembers(okrId: string): Promise<string[]> {
  const okr = await prisma.oKR.findUnique({
    where: { id: okrId },
    select: { id: true, ownerId: true, organizationId: true },
  });
  if (!okr) return [];
  const batch = await resolveGoalMembersBatch(okr.organizationId, [okr]);
  return (batch.get(okr.id) ?? []).map((m) => m.id);
}

/** Avatar-stack summaries for a page of goals (GET /api/okrs). */
export async function summarizeGoalAudiences(
  orgId: string,
  okrs: { id: string; ownerId: string | null }[],
): Promise<Map<string, GoalAudienceSummary>> {
  const [membersByOkr, counts] = await Promise.all([
    resolveGoalMembersBatch(orgId, okrs),
    okrs.length > 0
      ? prisma.goalAssignee.groupBy({
          by: ["okrId"],
          where: { okrId: { in: okrs.map((o) => o.id) } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const countByOkr = new Map(counts.map((c) => [c.okrId, c._count._all]));
  const out = new Map<string, GoalAudienceSummary>();
  for (const o of okrs) {
    const members = membersByOkr.get(o.id) ?? [];
    out.set(o.id, {
      members: members.slice(0, MEMBER_PREVIEW),
      totalMembers: members.length,
      assigneeCount: countByOkr.get(o.id) ?? 0,
    });
  }
  return out;
}

/* ───────────────────────────── edit rules ────────────────────────────── */

/**
 * May this actor put a goal under `parent` (Part of)? A parent's progress
 * is the mean of its own targets and every measured child, persisted up
 * the chain, so attaching a goal re-weights the parent's headline number.
 * That is an edit of the parent, and needs the same right as editing it
 * (mayEditGoal, src/lib/goals/goal-rights.ts): without this, any member
 * could drag a Company goal the whole org reads by attaching their own 1%
 * goal to it. Clearing Part of is an edit of the child only, and never
 * reaches this rule. The goal routes read the wider mayLinkUnderGoal
 * (src/lib/goals/goal-rights.ts), which adds one door to this: someone who
 * manages people lines a Department goal up under a Company goal.
 */
export function mayAttachUnderGoal(actor: GoalRightsActor, parent: GoalRightsTarget): boolean {
  return mayEditGoal(actor, parent);
}

/**
 * May a caller outside the org-wide levels see goals nobody owns, beyond
 * the Company goals and their own department's goals everyone sees? Only
 * the manager tier, who create unowned goals. Someone who simply has a
 * report does not: their team is the people in it, not every ownerless
 * goal in the org (GET /api/okrs and canSeeGoal both read this).
 */
export function seesUnownedGoals(actor: { manager: boolean }): boolean {
  return actor.manager;
}

/* ───────────────────────────── visibility ────────────────────────────── */

/**
 * May the caller see this goal? True when they own it, are in its audience,
 * or manage someone who is (report tree via getTeamUserIds, matched by the
 * same teamAudienceVisibilityOr fragments the Goals list uses).
 * COMPANY-level goals are visible to everyone in the org (org scoping is
 * the caller's job, check organizationId before calling). The legacy
 * DEPARTMENT + departmentId match is kept so pre-audience goals stay
 * visible to their department.
 */
export async function canSeeGoal(
  session: unknown,
  okr: { id: string; level: string; ownerId: string | null; departmentId?: string | null },
): Promise<boolean> {
  if (isOrgWideAlignment(session)) return true;
  if (okr.level === "COMPANY") return true;
  const callerId = getUserId(session);
  if (okr.ownerId === callerId) return true;

  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: { departmentId: true, roleId: true },
  });
  if (okr.level === "DEPARTMENT" && okr.departmentId && me?.departmentId === okr.departmentId) return true;

  // The caller in the goal's audience, matched on their own user row,
  // department, role and tags whatever their status (on leave, probation,
  // notice), with the exact fragments GET /api/okrs lists by, so a row the
  // list shows never opens onto a 404.
  const tagIds = await getUserTagIds(getOrgId(session), callerId);
  const direct = await prisma.oKR.count({
    where: { id: okr.id, OR: memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId, tagIds }) },
  });
  if (direct > 0) return true;

  // A manager at any tier, or anyone with people reporting to them (Phase 6:
  // "manager" is a fact about the org chart), through the exact fragments
  // GET /api/okrs, search and Ask AI list by (teamAudienceVisibilityOr), so
  // a row the list shows never opens onto a 404. This used the goal's ACTIVE
  // members only, so a goal assigned to a report on leave, on notice or
  // deactivated (directly, or by a tag only they hold) was listed and then
  // refused. Dept and role audiences still follow today's org chart there.
  const teamIds = await getTeamUserIds(getOrgId(session), callerId);
  const tree = new Set(teamIds);
  if (isManager(session) || tree.size > 1) {
    // Unowned objectives stay visible to the manager tier (who create
    // them), never to everyone with a report: the same rule GET lists by.
    if (!okr.ownerId && seesUnownedGoals({ manager: isManager(session) })) return true;
    if (okr.ownerId && tree.has(okr.ownerId)) return true;
    const teamOr = await teamAudienceVisibilityOr(teamIds);
    if (teamOr.length > 0 && (await prisma.oKR.count({ where: { id: okr.id, OR: teamOr } })) > 0) return true;
  }
  return false;
}

/**
 * The one write gate for a goal's sub-resources (targets, contributors):
 * null when the caller may edit it; a 404 when they cannot even see it, so
 * a refusal never confirms a hidden goal exists; else the 403 copy, which
 * names the right and never the goal.
 */
export async function goalEditDenial(
  session: unknown,
  okr: { id: string; level: string; ownerId: string | null; departmentId?: string | null },
): Promise<{ status: 403 | 404; error: string } | null> {
  if (!(await canSeeGoal(session, okr))) return { status: 404, error: "Not found" };
  if (!(await canEditGoal(session, okr))) return { status: 403, error: GOAL_EDIT_REFUSED };
  return null;
}

/**
 * WHERE fragments for list endpoints: goals whose audience directly
 * includes this person (their user row, their department, their role).
 * OR these into the visibility clause.
 */
export function memberVisibilityOr(me: {
  id: string;
  departmentId?: string | null;
  roleId?: string | null;
  /** The viewer's own person-tag ids, goals targeting any of them are visible.
   *  Fetch with getUserTagIds(orgId, me.id) at the call site. */
  tagIds?: string[] | null;
}): Prisma.OKRWhereInput[] {
  const or: Prisma.OKRWhereInput[] = [{ assignees: { some: { userId: me.id } } }];
  if (me.departmentId) or.push({ assignees: { some: { departmentId: me.departmentId } } });
  if (me.roleId) or.push({ assignees: { some: { roleId: me.roleId } } });
  if (me.tagIds && me.tagIds.length > 0) or.push({ assignees: { some: { tagId: { in: me.tagIds } } } });
  return or;
}

/**
 * The three-door goal visibility of GET /api/okrs as a WHERE fragment, for
 * every reader that lists goals (the Goals list, Ask AI's goal search): null
 * for an org-wide caller, who sees everything. Everyone sees Company goals,
 * their own, their department's and the ones whose audience names them; a
 * manager, or anyone with reports, also sees their tree's (and the manager
 * tier the unowned ones). Pass what the caller already loaded to skip the
 * lookups.
 */
export async function goalVisibilityOr(
  session: unknown,
  pre: { me?: { departmentId: string | null; roleId: string | null } | null; tagIds?: string[]; treeIds?: string[] } = {},
): Promise<Prisma.OKRWhereInput[] | null> {
  if (isOrgWideAlignment(session)) return null;
  const orgId = getOrgId(session);
  const callerId = getUserId(session);
  const me = pre.me !== undefined
    ? pre.me
    : await prisma.user.findUnique({ where: { id: callerId }, select: { departmentId: true, roleId: true } });
  const tagIds = pre.tagIds ?? (await getUserTagIds(orgId, callerId));
  const treeIds = pre.treeIds ?? (await getTeamUserIds(orgId, callerId));
  const hasTree = isManager(session) || treeIds.length > 1;
  const visible: Prisma.OKRWhereInput[] = [{ level: "COMPANY" }, { ownerId: callerId }];
  if (me?.departmentId) visible.push({ level: "DEPARTMENT", departmentId: me.departmentId });
  visible.push(...memberVisibilityOr({ id: callerId, departmentId: me?.departmentId, roleId: me?.roleId, tagIds }));
  if (hasTree) {
    visible.push({ ownerId: { in: treeIds } });
    // Unowned goals only for the manager tier (seesUnownedGoals): one
    // report must not open every ownerless goal in the org.
    if (seesUnownedGoals({ manager: isManager(session) })) visible.push({ ownerId: null });
    visible.push(...(await teamAudienceVisibilityOr(treeIds)));
  }
  return visible;
}

/**
 * WHERE fragments for a manager's list: goals whose audience covers anyone
 * in their report tree, directly, or through the department/role a team
 * member currently sits in.
 */
export async function teamAudienceVisibilityOr(
  teamIds: string[],
): Promise<Prisma.OKRWhereInput[]> {
  if (teamIds.length === 0) return [];
  const or: Prisma.OKRWhereInput[] = [{ assignees: { some: { userId: { in: teamIds } } } }];
  const rows = await prisma.user.findMany({
    where: { id: { in: teamIds }, ...ACTIVE_USER },
    select: { departmentId: true, roleId: true },
  });
  const deptIds = [...new Set(rows.map((r) => r.departmentId).filter((x): x is string => !!x))];
  const roleIds = [...new Set(rows.map((r) => r.roleId).filter((x): x is string => !!x))];
  if (deptIds.length > 0) or.push({ assignees: { some: { departmentId: { in: deptIds } } } });
  if (roleIds.length > 0) or.push({ assignees: { some: { roleId: { in: roleIds } } } });
  // Person-tags any team member carries, goals targeting those tags are
  // team-visible too (resolved live from TagAssignment).
  const tagRows = await prisma.tagAssignment.findMany({
    where: { entityType: "USER", entityId: { in: teamIds }, tag: { archived: false } },
    select: { tagId: true },
    distinct: ["tagId"],
  });
  const tagIds = tagRows.map((t) => t.tagId);
  if (tagIds.length > 0) or.push({ assignees: { some: { tagId: { in: tagIds } } } });
  return or;
}

/* ─────────────────────────── write-side helpers ──────────────────────── */

export type GoalAssigneeValidation =
  | { ok: true; entries: GoalAudienceRef[] }
  | { ok: false; error: string };

/**
 * Parse + validate an `assignees` payload. Enforces, in the API layer
 * (not just via the DB CHECK / partial unique indexes):
 *  - shape: array of `{ type: "USER"|"DEPARTMENT"|"ROLE", id: string }`
 *  - exactly one subject per row (a row is one type + one id, nothing else)
 *  - de-duplication by (type, id)
 *  - every id belongs to `orgId`, cross-org ids are rejected wholesale.
 */
export async function validateGoalAssignees(
  orgId: string,
  input: unknown,
): Promise<GoalAssigneeValidation> {
  if (!Array.isArray(input)) {
    return { ok: false, error: "assignees must be an array of { type, id }" };
  }
  if (input.length > 200) {
    return { ok: false, error: "Too many assignees (max 200)" };
  }
  const entries: GoalAudienceRef[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "Each assignee must be an object of shape { type, id }" };
    }
    const { type, id } = raw as { type?: unknown; id?: unknown };
    if (type !== "USER" && type !== "DEPARTMENT" && type !== "ROLE" && type !== "TAG") {
      return { ok: false, error: "Assignee type must be USER, DEPARTMENT, ROLE or TAG" };
    }
    if (typeof id !== "string" || id.trim().length === 0) {
      return { ok: false, error: "Each assignee needs a non-empty id" };
    }
    const entry: GoalAudienceRef = { type, id: id.trim() };
    const key = keyOf(entry);
    if (seen.has(key)) continue; // de-dupe in the API layer, not just the DB
    seen.add(key);
    entries.push(entry);
  }

  // Cross-org guard: every id must exist inside the caller's organization.
  const idsFor = (t: GoalAudienceType) => entries.filter((e) => e.type === t).map((e) => e.id);
  const [userIds, deptIds, roleIds, tagIds] = [idsFor("USER"), idsFor("DEPARTMENT"), idsFor("ROLE"), idsFor("TAG")];
  const [users, depts, roles, tags] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
    deptIds.length > 0
      ? prisma.department.findMany({
          where: { id: { in: deptIds }, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve([]),
    roleIds.length > 0
      ? prisma.role.findMany({
          where: { id: { in: roleIds }, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve([]),
    tagIds.length > 0
      ? prisma.tag.findMany({
          where: { id: { in: tagIds }, organizationId: orgId, archived: false },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const valid = new Set<string>([
    ...users.map((u) => `USER:${u.id}`),
    ...depts.map((d) => `DEPARTMENT:${d.id}`),
    ...roles.map((r) => `ROLE:${r.id}`),
    ...tags.map((t) => `TAG:${t.id}`),
  ]);
  const bad = entries.filter((e) => !valid.has(keyOf(e)));
  if (bad.length > 0) {
    return {
      ok: false,
      error: `Unknown or cross-organization assignee${bad.length === 1 ? "" : "s"}: ${bad
        .map((e) => `${e.type} ${e.id}`)
        .join(", ")}`,
    };
  }
  return { ok: true, entries };
}

/** Add audience entries to a goal (idempotent, duplicates are skipped). */
export async function addGoalAssignees(okrId: string, entries: GoalAudienceRef[]): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await prisma.goalAssignee.createMany({
    data: entries.map((e) => rowFor(okrId, e)),
    skipDuplicates: true,
  });
  return res.count;
}

/** Remove specific audience entries from a goal (join rows only). */
export async function removeGoalAssignees(okrId: string, entries: GoalAudienceRef[]): Promise<number> {
  if (entries.length === 0) return 0;
  const or: Prisma.GoalAssigneeWhereInput[] = entries.map((e) =>
    e.type === "USER"
      ? { userId: e.id }
      : e.type === "DEPARTMENT"
        ? { departmentId: e.id }
        : e.type === "ROLE"
          ? { roleId: e.id }
          : { tagId: e.id },
  );
  const res = await prisma.goalAssignee.deleteMany({ where: { okrId, OR: or } });
  return res.count;
}

/**
 * Make the goal's audience exactly `entries` (PATCH full-replacement).
 * Diff-synced: existing rows that stay are untouched (createdAt kept),
 * missing ones are created, removed ones deleted, atomically.
 */
export async function syncGoalAssignees(okrId: string, entries: GoalAudienceRef[]): Promise<void> {
  const existing = await prisma.goalAssignee.findMany({
    where: { okrId },
    select: { id: true, userId: true, departmentId: true, roleId: true, tagId: true },
  });
  const want = new Set(entries.map(keyOf));
  const have = new Set(existing.map(rowKey));
  const toCreate = entries.filter((e) => !have.has(keyOf(e))).map((e) => rowFor(okrId, e));
  const toDelete = existing.filter((r) => !want.has(rowKey(r))).map((r) => r.id);
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (toCreate.length > 0) ops.push(prisma.goalAssignee.createMany({ data: toCreate, skipDuplicates: true }));
  if (toDelete.length > 0) ops.push(prisma.goalAssignee.deleteMany({ where: { id: { in: toDelete }, okrId } }));
  if (ops.length > 0) await prisma.$transaction(ops);
}

/** The goal's audience rows as labeled entries (edit surfaces / pickers). */
export async function listGoalAssigneeEntries(okrId: string): Promise<GoalAudienceEntry[]> {
  const rows = await prisma.goalAssignee.findMany({
    where: { okrId },
    select: {
      userId: true,
      departmentId: true,
      roleId: true,
      tagId: true,
      user: { select: { firstName: true, lastName: true, avatar: true } },
      department: { select: { name: true } },
      role: { select: { title: true } },
      tag: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r): GoalAudienceEntry => {
    if (r.userId) {
      return {
        type: "USER",
        id: r.userId,
        label: `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim() || "Unknown",
        avatar: r.user?.avatar ?? null,
      };
    }
    if (r.departmentId) {
      return { type: "DEPARTMENT", id: r.departmentId, label: r.department?.name ?? "Department" };
    }
    if (r.roleId) {
      return { type: "ROLE", id: r.roleId, label: r.role?.title ?? "Role" };
    }
    return { type: "TAG", id: r.tagId!, label: r.tag?.name ?? "Tag" };
  });
}
