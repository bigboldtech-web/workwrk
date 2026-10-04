// The one dialog on a goal (batch 7; spec-goals section 1 Access), over the
// goal's GoalAssignee person rows: the contributors every goal gate reads
// (canSeeGoal, isGoalContributor, the check-in route). Served only while
// ACCESS_V2_TABLES is on (common.ts).
//
//   one role    Can check in: see the goal and check in on its targets,
//               never rename, delete or share it. A row has no role column,
//               so the dialog offers nothing it cannot store.
//   who sees    anyone canSeeGoal admits
//   who shares  anyone mayEditGoal allows (the owner, Owners and Admins, the
//               People team, and below Company level its creator and the
//               owner's managers on the manager tier): the same people the
//               goal's Contributors row lets add people today
//   the owner   pinned: the goal's accountable person, changed from the
//               goal's menu, never removed here
//   the rules   the Company level, a Department goal's department, the
//               department, job title and tag rows, the owner's managers,
//               the creator, and who sees every goal: read-only lines
//   writes      one row at a time in a transaction that locks the goal row
//               (GoalAssignee has no unique key, so the lock is what keeps a
//               double click from writing two rows), with the role the
//               dialog showed checked (409 when it moved), and an access
//               activity row. Never AccessGrant: nothing reads goal rows
//               there, and the step-7 copy would eat an untagged one.

import { prisma } from "@/lib/prisma";
import { isManager } from "@/lib/api-helpers";
import { canSeeGoal, memberVisibilityOr, seesUnownedGoals, teamAudienceVisibilityOr } from "@/lib/goal-audience";
import { goalCreatorIds, goalRightsActor, isOrgWideAlignment, ORG_WIDE_ALIGNMENT_LEVELS } from "@/lib/alignment-scope";
import { mayDeleteGoal, mayEditGoal, type GoalRightsActor, type GoalRightsTarget } from "@/lib/goals/goal-rights";
import { getTeamUserIds } from "@/lib/team";
import { getUserTagIds } from "@/lib/user-tags";
import { resolveRequestsFor } from "../access-requests";
import { GrantError } from "../grants";
import {
  ACCESS_NODE_NOUN, ROLES_BY_KIND,
  type AccessDirectEntry, type AccessPanel, type AccessVia, type GrantChange, type GrantWriteBody, type GrantWriteResult, type PanelRole,
} from "../access-panel";
import {
  NO_GENERAL, USER_SELECT, notifyObjectGrantee, objectActivity, orgAdminCount, orgNameOf, personOf, targetInOrg,
  type ObjectShareCtx, type Tx,
} from "./common";

const KIND = "goal" as const;

const hrefOf = (id: string) => `/okrs/${encodeURIComponent(id)}`;

type GoalRow = { id: string; title: string; level: string; ownerId: string | null; departmentId: string | null };

async function loadGoal(db: Tx | typeof prisma, organizationId: string, id: string): Promise<GoalRow | null> {
  return db.oKR.findFirst({ where: { id, organizationId }, select: { id: true, title: true, level: true, ownerId: true, departmentId: true } });
}

const sessionFor = (userId: string, organizationId: string, accessLevel: string) => ({ user: { id: userId, organizationId, accessLevel } });

const nameOf = (u: { firstName: string | null; lastName: string | null; email: string } | null | undefined) =>
  u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email : null;

/** What the viewer may do: see, edit (and so change who contributes), delete. */
async function rightsOf(session: ReturnType<typeof sessionFor>, goal: GoalRow, target: GoalRightsTarget) {
  if (!(await canSeeGoal(session, goal))) return { seen: false, edit: false, del: false, actor: null };
  const actor = await goalRightsActor(session);
  return { seen: true, edit: mayEditGoal(actor, target), del: mayDeleteGoal(actor, target), actor };
}

/**
 * Why someone edits (or deletes) this goal, by mayEditGoal's own order. The
 * People team edits, never deletes: a delete is never put down to it.
 */
function rightsReason(actor: GoalRightsActor, goal: GoalRow, target: GoalRightsTarget, userId: string, ownerName: string, forDelete: boolean): string {
  return RIGHTS_WORDS[rightsSource(actor, goal, target, userId, forDelete)].sentence(ownerName);
}

type RightsSource = "admin" | "owner" | "people" | "creator" | "chain";

function rightsSource(actor: GoalRightsActor, goal: GoalRow, target: GoalRightsTarget, userId: string, forDelete: boolean): RightsSource {
  if (actor.admin) return "admin";
  if (goal.ownerId === userId) return "owner";
  if (!forDelete && actor.peopleTeam) return "people";
  if (goal.level !== "COMPANY" && target.creatorId === userId) return "creator";
  return "chain";
}

const RIGHTS_WORDS: Readonly<Record<RightsSource, { sentence: (owner: string) => string; via: (owner: string) => string }>> = {
  admin: { sentence: () => "They are an Owner or Admin.", via: () => "as an Owner or Admin" },
  owner: { sentence: () => "They own this goal.", via: () => "as its owner" },
  people: { sentence: () => "They are on the People team.", via: () => "as the People team" },
  creator: { sentence: () => "They made this goal.", via: () => "as the person who made it" },
  chain: { sentence: (owner) => `${owner} reports to them.`, via: (owner) => `as someone ${owner} reports to` },
};

/**
 * Would canSeeGoal still hold for this person without their own contributor
 * row? The same doors (goal-audience.ts canSeeGoal): an org-wide level, a
 * Company goal, the owner, a Department goal of their department, a
 * department, job title or tag row, and a manager's tree (their reports'
 * rows, never their own).
 */
async function seesWithoutOwnRow(session: ReturnType<typeof sessionFor>, goal: GoalRow): Promise<boolean> {
  const { id: userId, organizationId } = session.user;
  if (isOrgWideAlignment(session) || goal.level === "COMPANY" || goal.ownerId === userId) return true;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true, roleId: true } });
  if (goal.level === "DEPARTMENT" && goal.departmentId && me?.departmentId === goal.departmentId) return true;
  const tagIds = await getUserTagIds(organizationId, userId);
  // Their department, job title and tags: memberVisibilityOr's first fragment
  // is their own row, which is the one left out.
  const groupOr = memberVisibilityOr({ id: userId, departmentId: me?.departmentId, roleId: me?.roleId, tagIds }).slice(1);
  if (groupOr.length > 0 && (await prisma.oKR.count({ where: { id: goal.id, OR: groupOr } })) > 0) return true;
  const reports = (await getTeamUserIds(organizationId, userId)).filter((id) => id !== userId);
  const manager = isManager(session);
  if (!manager && reports.length === 0) return false;
  if (!goal.ownerId && seesUnownedGoals({ manager })) return true;
  if (goal.ownerId && reports.includes(goal.ownerId)) return true;
  const teamOr = await teamAudienceVisibilityOr(reports);
  return teamOr.length > 0 && (await prisma.oKR.count({ where: { id: goal.id, OR: teamOr } })) > 0;
}

async function rightsTargetOf(organizationId: string, goal: GoalRow): Promise<GoalRightsTarget> {
  const creatorId = (await goalCreatorIds(organizationId, [goal.id])).get(goal.id) ?? null;
  return { level: goal.level, ownerId: goal.ownerId, creatorId };
}

type AssigneeRow = { userId: string | null; departmentId: string | null; roleId: string | null; tagId: string | null };

async function assigneeRows(db: Tx | typeof prisma, okrId: string): Promise<AssigneeRow[]> {
  return db.goalAssignee.findMany({ where: { okrId }, select: { userId: true, departmentId: true, roleId: true, tagId: true }, orderBy: { createdAt: "asc" } });
}

/** The department, job title and tag rows as the words a person reads. */
async function groupWords(organizationId: string, rows: readonly AssigneeRow[]) {
  const ids = (k: "departmentId" | "roleId" | "tagId") => [...new Set(rows.map((r) => r[k]).filter((v): v is string => !!v))];
  const [depts, roles, tags] = await Promise.all([
    ids("departmentId").length ? prisma.department.findMany({ where: { id: { in: ids("departmentId") }, organizationId }, select: { id: true, name: true } }) : [],
    ids("roleId").length ? prisma.role.findMany({ where: { id: { in: ids("roleId") }, organizationId }, select: { id: true, title: true } }) : [],
    // An archived tag matches nobody (getUserTagIds), so its row gives no note.
    ids("tagId").length ? prisma.tag.findMany({ where: { id: { in: ids("tagId") }, organizationId, archived: false }, select: { id: true, name: true } }) : [],
  ]);
  return {
    dept: new Map(depts.map((d) => [d.id, d.name])),
    role: new Map(roles.map((r) => [r.id, r.title])),
    tag: new Map(tags.map((t) => [t.id, t.name])),
  };
}

/** How a person contributes without a row of their own: the first department, job title or tag row they match. */
async function groupContribution(
  organizationId: string,
  rows: readonly AssigneeRow[],
  person: { id: string; departmentId: string | null; roleId: string | null },
): Promise<string | null> {
  const tagIds = new Set(await getUserTagIds(organizationId, person.id));
  const hit = rows.find((r) => (r.departmentId && r.departmentId === person.departmentId) || (r.roleId && r.roleId === person.roleId) || (r.tagId && tagIds.has(r.tagId)));
  if (!hit) return null;
  const words = await groupWords(organizationId, [hit]);
  if (hit.departmentId) return `as a member of ${words.dept.get(hit.departmentId) ?? "a department"}`;
  if (hit.roleId) return `through the job title ${words.role.get(hit.roleId) ?? "a job title"}`;
  return `through the tag ${words.tag.get(hit.tagId!) ?? "a tag"}`;
}

export async function goalPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  const goal = await loadGoal(prisma, ctx.organizationId, id);
  if (!goal) return null;
  const target = await rightsTargetOf(ctx.organizationId, goal);
  const me = await rightsOf(ctx.session, goal, target);
  // Someone who cannot see the goal never learns it exists.
  if (!me.seen) return null;
  // An Agent never shares (the house rule), whatever the goal lets it edit.
  const canManage = me.edit && !ctx.isAgent;
  const rows = await assigneeRows(prisma, id);
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const lookIds = [...new Set([...userIds, ...(goal.ownerId ? [goal.ownerId] : []), ...(target.creatorId ? [target.creatorId] : [])])];
  const users = lookIds.length
    ? await prisma.user.findMany({ where: { id: { in: lookIds }, organizationId: ctx.organizationId, deletedAt: null }, select: { ...USER_SELECT, accessLevel: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const owner = goal.ownerId ? byId.get(goal.ownerId) ?? null : null;
  const ownerName = nameOf(owner);

  const direct: AccessDirectEntry[] = [];
  if (owner) direct.push({ person: personOf(owner), role: "FULL", owner: true, source: "Owner", editable: false, removable: false, lastFull: false, cap: false, alsoVia: null });
  for (const uid of userIds) {
    const u = byId.get(uid);
    if (!u || uid === goal.ownerId) continue;
    const entry: AccessDirectEntry = { person: personOf(u), role: "EDIT", owner: false, source: "GoalAssignee", editable: false, removable: canManage, lastFull: false, cap: false, alsoVia: null };
    // A contributor row never gives editing: the viewer who edits keeps that
    // when their own row goes, unless the row was their only way to see it.
    if (uid === ctx.userId && canManage && me.actor && (await seesWithoutOwnRow(ctx.session, goal))) {
      const source = rightsSource(me.actor, goal, target, ctx.userId, false);
      entry.alsoVia = { role: "EDIT", via: { type: "rule", text: RIGHTS_WORDS[source].via(ownerName ?? "the owner") } };
    }
    direct.push(entry);
  }
  direct.sort((a, b) => Number(b.owner) - Number(a.owner) || a.person.name.localeCompare(b.person.name));

  const orgName = await orgNameOf(ctx.organizationId);
  const notes: string[] = [];
  if (goal.level === "COMPANY") notes.push(`Everyone at ${orgName} can view this Company goal.`);
  if (goal.level === "DEPARTMENT" && goal.departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: goal.departmentId, organizationId: ctx.organizationId }, select: { name: true } });
    if (dept) notes.push(`Everyone in ${dept.name} can view this Department goal.`);
  }
  const groups = rows.filter((r) => !r.userId);
  if (groups.length > 0) {
    const words = await groupWords(ctx.organizationId, groups);
    for (const r of groups) {
      if (r.departmentId && words.dept.has(r.departmentId)) notes.push(`Everyone in ${words.dept.get(r.departmentId)} can check in.`);
      else if (r.roleId && words.role.has(r.roleId)) notes.push(`Everyone with the job title ${words.role.get(r.roleId)} can check in.`);
      else if (r.tagId && words.tag.has(r.tagId)) notes.push(`Everyone tagged ${words.tag.get(r.tagId)} can check in.`);
    }
    notes.push("Departments, job titles and tags change on the goal's Contributors row.");
  }
  if (goal.level !== "COMPANY") {
    if (ownerName) notes.push(`Anyone ${ownerName} reports to can view it, and edit it if they are a team lead or above.`);
    else if (!goal.ownerId) notes.push("It has no owner, so team leads and above can view it.");
    if (rows.length > 0) notes.push("Anyone a contributor reports to can view it.");
    // The creator edits it only while they can see it (canSeeGoal has no creator door).
    const creator = target.creatorId && target.creatorId !== goal.ownerId ? byId.get(target.creatorId) : null;
    if (creator && (await canSeeGoal(sessionFor(creator.id, ctx.organizationId, String(creator.accessLevel)), goal))) notes.push(`${nameOf(creator)} made it and can edit it.`);
  }
  // By member type, as canSeeGoal reads it; the People team (the HR member type
  // or the list in Settings, Access) edits only the goals it can see.
  notes.push("Anyone whose member type is Executive, VP, Director or People team sees every goal. The People team can edit any goal they can see.");

  return {
    node: { kind: KIND, id: goal.id, name: goal.title, noun: ACCESS_NODE_NOUN[KIND], href: hrefOf(goal.id), space: null, notepadOwner: null },
    viewer: { role: me.del ? "FULL" : me.edit ? "EDIT" : "VIEW", canManage, maxGrant: canManage ? "EDIT" : null, isAgent: ctx.isAgent },
    roles: ROLES_BY_KIND[KIND],
    general: NO_GENERAL,
    direct,
    inherited: [],
    inheritedMore: [],
    hiddenInherited: [],
    everyone: null,
    admins: { count: await orgAdminCount(ctx.organizationId) },
    notes,
    orgName,
    grantsAvailable: true,
  };
}

async function freshPanel(ctx: ObjectShareCtx, id: string): Promise<AccessPanel | null> {
  return goalPanel(ctx, id).catch(() => null);
}

/** The actor's right to change who contributes, after locking the goal row. */
async function actorGate(tx: Tx, ctx: ObjectShareCtx, id: string): Promise<GoalRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "OKR" WHERE id = ${id} AND "organizationId" = ${ctx.organizationId} FOR UPDATE`;
  if (locked.length === 0) throw new GrantError("not_found");
  const goal = await loadGoal(tx, ctx.organizationId, id);
  if (!goal) throw new GrantError("not_found");
  const me = await rightsOf(ctx.session, goal, await rightsTargetOf(ctx.organizationId, goal));
  if (!me.seen) throw new GrantError("not_found");
  if (!me.edit || ctx.isAgent) throw new GrantError("forbidden");
  return goal;
}

async function withFreshPanel<T>(ctx: ObjectShareCtx, id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrantError && err.code === "conflict") err.panel = await freshPanel(ctx, id);
    throw err;
  }
}

export async function setGoalGrant(ctx: ObjectShareCtx, id: string, body: GrantWriteBody): Promise<GrantWriteResult> {
  if (body.role !== "EDIT") throw new GrantError("invalid_role");
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const goal = await actorGate(tx, ctx, id);
      if (!(await targetInOrg(tx, ctx.organizationId, body.userId))) throw new GrantError("not_in_org");
      if (goal.ownerId === body.userId) throw new GrantError("owner_fixed");
      const cur = await tx.goalAssignee.findFirst({ where: { okrId: id, userId: body.userId }, select: { id: true } });
      const curRole: PanelRole | null = cur ? "EDIT" : null;
      if (body.expected !== undefined && (body.expected ?? null) !== curRole) throw new GrantError("conflict");
      if (cur) return { noChange: true, previousRole: curRole, role: curRole };
      await tx.goalAssignee.create({ data: { okrId: id, userId: body.userId } });
      await objectActivity(tx, ctx, KIND, id, "access.granted", { granteeId: body.userId, role: "EDIT", previousRole: null, store: "GoalAssignee" });
      return { noChange: false, previousRole: null, role: "EDIT" as PanelRole };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const panel = await freshPanel(ctx, id);
  if (!out.noChange) {
    if (panel) await notifyObjectGrantee(ctx, KIND, { id, name: panel.node.name, href: panel.node.href }, body.userId, "EDIT", "shared");
    // As the goal's Contributors row does: adding someone by name answers
    // every open Request they made on this goal.
    if (body.userId !== ctx.userId) {
      await resolveRequestsFor({ organizationId: ctx.organizationId, objectTypes: [KIND], objectId: id, requesterId: body.userId, roles: null, deciderId: ctx.userId });
    }
  }
  const change: GrantChange = { userId: body.userId, role: out.role, previousRole: out.previousRole, noChange: out.noChange, stillReaches: null, keepsInside: [] };
  return { panel, change };
}

export async function removeGoalGrant(ctx: ObjectShareCtx, id: string, input: { userId: string; expected?: PanelRole | null }): Promise<GrantWriteResult> {
  const out = await withFreshPanel(ctx, id, () =>
    prisma.$transaction(async (tx) => {
      const goal = await actorGate(tx, ctx, id);
      if (goal.ownerId === input.userId) throw new GrantError("owner_fixed");
      const cur = await tx.goalAssignee.findFirst({ where: { okrId: id, userId: input.userId }, select: { id: true } });
      const curRole: PanelRole | null = cur ? "EDIT" : null;
      // Removing a row that is not there changed nothing: a retry is a
      // success, whatever role the retry still names.
      if (!cur) return { noChange: true, previousRole: null, goal };
      if (input.expected !== undefined && (input.expected ?? null) !== curRole) throw new GrantError("conflict");
      await tx.goalAssignee.deleteMany({ where: { okrId: id, userId: input.userId } });
      await objectActivity(tx, ctx, KIND, id, "access.revoked", { granteeId: input.userId, role: null, previousRole: "EDIT", store: "GoalAssignee" });
      return { noChange: false, previousRole: curRole, goal };
    }, { timeout: 20_000, maxWait: 10_000 }),
  );
  const [panel, stillReaches] = await Promise.all([freshPanel(ctx, id), out.noChange ? null : stillReachesGoal(ctx, out.goal, input.userId)]);
  const change: GrantChange = { userId: input.userId, role: null, previousRole: out.previousRole, noChange: out.noChange, stillReaches, keepsInside: [] };
  return { panel, change };
}

/** What a person keeps on a goal after their own row went, by the live rules. */
async function stillReachesGoal(ctx: ObjectShareCtx, goal: GoalRow, userId: string): Promise<{ role: PanelRole; via: AccessVia } | null> {
  const facts = await goalFacts(ctx.organizationId, goal, userId);
  if (!facts) return null;
  if (facts.group) return { role: "EDIT", via: { type: "rule", text: facts.group } };
  if (facts.edit) return { role: "EDIT", via: { type: "rule", text: "because they can edit this goal" } };
  if (facts.seen) return { role: "VIEW", via: { type: "rule", text: facts.viewWhy ?? "by the goal's rules" } };
  return null;
}

/** The live answer for one person: see, edit, delete, contribute, and why, in sentences. */
async function goalFacts(organizationId: string, goal: GoalRow, userId: string) {
  const person = await prisma.user.findFirst({
    where: { id: userId, organizationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, departmentId: true, roleId: true },
  });
  if (!person) return null;
  const level = String(person.accessLevel);
  const session = sessionFor(person.id, organizationId, level);
  const target = await rightsTargetOf(organizationId, goal);
  const seen = await canSeeGoal(session, goal);
  const actor = seen ? await goalRightsActor(session) : null;
  const edit = !!actor && mayEditGoal(actor, target);
  const del = !!actor && mayDeleteGoal(actor, target);
  const rows = await assigneeRows(prisma, goal.id);
  const ownRow = rows.some((r) => r.userId === person.id);
  const group = ownRow ? null : await groupContribution(organizationId, rows, person);
  const owner = goal.ownerId ? await prisma.user.findFirst({ where: { id: goal.ownerId, organizationId }, select: { firstName: true, lastName: true, email: true } }) : null;
  const ownerName = nameOf(owner) ?? "the owner";

  // A delete is put down to what grants it (never the People team).
  const editWhy = actor && edit ? rightsReason(actor, goal, target, person.id, ownerName, del) : null;
  let viewWhy: string | null = null;
  if (seen) {
    if (ORG_WIDE_ALIGNMENT_LEVELS.has(level)) viewWhy = "through their workspace role, which sees every goal";
    else if (goal.level === "COMPANY") viewWhy = "as everyone does on a Company goal";
    else if (goal.level === "DEPARTMENT" && goal.departmentId && goal.departmentId === person.departmentId) viewWhy = "as a member of the goal's department";
    else if (!goal.ownerId) viewWhy = "as a team lead or above, who see goals without an owner";
    else viewWhy = `as someone ${ownerName} or a contributor reports to`;
  }
  return { name: nameOf(person)!, seen, edit, del, ownRow, group, editWhy, viewWhy };
}

/** Check access: what one person can do with this goal, and why. */
export async function checkGoalAccess(
  ctx: ObjectShareCtx,
  id: string,
  userId: string,
): Promise<{ userId: string; name: string; role: string; sentence: string } | "not_found" | "forbidden" | "not_in_org"> {
  const goal = await loadGoal(prisma, ctx.organizationId, id);
  if (!goal) return "not_found";
  const me = await rightsOf(ctx.session, goal, await rightsTargetOf(ctx.organizationId, goal));
  if (!me.seen) return "not_found";
  if (!me.edit || ctx.isAgent) return "forbidden";
  const f = await goalFacts(ctx.organizationId, goal, userId);
  if (!f) return "not_in_org";
  if (f.del) return { userId, name: f.name, role: "FULL", sentence: `Full access: edit, check in and delete. ${f.editWhy}` };
  if (f.edit) return { userId, name: f.name, role: "EDIT", sentence: `Can edit and check in, not delete. ${f.editWhy}` };
  if (f.ownRow) return { userId, name: f.name, role: "EDIT", sentence: "Can check in. Added as a contributor." };
  if (f.group) return { userId, name: f.name, role: "EDIT", sentence: `Can check in, ${f.group}.` };
  if (f.seen) return { userId, name: f.name, role: "VIEW", sentence: `Can view, ${f.viewWhy}.` };
  return { userId, name: f.name, role: "none", sentence: "No access. Nothing shares this goal with them." };
}
