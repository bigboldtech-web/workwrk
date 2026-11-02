// Moving a person from one workspace to another: the org switcher
// (POST /api/me/switch-org), the sign-in and session fallbacks that move
// someone out of a suspended or cancelled workspace, or off a seat ended
// where they are anchored, to a usable seat (src/lib/auth.ts, through
// workspace-status.ts moveToUsableSeat), an invitation accepted while signed
// in, the end and the restore of a seat (src/lib/access/workspace-status.ts
// endSeat, restoreSeat), and the hard delete, which moves out everyone who
// also belongs elsewhere before their home is deleted for good
// (moveHomesOutOf).
//
// Two things went wrong before. The person's access level (one column on
// User, meaning their level in the workspace they are anchored to) was
// carried into the next workspace unchanged, so someone who was an Admin at
// home arrived as an Admin wherever they went, and someone who created a new
// workspace arrived there as whatever they were at home. And the workspace
// they left kept no membership row, while the switcher lists memberships only,
// so a person who switched away from their company had no way back to it.
//
// So every move records the workspace being left as a membership carrying the
// level held there now (the first one becomes the primary, their home), and
// takes the level the target membership holds. One transaction, so the
// person is never anchored somewhere with the wrong level.
//
// THE STATUS MOVES THE SAME WAY (docs/plans/workspace-status.md D1, D10).
// User.status and User.deletedAt are the person's status and removal in the
// workspace they are anchored to; each membership holds its own (status,
// removedAt). A move keeps the person's status there and their removal
// (User.deletedAt, as removedAt) on the membership of the workspace being
// left, unless the caller names the seat it leaves (endSeat ends it as it
// moves), and the account takes the target membership's status and
// removedAt. With no membership row there, the account keeps its own. An
// account its own person erased (POST /api/me/delete) is never revived by a
// move: it keeps its deletedAt and INACTIVE whatever the target holds
// (src/lib/compliance/erased-account.ts: the erased state is a deletedAt next
// to the erasure's record, so moving it would also lose the erasure).
//
// Every move first takes the person's row lock (lockPerson), as endSeat and
// restoreSeat do, so a seat ended while the person moves into it is either
// seen by the move or sees the move.
//
// A LIVE ACCOUNT NEVER LANDS IN AN ENDED SEAT (step 1 review, H1). The swap
// would end the account itself: someone a workspace deactivated who picks it
// in the switcher (or whom a sign-in fallback sends there) would be signed
// out of every workspace, the one they came from included, which nobody
// ended. So the move refuses it, writing nothing (WouldLandEnded), unless the
// caller says the account may land ended (`mayLandEnded`). Only the hard
// delete does (moveHomesOutOf, D9): there the choice is that or the cascade.
//
// THE PROFILE MOVES THE SAME WAY (D18, the step 3 review H2): the
// department, job role, office, join date, working week, schedule, custom
// profile fields and the level's org role and Agent mirrors are the
// workspace's, so the membership left keeps them and the account takes the
// target's (a membership with no join date gives its createdAt). Personal
// details (name, photo, phone, date of birth) and the manager line stay on
// the account.
//
// The membership left is written by the person's move, so it is no longer a
// seat the one-time SQL step copied from the account (endedWithAccount, D16):
// its mark is cleared. When the seat it leaves is ended (endSeat's D3 move,
// D7's repair off an ended anchor, D6's move off one), that workspace's open
// invitations for the person's address end with it, in the same transaction
// (seat-invitations.ts, the step 2 review H1).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AccessLevel, UserStatus } from "@/generated/prisma";
import { isErasedAccount } from "@/lib/compliance/erased-account";
import { endOpenInvitations } from "./seat-invitations";
import { seatIsLive, type SeatRow } from "./workspace-seat";
import { joinedHere } from "./joined-here";

type Db = typeof prisma | Prisma.TransactionClient;

export interface Reanchor {
  userId: string;
  /** Where they go, and the role their membership there holds (the row's
   *  own role, read under the lock, wins when there is one). Where they are
   *  now, and the level they hold there, is read in the transaction. */
  to: { organizationId: string; role: AccessLevel };
  /** The seat the workspace being left keeps. By default what the person
   *  holds there now: User.status, and User.deletedAt as its removedAt.
   *  endSeat names the seat it is ending (D3). */
  leaving?: { status: UserStatus; removedAt: Date | null };
  /** True only where a live account may land ended in the target seat
   *  (the hard delete, D9); otherwise such a move throws WouldLandEnded. */
  mayLandEnded?: boolean;
}

/** Thrown, with nothing written, when a move would land a live account in a
 *  seat its target workspace ended (see the header). */
export class WouldLandEnded extends Error {
  constructor(readonly userId: string, readonly organizationId: string) {
    super(`The account ${userId} is live, and its seat in ${organizationId} is deactivated or removed: a move there would end the account everywhere, so it was not made.`);
    this.name = "WouldLandEnded";
  }
}

/** Whether an account is live where it is anchored: not removed, not deactivated. */
export function accountIsLive(row: { status: UserStatus | string; deletedAt: Date | null }): boolean {
  return row.deletedAt == null && row.status !== "INACTIVE";
}

/** Whether the membership kept for the workspace being left becomes the
 *  primary one: only when the person has no primary membership yet. */
export function leavingIsPrimary(hasPrimary: boolean): boolean {
  return !hasPrimary;
}

/**
 * The person's own row lock, for the length of the caller's transaction:
 * every write of where a person is anchored, or of their seats, takes it
 * before it reads them (reanchorUser, endSeat, restoreSeat). FOR NO KEY
 * UPDATE: it waits for, and holds off, every other write of the row, and
 * never blocks a row that only refers to the person (a foreign key check
 * takes FOR KEY SHARE).
 */
export async function lockPerson(db: Db, userId: string): Promise<void> {
  await db.$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
}

/** The key takenBySameEmail answers a (workspace, email) pair by: the address in any case. */
export function sameEmailKey(organizationId: string, email: string): string {
  return `${organizationId}\n${email.trim().toLowerCase()}`;
}

/**
 * Of these (workspace, email) pairs, the ones where an account with that
 * email, in any case, is already anchored: one mailbox is one person in a
 * workspace, so a move there is never made (the database's own unique index
 * on email and workspace compares the spelling exactly, so "Pat@x" would
 * land beside "pat@x"; the step 2 review L6). Keyed by sameEmailKey.
 */
export async function takenBySameEmail(db: Db, pairs: ReadonlyArray<{ organizationId: string; email: string }>): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const same = await db.user.findMany({
    where: { OR: pairs.map((p) => ({ organizationId: p.organizationId, email: { equals: p.email.trim(), mode: "insensitive" as const } })) },
    select: { organizationId: true, email: true },
  });
  return new Set(same.map((u) => sameEmailKey(u.organizationId, u.email)));
}

/**
 * What the account takes from the target membership: its status and its
 * removal, as User.status and User.deletedAt. Nothing with no membership row
 * there (the account keeps its own), and nothing for an erased account,
 * which no move revives.
 */
export function arrivingSeat(there: SeatRow | null, erased: boolean): { status?: UserStatus; deletedAt?: Date | null } {
  if (erased || !there) return {};
  return { status: there.status as UserStatus, deletedAt: there.removedAt };
}

/** The profile one workspace holds of a person (D18), as User and a membership both carry it. */
export const PROFILE_SELECT = {
  departmentId: true,
  roleId: true,
  officeId: true,
  joinDate: true,
  weeklyCapacityHours: true,
  workSchedule: true,
  customFields: true,
  orgRole: true,
  isAgent: true,
} as const;

/** A profile as read from either row. */
export interface WorkspaceProfile {
  departmentId: string | null;
  roleId: string | null;
  officeId: string | null;
  joinDate: Date | null;
  weeklyCapacityHours: number | null;
  workSchedule: Prisma.JsonValue | null;
  customFields: Prisma.JsonValue | null;
  orgRole: string | null;
  isAgent: boolean;
}

/** A JSON column's value for a write: a stored NULL is Prisma's DbNull. */
function jsonWrite(v: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

/**
 * The profile the workspace being left keeps on its membership (D18): the
 * one the account holds now, which is that workspace's.
 */
export function leavingProfile(now: WorkspaceProfile) {
  return {
    departmentId: now.departmentId,
    roleId: now.roleId,
    officeId: now.officeId,
    joinDate: now.joinDate,
    weeklyCapacityHours: now.weeklyCapacityHours,
    workSchedule: jsonWrite(now.workSchedule),
    customFields: jsonWrite(now.customFields),
    orgRole: now.orgRole,
    isAgent: now.isAgent,
  };
}

/**
 * The profile the account takes from the target membership (D18): that
 * workspace's own. A membership with no stored join date gives when the
 * person joined there (joined-here.ts: its createdAt, or the account's for
 * the home row, which was made at the move; the step 4 review H1). With no
 * membership row there (no caller moves into one today) the account arrives
 * with an empty profile rather than carry another workspace's.
 */
export function arrivingProfile(there: (WorkspaceProfile & { createdAt: Date; isPrimary?: boolean }) | null, account?: { createdAt: Date }) {
  return {
    departmentId: there?.departmentId ?? null,
    roleId: there?.roleId ?? null,
    officeId: there?.officeId ?? null,
    joinDate: there ? there.joinDate ?? (account ? joinedHere({ createdAt: there.createdAt, isPrimary: !!there.isPrimary }, account) : there.createdAt) : new Date(),
    weeklyCapacityHours: there?.weeklyCapacityHours ?? null,
    workSchedule: jsonWrite(there?.workSchedule),
    customFields: jsonWrite(there?.customFields),
    orgRole: there?.orgRole ?? null,
    isAgent: there?.isAgent ?? false,
  };
}

/**
 * Of the department, job role and office a membership names, the ones that
 * still exist IN the target workspace, the rest as null: what the account
 * may take on arrival. A membership names them by id with no foreign key
 * (D18), and Departments, Roles and Offices are deleted for good, so a
 * membership can hold the id of one deleted since (or, from old data, one of
 * another workspace), while User.departmentId, roleId and officeId are
 * foreign keys: writing a stale one would fail the move itself (the switch,
 * endSeat's D3, restoreSeat's D6, the sign-in and session repair, and the
 * hard delete's moveHomesOutOf, which would then fail that company's delete
 * on every run). Checked here, at the one place a membership's placement
 * reaches the account, so the delete routes need not clear the copies
 * memberships hold: a stale copy is never written anywhere and never shown
 * (every reader shows only this workspace's own rows, profile-here.ts).
 * One small read each, by id and workspace, only for the ids named.
 */
export async function placementThere(
  tx: Db,
  organizationId: string,
  there: { departmentId: string | null; roleId: string | null; officeId: string | null } | null,
): Promise<{ departmentId: string | null; roleId: string | null; officeId: string | null }> {
  if (!there) return { departmentId: null, roleId: null, officeId: null };
  const [department, role, office] = await Promise.all([
    there.departmentId ? tx.department.findFirst({ where: { id: there.departmentId, organizationId }, select: { id: true } }) : null,
    there.roleId ? tx.role.findFirst({ where: { id: there.roleId, organizationId }, select: { id: true } }) : null,
    there.officeId ? tx.office.findFirst({ where: { id: there.officeId, organizationId }, select: { id: true } }) : null,
  ]);
  return { departmentId: department?.id ?? null, roleId: role?.id ?? null, officeId: office?.id ?? null };
}

/** Moves the person; false when they were already anchored there (or are
 *  not found), so nothing changed. */
export async function reanchorUser(move: Reanchor, db?: Db): Promise<boolean> {
  const run = async (tx: Db): Promise<boolean> => {
    await lockPerson(tx, move.userId);
    const now = await tx.user.findUnique({
      where: { id: move.userId },
      select: { organizationId: true, accessLevel: true, adminScopes: true, status: true, deletedAt: true, email: true, createdAt: true, ...PROFILE_SELECT },
    });
    if (!now || now.organizationId === move.to.organizationId) return false;
    const from = { organizationId: now.organizationId, accessLevel: now.accessLevel };
    const [primary, there, erased] = await Promise.all([
      tx.organizationMembership.findFirst({ where: { userId: move.userId, isPrimary: true }, select: { id: true } }),
      tx.organizationMembership.findUnique({
        where: { userId_organizationId: { userId: move.userId, organizationId: move.to.organizationId } },
        select: { role: true, adminScopes: true, status: true, removedAt: true, createdAt: true, isPrimary: true, ...PROFILE_SELECT },
      }),
      // A live account is never erased: the consent records are read only
      // for one already removed.
      now.deletedAt ? isErasedAccount(tx, move.userId) : Promise.resolve(false),
    ]);
    // The Admin scopes are a grant of one workspace: they stay on its
    // membership, and the account takes the ones held where it goes
    // (prisma/sql/2026-10-05-membership-admin-scopes.sql). The status and
    // the removal do the same (see the header).
    if (there && accountIsLive(now) && !seatIsLive(there) && !move.mayLandEnded) throw new WouldLandEnded(move.userId, move.to.organizationId);
    const leavingScopes = now.adminScopes ?? [];
    const leaving = move.leaving ?? { status: now.status, removedAt: now.deletedAt };
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: move.userId, organizationId: from.organizationId } },
      create: {
        userId: move.userId,
        organizationId: from.organizationId,
        role: from.accessLevel,
        isPrimary: leavingIsPrimary(!!primary),
        adminScopes: leavingScopes,
        status: leaving.status,
        removedAt: leaving.removedAt,
        endedWithAccount: false,
        ...leavingProfile(now),
      },
      update: { role: from.accessLevel, adminScopes: leavingScopes, status: leaving.status, removedAt: leaving.removedAt, endedWithAccount: false, ...leavingProfile(now) },
    });
    // The seat left ended: its workspace's open invitations end with it (see the header).
    if (!seatIsLive(leaving)) await endOpenInvitations(tx, { organizationIds: [from.organizationId], email: now.email });
    // Only a department, job role and office that still exist in the target
    // workspace reach the account's foreign keys (placementThere): a stale
    // copy on the membership arrives as none. The membership left needs no
    // check: it has no key to them.
    const placed = await placementThere(tx, move.to.organizationId, there);
    await tx.user.update({
      where: { id: move.userId },
      data: {
        organizationId: move.to.organizationId,
        // The level the target row holds NOW, read under the lock (the final
        // review, integrity M2): the caller's `to.role` was read before it,
        // so a demotion committed in between (the switcher reads the row
        // outside any lock) would otherwise be lost and the old level land
        // on the account. Every caller that read it under the lock passes
        // the same value; `to.role` stands only with no row there.
        accessLevel: there?.role ?? move.to.role,
        adminScopes: there?.adminScopes ?? [],
        ...arrivingSeat(there, erased),
        // The profile is the workspace's too (D18): the one held there.
        ...arrivingProfile(there, now),
        ...placed,
      },
    });
    return true;
  };
  if (db && db !== prisma) return run(db);
  return prisma.$transaction(async (tx) => run(tx));
}

/** Which of the other workspaces a person belongs to is worth moving into
 *  when their home is deleted for good: a working one first, else one that is
 *  suspended or closed, which may yet come back. Any of them keeps the
 *  account; deleting it would take everything it did there with it. */
const KEEP_RANK: Record<string, number> = { ACTIVE: 0, TRIAL: 0, SUSPENDED: 1, CANCELLED: 2 };
/** An unknown workspace status ranks after the known ones. */
const UNKNOWN_RANK = 3;
/** An ended seat (deactivated or removed there) ranks after every live one,
 *  in the same order of workspace status among themselves (D9). */
const ENDED_RANK = 4;

export interface MembershipElsewhere {
  userId: string;
  organizationId: string;
  role: AccessLevel;
  /** That workspace's status. */
  status: string;
  /** The person's seat there: their status and removal in that workspace. */
  seat: SeatRow;
}

/** How good a home a membership is (lower is better): see KEEP_RANK and ENDED_RANK. */
export function homeRank(r: Pick<MembershipElsewhere, "status" | "seat">): number {
  const rank = KEEP_RANK[r.status] ?? UNKNOWN_RANK;
  return seatIsLive(r.seat) ? rank : ENDED_RANK + rank;
}

/** Per person, the membership to move into: the best rank (homeRank), and
 *  within it the first in the order given (primary first, then oldest, as
 *  sign-in picks). */
export function homesElsewhere(rows: readonly MembershipElsewhere[]): Map<string, Reanchor["to"]> {
  const best = new Map<string, { rank: number; to: Reanchor["to"] }>();
  for (const r of rows) {
    const rank = homeRank(r);
    const had = best.get(r.userId);
    if (!had || rank < had.rank) best.set(r.userId, { rank, to: { organizationId: r.organizationId, role: r.role } });
  }
  return new Map([...best].map(([userId, b]) => [userId, b.to]));
}

/** Thrown when someone who belongs to another workspace cannot be moved
 *  into any of them, so their company is not deleted on this run. */
export class AccountCannotMove extends Error {
  constructor(readonly userIds: string[]) {
    super(
      `${userIds.length} account(s) here also belong to other workspaces, but each of those already has an account with the same email, so they cannot move there. Merge those accounts first; until then this company is kept. Account ids: ${userIds.join(", ")}`,
    );
    this.name = "AccountCannotMove";
  }
}

/** Inside the transaction that deletes a company for good
 *  (/api/cron/org-hard-delete), before the delete: everyone whose home it is
 *  but who also belongs to another workspace is moved there, at the level
 *  held there, so their account outlives it. The delete cascades every User
 *  anchored to the company, and the anchor is only where the person last
 *  was: someone who deleted a test workspace while working in their company
 *  on another device would otherwise lose their account, their place in that
 *  company and what cascades from it there (their conversations, say).
 *
 *  EVERY membership elsewhere keeps the account, an ended one too (D9): a
 *  person removed from that workspace still worked there, and deleting the
 *  account would take their conversations, kudos, KPI readings and reviews
 *  there with it (the reverted 9877a79b did exactly that). An ended one is
 *  taken last (homeRank), and the account lands there ended: the move takes
 *  that membership's status and removal (reanchorUser), so it is kept
 *  without giving anyone access back.
 *
 *  A workspace that already has an account with the same email cannot take
 *  this one (an account is unique by email and workspace), so the next one
 *  is tried. When none can, AccountCannotMove: deleting the account would
 *  take what it did in those workspaces with it, so the company is kept
 *  until the accounts are merged. Returns how many moved.
 *
 *  THE PEOPLE ARE LOCKED BEFORE THEIR SEATS ARE READ (step 1 review, L2), in
 *  id order: a seat ended between the read and the move (endSeat takes the
 *  same lock) would otherwise rank as live, and the account would land in a
 *  seat ended a moment ago while another live one was there. */
export async function moveHomesOutOf(organizationId: string, tx: Prisma.TransactionClient): Promise<number> {
  const candidates = await tx.organizationMembership.findMany({
    where: { user: { organizationId }, organizationId: { not: organizationId } },
    select: { userId: true },
  });
  for (const userId of [...new Set(candidates.map((c) => c.userId))].sort()) await lockPerson(tx, userId);
  const rows = await tx.organizationMembership.findMany({
    where: { user: { organizationId }, organizationId: { not: organizationId } },
    select: {
      userId: true,
      organizationId: true,
      role: true,
      status: true,
      removedAt: true,
      organization: { select: { status: true } },
      user: { select: { email: true } },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) return 0;
  const taken = await takenBySameEmail(tx, rows.map((r) => ({ organizationId: r.organizationId, email: r.user.email })));
  const open = rows.filter((r) => !taken.has(sameEmailKey(r.organizationId, r.user.email)));
  const homes = homesElsewhere(
    open.map((r) => ({ userId: r.userId, organizationId: r.organizationId, role: r.role, status: r.organization.status, seat: { status: r.status, removedAt: r.removedAt } })),
  );
  const stuck = [...new Set(rows.map((r) => r.userId))].filter((id) => !homes.has(id));
  if (stuck.length > 0) throw new AccountCannotMove(stuck);
  let moved = 0;
  for (const [userId, to] of homes) {
    // The one move that may land a live account ended (D9): that, or the cascade.
    if (await reanchorUser({ userId, to, mayLandEnded: true }, tx)) moved += 1;
  }
  return moved;
}
