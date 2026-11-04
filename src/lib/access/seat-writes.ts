// The one place a person's manager line, dotted lines and profile in ONE
// workspace are written (docs/plans/workspace-status-2.md E1, E2, E7, E16,
// step 1). A person's seat in a workspace is their account row where they
// are anchored and their membership row everywhere else
// (workspace-status.md D1), and since E1 the seat's row also holds their
// manager there and since D18 their profile there. Every writer used to
// write User in place, and a copy of the two-row rule in each route is how
// phase 1's races happened; so the rule lives here once, and the contract
// test (workspace-lines.contract.test.ts) lists every writer that is not
// yet here.
//
// GUARDED AS applyRoleChangeIn's TWO WRITES ARE (membership.ts). The caller
// reads the seat (personSeatIn, with the account's organizationId) and names
// it (SeatRef: the workspace, and where the account was anchored when read).
// Each write takes the person's row lock first (lockPerson, the lock every
// move between workspaces takes), then lands only on that row while it
// still holds the seat: the account while it is anchored HERE and not
// removed, or the membership here while it is not removed and its account
// is still anchored where it was read. A move that landed in between (a
// switch, an invitation, an end) makes the write touch nothing, and the
// answer is false: nothing written, the caller refuses ("seat_changed")
// and the person tries again. Without the lock a move committing at the
// same moment read the target membership before this write and carried the
// old line onto the account, and the new one was left on a row nobody reads.
//
// THE LOCK ORDER (workspace-anchor.ts lockPerson): this workspace's role
// lock first (membership.ts lockOrgRoles, which every line write needs for
// rule 6 and the loop check), then people's row locks, several in id order
// (moveLinesHere). The caller checks the manager (managerCandidateIn,
// wouldLoopIn) under the role lock; these functions decide only which row
// the write lands on. They never write another workspace's row, and the
// anchored workspace's own stale membership row is never written as its
// line or profile (no reader takes it; the move overwrites it on leaving).
//
// Lives under src/lib/access/: it decides which row holds a seat.

import { Prisma } from "@/generated/prisma";
import { lockPeople, lockPerson } from "./workspace-anchor";

type Tx = Prisma.TransactionClient;

/** Which row holds a person's seat in a workspace, as the caller read it. */
export interface SeatRef {
  userId: string;
  /** The workspace written in. */
  organizationId: string;
  /** The workspace the account was anchored in when the seat was read: this one, or the one a membership person is anchored in. */
  anchoredIn: string;
}

/** The SeatRef for an account row read with its organizationId. */
export function seatRefOf(organizationId: string, account: { id: string; organizationId: string }): SeatRef {
  return { userId: account.id, organizationId, anchoredIn: account.organizationId };
}

/** Whether the account row holds this seat (anchored here), as read. */
export function holdsOnAccount(seat: SeatRef): boolean {
  return seat.anchoredIn === seat.organizationId;
}

/** The account row, while it still holds the seat here: anchored here, not removed. */
function accountHolds(seat: SeatRef): Prisma.UserWhereInput {
  return { id: seat.userId, organizationId: seat.organizationId, deletedAt: null };
}

/** The membership row here, while it still holds the seat: not removed, its account still anchored where it was read. */
function membershipHolds(seat: SeatRef): Prisma.OrganizationMembershipWhereInput {
  return { userId: seat.userId, organizationId: seat.organizationId, removedAt: null, user: { organizationId: seat.anchoredIn } };
}

/** Thrown for a write no caller may ask: a line from a person to themselves. Nothing is written. */
export class SelfLine extends Error {
  constructor(readonly userId: string) {
    super(`A person can't be their own manager (${userId}).`);
    this.name = "SelfLine";
  }
}

/**
 * Writes the person's manager in THIS workspace (E1): User.managerId when
 * the seat is the account's, the membership's managerId otherwise. `null`
 * clears it. The caller holds the role lock and has checked the manager.
 * False, with nothing written, when the row no longer holds the seat.
 */
export async function writeLineHere(tx: Tx, seat: SeatRef, managerId: string | null): Promise<boolean> {
  if (managerId === seat.userId) throw new SelfLine(seat.userId);
  await lockPerson(tx, seat.userId);
  if (holdsOnAccount(seat)) {
    const n = await tx.user.updateMany({ where: accountHolds(seat), data: { managerId } });
    return n.count > 0;
  }
  const n = await tx.organizationMembership.updateMany({ where: membershipHolds(seat), data: { managerId } });
  return n.count > 0;
}

/** One group of a handover's line moves: these people, from the leaver to `to` (null: no manager). */
export interface LineMove {
  to: string | null;
  ids: readonly string[];
}

/** The people of a LineMove whose line here really moved. */
export interface LineMoved {
  to: string | null;
  ids: string[];
}

/**
 * Moves the lines here of people who report to `fromId` in this workspace
 * (the handover, the Agent move: E4, E6). Each row is conditioned on still
 * naming the leaver HERE: the account half (people anchored here, User's
 * line) and then the membership half (people here through a membership,
 * its line), each not removed. The people are locked first, in id order, so
 * a move between workspaces landing at the same moment either committed
 * before (and whichever row holds the line now is the one written) or
 * waits for this one (and carries the new line with it). A line in another
 * workspace is never touched: B's handover of Dana moves B's lines only.
 * Answers, per move, exactly the people whose line moved (the rows the
 * writes returned), for the caller's audit rows. The caller holds the role
 * lock and planned the moves under it. A caller that already holds another
 * person's lock in the same transaction (the leaver's, for an end) takes
 * these after it, so two ends can cross without crossing id order (the step
 * 1 review L5): with lines per workspace (E5), Pat can manage Dana in A
 * while Dana leads Pat in B, and Pat's end in A (Pat, then Dana) meets
 * Dana's end in B (Dana, then Pat) under two different role locks. Postgres
 * ends one of the two (40P01) with nothing written; step 4's callers answer
 * it as the role-busy "try again", never a 500. A crossing with another
 * transaction taking the same people in id order ends the same way.
 */
export async function moveLinesHere(
  tx: Tx,
  input: { organizationId: string; fromId: string; moves: readonly LineMove[] },
): Promise<LineMoved[]> {
  const { organizationId, fromId } = input;
  const everyone = [...new Set(input.moves.flatMap((m) => m.ids))].filter((id) => id && id !== fromId).sort();
  for (const id of everyone) await lockPerson(tx, id);
  const out: LineMoved[] = [];
  for (const move of input.moves) {
    const ids = [...new Set(move.ids)].filter((id) => id && id !== fromId && id !== move.to);
    if (ids.length === 0) {
      out.push({ to: move.to, ids: [] });
      continue;
    }
    const anchored = await tx.user.updateManyAndReturn({
      where: { id: { in: ids }, organizationId, deletedAt: null, managerId: fromId },
      data: { managerId: move.to },
      select: { id: true },
    });
    const members = await tx.organizationMembership.updateManyAndReturn({
      where: { userId: { in: ids }, organizationId, removedAt: null, managerId: fromId, user: { organizationId: { not: organizationId }, deletedAt: null } },
      data: { managerId: move.to },
      select: { userId: true },
    });
    out.push({ to: move.to, ids: [...anchored.map((r) => r.id), ...members.map((r) => r.userId)].sort() });
  }
  return out;
}

/** A profile change in this workspace (E7). Only the keys present are written; the join date has no write door (E7). */
export interface ProfilePatch {
  departmentId?: string | null;
  roleId?: string | null;
  officeId?: string | null;
  weeklyCapacityHours?: number | null;
  workSchedule?: Prisma.InputJsonValue | null;
  /** The profile fields, merged key by key: `set` written over, `remove` taken off, every other key kept. */
  customFields?: { set: Record<string, unknown>; remove: readonly string[] };
}

/** A stored value of customFields as an object to merge into (anything else reads as empty, as the SQL merge does). */
function fieldsObject(v: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/**
 * Writes the person's profile in THIS workspace (D18, E7): the account's
 * columns when the seat is the account's, the membership's otherwise. The
 * profile fields are merged key by key with what that row holds (read under
 * the person's lock, so no other write of them lands between the read and
 * the write: every writer of them takes the same lock). The caller checks
 * that a department, job role and office are this workspace's own, and the
 * field keys this workspace's definitions. False, with nothing written,
 * when the row no longer holds the seat.
 */
export async function writeProfileHere(tx: Tx, seat: SeatRef, patch: ProfilePatch): Promise<boolean> {
  await lockPerson(tx, seat.userId);
  const data: Record<string, unknown> = {};
  for (const k of ["departmentId", "roleId", "officeId", "weeklyCapacityHours"] as const) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.workSchedule !== undefined) data.workSchedule = patch.workSchedule === null ? Prisma.DbNull : patch.workSchedule;
  const onAccount = holdsOnAccount(seat);
  if (patch.customFields) {
    const held = onAccount
      ? await tx.user.findFirst({ where: accountHolds(seat), select: { customFields: true } })
      : await tx.organizationMembership.findFirst({ where: membershipHolds(seat), select: { customFields: true } });
    if (!held) return false;
    const merged = fieldsObject(held.customFields);
    for (const key of patch.customFields.remove) delete merged[key];
    Object.assign(merged, patch.customFields.set);
    data.customFields = merged as Prisma.InputJsonValue;
  }
  if (Object.keys(data).length === 0) {
    // Nothing to write: still say whether the seat stands, as a write would.
    return onAccount ? (await tx.user.count({ where: accountHolds(seat) })) > 0 : (await tx.organizationMembership.count({ where: membershipHolds(seat) })) > 0;
  }
  const n = onAccount
    ? await tx.user.updateMany({ where: accountHolds(seat), data: data as Prisma.UserUncheckedUpdateManyInput })
    : await tx.organizationMembership.updateMany({ where: membershipHolds(seat), data: data as Prisma.OrganizationMembershipUncheckedUpdateManyInput });
  return n.count > 0;
}

/**
 * One department here for many people at once (a SCIM Group's member add,
 * remove and replace, scim-groups.ts): the rows and guards writeProfileHere
 * applies to each person's seat, in one statement per half instead of one
 * transaction per person (the step 9 live proof: a Group PUT of 5,000 took
 * about 21 seconds that way).
 * - The people are locked first, in id order, in one statement (lockPeople),
 *   so a move landing meanwhile waits, or lands first and the guards below
 *   see it, exactly as for one person.
 * - The account half: accounts anchored HERE and not removed (accountHolds).
 * - The membership half: memberships here not removed whose account is
 *   anchored elsewhere and not ended (membershipHereWhere's kept seat; the
 *   account read under its lock, so where it is anchored is the place it
 *   was read in). The anchored workspace's own stale membership row is never
 *   written.
 * - Never a row already in `departmentId`; with `onlyFrom`, only a row still
 *   in that department (a remove never takes someone out of a department
 *   they were moved to since).
 * Answers the ids written, sorted. Someone with no seat here, or a removed
 * one, is written nowhere, as before.
 */
export async function placeDepartmentHere(
  tx: Tx,
  input: { organizationId: string; userIds: readonly string[]; departmentId: string | null; onlyFrom?: string },
): Promise<string[]> {
  const { organizationId, departmentId, onlyFrom } = input;
  const ids = [...new Set(input.userIds)].filter(Boolean).sort();
  if (ids.length === 0) return [];
  await lockPeople(tx, ids);
  // NULL is never "already there" for a department, and NOT (v = x) is not
  // true for a NULL v, so the empty department is named on its own.
  const placed = {
    AND: [
      ...(onlyFrom !== undefined ? [{ departmentId: onlyFrom }] : []),
      departmentId === null ? { departmentId: { not: null } } : { OR: [{ departmentId: null }, { departmentId: { not: departmentId } }] },
    ],
  };
  const accounts = await tx.user.updateManyAndReturn({
    where: { id: { in: ids }, organizationId, deletedAt: null, ...placed },
    data: { departmentId },
    select: { id: true },
  });
  const memberships = await tx.organizationMembership.updateManyAndReturn({
    where: { userId: { in: ids }, organizationId, removedAt: null, user: { organizationId: { not: organizationId }, deletedAt: null }, ...placed },
    data: { departmentId },
    select: { userId: true },
  });
  return [...accounts.map((r) => r.id), ...memberships.map((r) => r.userId)].sort();
}

/** One dotted line to write (E2): its manager, and the note, weight and dates it carries. */
export interface DottedLineInput {
  managerId: string;
  role?: string | null;
  weight?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

/** A dotted line as it stood when a write took it off: its manager, note, weight and dates. */
export interface DottedLineRemoved {
  managerId: string;
  role: string | null;
  weight: number | null;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
}

/** What a dotted-line write changed in this workspace. */
export interface DottedWrite {
  added: string[];
  removed: string[];
  /** The lines taken off, as they stood (the final review, integrity L2: their Audit row carries them). */
  removedLines: DottedLineRemoved[];
}

/**
 * Replaces the person's dotted lines IN THIS WORKSPACE with `lines` (E2): a
 * row of this workspace not named is removed, a named one is written (by
 * the person, the manager and this workspace), and another workspace's
 * rows are never read or touched. The caller holds the role lock and has
 * checked each manager (not an Agent, not below the person, here). Null,
 * with nothing written, when the person no longer holds the seat here.
 */
export async function writeDottedHere(tx: Tx, seat: SeatRef, lines: readonly DottedLineInput[]): Promise<DottedWrite | null> {
  if (lines.some((l) => l.managerId === seat.userId)) throw new SelfLine(seat.userId);
  await lockPerson(tx, seat.userId);
  const stands = holdsOnAccount(seat) ? await tx.user.count({ where: accountHolds(seat) }) : await tx.organizationMembership.count({ where: membershipHolds(seat) });
  if (stands === 0) return null;
  const { userId, organizationId } = seat;
  const wanted = [...new Map(lines.map((l) => [l.managerId, l])).values()];
  const ids = wanted.map((l) => l.managerId);
  const rows = await tx.userDottedLine.findMany({ where: { userId, organizationId }, select: { managerId: true, role: true, weight: true, startDate: true, endDate: true, createdAt: true } });
  const held = rows.map((r) => r.managerId);
  const removed = held.filter((m) => !ids.includes(m)).sort();
  if (removed.length > 0) await tx.userDottedLine.deleteMany({ where: { userId, organizationId, managerId: { in: removed } } });
  const removedLines = rows
    .filter((r) => removed.includes(r.managerId))
    .sort((a, b) => (a.managerId < b.managerId ? -1 : a.managerId > b.managerId ? 1 : 0))
    .map((r) => ({ managerId: r.managerId, role: r.role ?? null, weight: r.weight ?? null, startDate: r.startDate ?? null, endDate: r.endDate ?? null, createdAt: r.createdAt }));
  for (const l of wanted) {
    const fields = { role: l.role, weight: l.weight, startDate: l.startDate, endDate: l.endDate };
    const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    await tx.userDottedLine.upsert({
      where: { userId_managerId_organizationId: { userId, managerId: l.managerId, organizationId } },
      create: { userId, managerId: l.managerId, organizationId, ...given },
      update: given,
    });
  }
  return { added: ids.filter((m) => !held.includes(m)).sort(), removed, removedLines };
}

/**
 * Takes these dotted lines off IN THIS WORKSPACE only (a stale line on a
 * restore or a reactivation, a line to someone made an Agent): each pair is
 * a person and the manager their line here names. Another workspace's rows
 * of the same pair stay. A removal lands on no seat's row, so it needs no
 * seat guard. Answers how many rows went.
 */
export async function removeDottedHere(tx: Tx, organizationId: string, lines: ReadonlyArray<{ userId: string; managerId: string }>): Promise<number> {
  if (lines.length === 0) return 0;
  const r = await tx.userDottedLine.deleteMany({ where: { organizationId, OR: lines.map((l) => ({ userId: l.userId, managerId: l.managerId })) } });
  return r.count;
}
