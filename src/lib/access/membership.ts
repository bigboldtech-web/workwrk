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
  { value: "HR", label: "People team (HR)" },
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

/** Owners and Admins of one org, live, oldest first (the guard's input). */
export async function liveAdminsOf(db: Db, organizationId: string) {
  return db.user.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    select: { id: true, accessLevel: true, createdAt: true, firstName: true, lastName: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export interface AppliedRoleChange {
  ok: true;
  changed: boolean;
  before: { level: string; role: MemberRole };
  after: { level: string; role: MemberRole };
  bumped: boolean;
}

/**
 * Apply one role change in `db` (inside the caller's transaction when there
 * is one). Returns what moved so the caller writes the audit row.
 */
export async function applyRoleChange(
  db: Db,
  input: { organizationId: string; actorId: string; actorIsOwner: boolean; actorIsAdmin: boolean; targetId: string; next: { role: MemberRole; tier?: string | null } },
): Promise<AppliedRoleChange | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  const target = await db.user.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, accessLevel: true, createdAt: true },
  });
  if (!target) return { ok: false, status: 404, error: "Not found" };
  const admins = await liveAdminsOf(db, input.organizationId);
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  const plan = planRoleChange({
    actorId: input.actorId,
    actorIsOwner: input.actorIsOwner,
    actorIsAdmin: input.actorIsAdmin,
    target: { id: target.id, level: target.accessLevel, isOwner: owners.includes(target.id), createdAt: target.createdAt },
    admins: admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })),
    next: input.next,
  });
  if (!plan.ok) return plan;
  if (!plan.changed) {
    return { ok: true, changed: false, before: { level: target.accessLevel, role: plan.beforeRole }, after: { level: target.accessLevel, role: plan.afterRole }, bumped: false };
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
    before: { level: target.accessLevel, role: plan.beforeRole },
    after: { level: plan.level, role: plan.afterRole },
    bumped: plan.bump,
  };
}

export type OwnershipResult =
  | { ok: true; targetId: string; targetName: string; targetBefore: MemberRole; selfDemoted: boolean; selfVersion: { from: number; to: number } | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

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
    const target = await tx.user.findFirst({
      where: { id: input.targetId, organizationId: input.organizationId, deletedAt: null, status: { not: "INACTIVE" } },
      select: { id: true, accessLevel: true, firstName: true, lastName: true, email: true, createdAt: true },
    });
    if (!target) return { ok: false as const, status: 404 as const, error: "That person is not an active member of this workspace" };
    if (target.accessLevel === "AGENT") return { ok: false as const, status: 400 as const, error: "An Agent cannot be an Owner" };

    const admins = await liveAdminsOf(tx, input.organizationId);
    const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
    const targetBefore = memberRoleOf(target.accessLevel, owners.includes(target.id));

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
    for (const id of owners) {
      const a = admins.find((x) => x.id === id);
      if (a && a.accessLevel === "COMPANY_ADMIN" && id !== input.actorId) {
        await tx.user.update({ where: { id }, data: { accessLevel: "SUPER_ADMIN" } });
      }
    }
    if (target.accessLevel !== "SUPER_ADMIN") {
      await tx.user.update({ where: { id: target.id }, data: { accessLevel: "SUPER_ADMIN" } });
      await tx.organizationMembership.updateMany({ where: { userId: target.id, organizationId: input.organizationId }, data: { role: "SUPER_ADMIN" } });
    }

    let selfVersion: { from: number; to: number } | null = null;
    if (input.removeMe) {
      const me = await tx.user.update({
        where: { id: input.actorId },
        data: { accessLevel: "COMPANY_ADMIN", tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      });
      await tx.organizationMembership.updateMany({ where: { userId: input.actorId, organizationId: input.organizationId }, data: { role: "COMPANY_ADMIN" } });
      selfVersion = { from: me.tokenVersion - 1, to: me.tokenVersion };
    } else {
      // Keep the caller an explicit Owner too (they may be an implicit one).
      await tx.user.update({ where: { id: input.actorId }, data: { accessLevel: "SUPER_ADMIN" } });
    }

    // The guard, once more over the final state: never zero Owners.
    const finalAdmins = await liveAdminsOf(tx, input.organizationId);
    const finalOwners = ownerIdsOf(finalAdmins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
    if (!finalOwners.includes(target.id)) throw new Error("ownership transfer left the target without Owner");

    const targetName = `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim() || target.email;
    return { ok: true as const, targetId: target.id, targetName, targetBefore, selfDemoted: input.removeMe, selfVersion };
  });
}

/**
 * The unattended recipient (SCIM, retention): the person's live manager,
 * else the org's first Owner, else null (nothing can receive the work, and
 * the caller must say so rather than orphan it).
 */
export async function unattendedRecipient(organizationId: string, personId: string): Promise<string | null> {
  const person = await prisma.user.findFirst({ where: { id: personId, organizationId }, select: { managerId: true } });
  if (person?.managerId) {
    const m = await prisma.user.findFirst({ where: { id: person.managerId, organizationId, deletedAt: null, status: { not: "INACTIVE" } }, select: { id: true } });
    if (m && m.id !== personId) return m.id;
  }
  const admins = await prisma.user.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] }, id: { not: personId } },
    select: { id: true, accessLevel: true, createdAt: true },
  });
  const owners = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  return owners[0] ?? null;
}

/** Whether this person is one of the workspace's live Owners right now. */
export async function isLiveOwner(organizationId: string, personId: string): Promise<boolean> {
  const admins = await prisma.user.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    select: { id: true, accessLevel: true, createdAt: true },
  });
  return ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt }))).includes(personId);
}

/** Whether removing this person would leave the workspace with no live Owner. */
export async function wouldRemoveLastOwner(organizationId: string, personId: string): Promise<boolean> {
  const admins = await prisma.user.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    select: { id: true, accessLevel: true, createdAt: true },
  });
  const before = ownerIdsOf(admins.map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  if (!before.includes(personId)) return false;
  const after = ownerIdsOf(admins.filter((a) => a.id !== personId).map((a) => ({ id: a.id, level: a.accessLevel, createdAt: a.createdAt })));
  return after.length === 0;
}
