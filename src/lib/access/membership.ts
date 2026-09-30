// Membership changes on a person's org role (settings-architecture 5.5 and
// 9.2a; access-model-spec 2.1 and invariants 10 and 13): the one place that
// decides who may move someone between Owner, Admin and Member, and what
// that writes. Server callers: PATCH /api/users/[id] (the Members drawer),
// the bulk role change, POST /api/settings/ownership.
//
// THE STORE IS STILL User.accessLevel (step 0 of the access track: there is
// no orgRole column yet), so the four roles are written through the mirror:
//
//   Owner   SUPER_ADMIN (a customer's SUPER_ADMIN runs THEIR workspace,
//           src/lib/platform-admin.ts; staff live in PlatformAdmin)
//   Admin   COMPANY_ADMIN
//   Member  one of the member-type levels, which still decide which manager
//           pages open until the engine flips (the "tier" below); nothing an
//           admin could set yesterday is taken away
//
// An Owner is SUPER_ADMIN or the org's earliest live COMPANY_ADMIN
// (ownerIdsOf, src/lib/admin/companies-list.ts; org-role.ts spec 2.1).
//
// The rules, each a guard below:
//   1. Only Owners and Admins change roles.
//   2. Only an Owner makes someone an Owner or changes an Owner's role.
//   3. SUPER_ADMIN is never offered as a tier (Owner is chosen as a role).
//   4. The workspace always keeps at least one Owner (last-Owner guard).
//   5. A change that is not a strict promotion bumps the person's
//      tokenVersion, so lowered access lands on their very next request; a
//      promotion does not sign anyone out (it lands within the five-minute
//      revalidation), which is the Staff console's Set Owner decision too.

import type { Prisma, PrismaClient } from "@/generated/prisma";
import { ownerIdsOf } from "@/lib/admin/companies-list";
import { LEGACY_ADMIN_LEVELS } from "./legacy-levels";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

/** The member-type tiers an admin may set, in the words a person reads. */
export const MEMBER_TIERS: readonly { value: string; label: string }[] = [
  { value: "EMPLOYEE", label: "Member" },
  { value: "TEAM_LEAD", label: "Team lead" },
  { value: "MANAGER", label: "Manager" },
  { value: "DIRECTOR", label: "Director" },
  { value: "VP", label: "VP" },
  { value: "C_LEVEL", label: "Executive" },
  { value: "HR", label: "People team" },
  { value: "AGENT", label: "Agent" },
];
const MEMBER_TIER_SET = new Set(MEMBER_TIERS.map((t) => t.value));

export function isMemberTier(level: string | null | undefined): boolean {
  return !!level && MEMBER_TIER_SET.has(level);
}

export function tierLabel(level: string | null | undefined): string {
  return MEMBER_TIERS.find((t) => t.value === level)?.label ?? "Member";
}

/** The role word for a stored level and Owner status (pure; tested). */
export function memberRoleOf(level: string | null | undefined, isOwner: boolean): MemberRole {
  if (isOwner || level === "SUPER_ADMIN") return "OWNER";
  if (level === "COMPANY_ADMIN") return "ADMIN";
  return "MEMBER";
}

function rank(level: string, isOwner: boolean): number {
  if (isOwner) return 5;
  if (level === "SUPER_ADMIN") return 5;
  if (level === "COMPANY_ADMIN") return 4;
  if (level === "EMPLOYEE") return 1;
  if (level === "AGENT") return 0;
  return 2; // the manager-tier levels and HR
}

export interface RoleChangeInput {
  actorId: string;
  actorIsOwner: boolean;
  actorIsAdmin: boolean;
  target: { id: string; level: string; isOwner: boolean; createdAt: Date | string };
  /** Every live Owner and Admin candidate, for the last-Owner guard. */
  admins: { id: string; level: string; createdAt: Date | string }[];
  next: { role: MemberRole; tier?: string | null };
}

export type RoleChangePlan =
  | { ok: true; level: string; changed: boolean; bump: boolean; beforeRole: MemberRole; afterRole: MemberRole }
  | { ok: false; status: 400 | 403 | 409; error: string };

/** Decide one role change (pure; tested). */
export function planRoleChange(input: RoleChangeInput): RoleChangePlan {
  const { target, next } = input;
  if (!input.actorIsAdmin) return { ok: false, status: 403, error: "Only Owners and Admins change roles" };
  const beforeRole = memberRoleOf(target.level, target.isOwner);

  let level: string;
  if (next.role === "OWNER") level = "SUPER_ADMIN";
  else if (next.role === "ADMIN") level = "COMPANY_ADMIN";
  else {
    const tier = next.tier ?? (isMemberTier(target.level) ? target.level : "EMPLOYEE");
    if (!isMemberTier(tier)) return { ok: false, status: 400, error: "Pick a tier from the list" };
    level = tier;
  }

  const touchesOwner = next.role === "OWNER" || beforeRole === "OWNER";
  if (touchesOwner && !input.actorIsOwner) {
    return { ok: false, status: 403, error: "Only an Owner can make someone an Owner or change an Owner's role" };
  }

  const changed = level !== target.level || (beforeRole === "OWNER" && next.role !== "OWNER");
  if (!changed) return { ok: true, level, changed: false, bump: false, beforeRole, afterRole: beforeRole };

  // Last-Owner guard: recompute the Owners with this one change applied.
  const after = input.admins
    .filter((a) => a.id !== target.id)
    .concat(LEGACY_ADMIN_LEVELS.has(level) ? [{ id: target.id, level, createdAt: target.createdAt }] : []);
  const ownersAfter = ownerIdsOf(after.map((a) => ({ id: a.id, level: a.level, createdAt: a.createdAt })));
  if (ownersAfter.length === 0) {
    return { ok: false, status: 409, error: "The workspace needs at least one Owner. Make someone else an Owner first." };
  }
  const afterRole = memberRoleOf(level, ownersAfter.includes(target.id));
  // Under the step-0 mapping an Admin who joined before every other admin is
  // an Owner by that fact, so making such a person an Admin makes them an
  // Owner: rule 2 applies to that too.
  if (afterRole === "OWNER" && beforeRole !== "OWNER" && !input.actorIsOwner) {
    return { ok: false, status: 403, error: "Only an Owner can do this: this person joined before the current Owner, so as an Admin they would be an Owner too" };
  }
  const bump = !(rank(level, afterRole === "OWNER") > rank(target.level, target.isOwner));
  return { ok: true, level, changed: true, bump, beforeRole, afterRole };
}

/**
 * Owners and Admins of one org, live, oldest first (the guard's input).
 *
 * ONE answer to "who is an Owner here", the same set as ownerIdsFor
 * (src/lib/admin/company-detail.ts): people anchored in this workspace
 * (User.organizationId) AND people who hold an admin membership here while
 * switched into another workspace (OrganizationMembership.role). `anchored`
 * says which row holds the role, so a write lands on the right one.
 */
export async function liveAdminsOf(db: Db, organizationId: string) {
  const [anchored, members] = await Promise.all([
    db.user.findMany({
      where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
      select: { id: true, accessLevel: true, createdAt: true, firstName: true, lastName: true },
    }),
    db.organizationMembership.findMany({
      where: {
        organizationId,
        role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
        user: { deletedAt: null, status: { not: "INACTIVE" }, organizationId: { not: organizationId } },
      },
      select: { role: true, user: { select: { id: true, createdAt: true, firstName: true, lastName: true } } },
    }),
  ]);
  const rows = [
    ...anchored.map((u) => ({ ...u, anchored: true })),
    ...members.map((m) => ({ id: m.user.id, accessLevel: m.role, createdAt: m.user.createdAt, firstName: m.user.firstName, lastName: m.user.lastName, anchored: false })),
  ];
  return rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
}

/**
 * Serialise every change to who holds Owner or Admin in one workspace (role
 * changes, bulk changes, ownership transfer, deactivation, removal, SCIM).
 * Two Owners demoting each other at the same moment each read the admins,
 * plan, then write; without this lock both pass the last-Owner guard and
 * the workspace ends with nobody. Transaction-scoped: released on commit.
 */
export async function lockOrgRoles(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org-roles:${organizationId}`}))`;
}

function isClient(db: Db): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === "function";
}

export interface AppliedRoleChange {
  ok: true;
  changed: boolean;
  /** The person whose role this is, for the audit sentence. */
  targetName: string;
  before: { level: string; role: MemberRole };
  after: { level: string; role: MemberRole };
  bumped: boolean;
}

/**
 * Apply one role change. With the plain client it opens its own transaction;
 * inside a caller's transaction it joins it. Either way it takes the
 * workspace's role lock first and then re-reads, under the lock, whether the
 * ACTOR is still an Owner or Admin: the session's word is only an upper
 * bound, so an Admin demoted a moment ago (or an Owner who lost a race to
 * the other Owner) is refused rather than trusted until the next session
 * check. Returns what moved so the caller writes the audit row.
 */
export async function applyRoleChange(
  db: Db,
  input: { organizationId: string; actorId: string; actorIsOwner: boolean; actorIsAdmin: boolean; targetId: string; next: { role: MemberRole; tier?: string | null } },
): Promise<AppliedRoleChange | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  if (isClient(db)) return db.$transaction((tx) => applyRoleChangeIn(tx, input));
  return applyRoleChangeIn(db, input);
}

async function applyRoleChangeIn(
  db: Prisma.TransactionClient,
  input: { organizationId: string; actorId: string; actorIsOwner: boolean; actorIsAdmin: boolean; targetId: string; next: { role: MemberRole; tier?: string | null } },
): Promise<AppliedRoleChange | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  await lockOrgRoles(db, input.organizationId);
  const target = await db.user.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, accessLevel: true, createdAt: true, firstName: true, lastName: true, email: true },
  });
  if (!target) return { ok: false, status: 404, error: "Not found" };
  const admins = await liveAdminsOf(db, input.organizationId);
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  // The actor as the database has them NOW, under the lock.
  const actorStillAdmin = admins.some((a) => a.id === input.actorId);
  const actorIsAdmin = input.actorIsAdmin && actorStillAdmin;
  const actorIsOwner = input.actorIsOwner && actorStillAdmin && owners.includes(input.actorId);
  const plan = planRoleChange({
    actorId: input.actorId,
    actorIsOwner,
    actorIsAdmin,
    target: { id: target.id, level: target.accessLevel, isOwner: owners.includes(target.id), createdAt: target.createdAt },
    admins: admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })),
    next: input.next,
  });
  const targetName = `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim() || target.email;
  if (!plan.ok) return plan;
  if (!plan.changed) {
    return { ok: true, changed: false, targetName, before: { level: target.accessLevel, role: plan.beforeRole }, after: { level: target.accessLevel, role: plan.afterRole }, bumped: false };
  }
  await db.user.update({
    where: { id: target.id },
    data: { accessLevel: plan.level as never, ...(plan.bump ? { tokenVersion: { increment: 1 } } : {}) },
  });
  // The membership row for this workspace mirrors the role (the workspace
  // switcher and the fallback out of a suspended workspace read it).
  await db.organizationMembership.updateMany({
    where: { userId: target.id, organizationId: input.organizationId },
    data: { role: plan.level as never },
  });
  return {
    ok: true,
    changed: true,
    targetName,
    before: { level: target.accessLevel, role: plan.beforeRole },
    after: { level: plan.level, role: plan.afterRole },
    bumped: plan.bump,
  };
}

/** The words an audit row uses for a role: "Owner", "Admin", or the tier ("Manager"). */
export function roleWords(side: { level: string; role: MemberRole }): string {
  if (side.role === "OWNER") return "Owner";
  if (side.role === "ADMIN") return "Admin";
  return tierLabel(side.level);
}

/** "Changed Mona Manager's role from Manager to Admin", the one sentence every role-change row uses. */
export function roleChangeSentence(name: string, change: { before: { level: string; role: MemberRole }; after: { level: string; role: MemberRole } }): string {
  const from = roleWords(change.before);
  const to = roleWords(change.after);
  if (from === to) return `Updated ${name}'s role (${to})`;
  return `Changed ${name}'s role from ${from} to ${to}`;
}

export type OwnershipResult =
  | {
      ok: true;
      targetId: string;
      targetName: string;
      targetBefore: MemberRole;
      selfDemoted: boolean;
      selfVersion: { from: number; to: number } | null;
      /** Implicit Owners (the earliest Admin) written as explicit Owners, each owed its own audit row. */
      frozen: { id: string; name: string }[];
    }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * Identity > Danger zone > Transfer ownership. The target becomes an Owner
 * first; with removeMe the caller then becomes an Admin, in the same
 * transaction, so there is never a moment with no Owner.
 */
export async function transferOwnership(
  db: PrismaClient,
  input: { organizationId: string; actorId: string; targetId: string; removeMe: boolean },
): Promise<OwnershipResult> {
  if (input.targetId === input.actorId) return { ok: false, status: 400, error: "Pick someone other than yourself" };
  return db.$transaction(async (tx) => {
    await lockOrgRoles(tx, input.organizationId);
    const target = await tx.user.findFirst({
      where: { id: input.targetId, organizationId: input.organizationId, deletedAt: null, status: { not: "INACTIVE" } },
      select: { id: true, accessLevel: true, firstName: true, lastName: true, email: true, createdAt: true },
    });
    if (!target) return { ok: false as const, status: 404 as const, error: "That person is not an active member of this workspace" };
    if (target.accessLevel === "AGENT") return { ok: false as const, status: 400 as const, error: "An Agent cannot be an Owner" };

    const admins = await liveAdminsOf(tx, input.organizationId);
    const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
    const targetBefore = memberRoleOf(target.accessLevel, owners.includes(target.id));
    // The caller as the database has them now, under the lock: an Owner
    // demoted a moment ago never hands Owner on.
    if (!owners.includes(input.actorId)) {
      return { ok: false as const, status: 403 as const, error: "Only a workspace Owner can transfer ownership" };
    }

    // Stepping down only works when it would actually take: under the step-0
    // mapping the org's earliest-created admin is an Owner by that fact
    // alone, so they cannot become a plain Admin until the org role is
    // stored per person (access step 4). Say so rather than pretend.
    if (input.removeMe) {
      const sim = admins
        .map((a) => ({
          id: a.id,
          level: a.id === target.id ? "SUPER_ADMIN" : a.id === input.actorId ? "COMPANY_ADMIN" : owners.includes(a.id) ? "SUPER_ADMIN" : a.accessLevel,
          createdAt: a.createdAt,
        }))
        .concat(admins.some((a) => a.id === target.id) ? [] : [{ id: target.id, level: "SUPER_ADMIN", createdAt: target.createdAt }]);
      const earliest = [...sim].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id))[0];
      if (earliest?.id === input.actorId) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "You are this workspace's first admin, so you stay an Owner for now. Untick \"Also remove me as an Owner\" to add the new Owner.",
        };
      }
    }

    // Freeze every current implicit Owner (the earliest COMPANY_ADMIN) as an
    // explicit one first, so promoting an older account never quietly takes
    // Owner away from them (the Staff console's Set Owner rule).
    const frozen: { id: string; name: string }[] = [];
    const writeOwner = async (a: { id: string; anchored: boolean }) => {
      if (a.anchored) await tx.user.update({ where: { id: a.id }, data: { accessLevel: "SUPER_ADMIN" } });
      await tx.organizationMembership.updateMany({ where: { userId: a.id, organizationId: input.organizationId }, data: { role: "SUPER_ADMIN" } });
    };
    for (const id of owners) {
      const a = admins.find((x) => x.id === id);
      if (a && a.accessLevel === "COMPANY_ADMIN" && id !== input.actorId) {
        await writeOwner(a);
        frozen.push({ id, name: `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || "An Admin" });
      }
    }
    if (target.accessLevel !== "SUPER_ADMIN") {
      await tx.user.update({ where: { id: target.id }, data: { accessLevel: "SUPER_ADMIN" } });
      await tx.organizationMembership.updateMany({ where: { userId: target.id, organizationId: input.organizationId }, data: { role: "SUPER_ADMIN" } });
    }

    let selfVersion: { from: number; to: number } | null = null;
    if (input.removeMe) {
      const anchoredHere = admins.find((a) => a.id === input.actorId)?.anchored !== false;
      const me = await tx.user.update({
        where: { id: input.actorId },
        data: { ...(anchoredHere ? { accessLevel: "COMPANY_ADMIN" as const } : {}), tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      });
      await tx.organizationMembership.updateMany({ where: { userId: input.actorId, organizationId: input.organizationId }, data: { role: "COMPANY_ADMIN" } });
      selfVersion = { from: me.tokenVersion - 1, to: me.tokenVersion };
    } else {
      // Keep the caller an explicit Owner too (they may be an implicit one).
      const me = admins.find((a) => a.id === input.actorId);
      if (me && me.accessLevel !== "SUPER_ADMIN") {
        await writeOwner(me);
        frozen.push({ id: me.id, name: `${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() || "You" });
      }
    }

    // The guard, once more over the final state: never zero Owners.
    const finalAdmins = await liveAdminsOf(tx, input.organizationId);
    const finalOwners = ownerIdsOf(finalAdmins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
    if (!finalOwners.includes(target.id)) throw new Error("ownership transfer left the target without Owner");

    const targetName = `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim() || target.email;
    return { ok: true as const, targetId: target.id, targetName, targetBefore, selfDemoted: input.removeMe, selfVersion, frozen };
  });
}

/**
 * The unattended recipient (SCIM, retention): the person's live manager,
 * else the org's first Owner, else null (nothing can receive the work, and
 * the caller must say so rather than orphan it).
 */
export async function unattendedRecipient(organizationId: string, personId: string, db: Db = prisma): Promise<string | null> {
  const person = await db.user.findFirst({ where: { id: personId, organizationId }, select: { managerId: true } });
  if (person?.managerId) {
    const m = await db.user.findFirst({ where: { id: person.managerId, organizationId, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true } });
    if (m && m.id !== personId) return m.id;
  }
  const admins = (await liveAdminsOf(db, organizationId)).filter((a) => a.id !== personId);
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  return owners[0] ?? null;
}

/** The live Owners' ids right now (the same set as ownerIdsFor). */
export async function liveOwnerIds(organizationId: string, db: Db = prisma): Promise<string[]> {
  const admins = await liveAdminsOf(db, organizationId);
  return ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
}

/** Whether this person is one of the workspace's live Owners right now. */
export async function isLiveOwner(organizationId: string, personId: string, db: Db = prisma): Promise<boolean> {
  return (await liveOwnerIds(organizationId, db)).includes(personId);
}

/** Whether removing this person would leave the workspace with no live Owner. */
export async function wouldRemoveLastOwner(organizationId: string, personId: string, db: Db = prisma): Promise<boolean> {
  const admins = await liveAdminsOf(db, organizationId);
  const before = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  if (!before.includes(personId)) return false;
  const after = ownerIdsOf(admins.filter((a) => a.id !== personId).map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  return after.length === 0;
}
