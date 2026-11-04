// A person's status in each workspace (docs/plans/workspace-status.md).
//
// A person has one account row (User), anchored to one workspace, and a
// membership row (OrganizationMembership) for every other workspace they
// belong to. Their status and removal live where their access level lives
// (D1): User.status and User.deletedAt in the workspace they are anchored
// to, the membership's status and removedAt in every other one. A move
// between workspaces swaps them as it swaps the level
// (workspace-anchor.ts reanchorUser).
//
// This file is where a seat is ENDED (deactivated or removed) and RESTORED
// (reactivated or restored), so the routes that do either (Members, the
// person's admin routes, SCIM) change one workspace and no other:
//
//   endSeat      D3  anchored here, with a usable seat elsewhere: the
//                    account moves there in the same transaction, and this
//                    workspace keeps the ended seat on its membership. No
//                    tokenVersion bump: the person stays signed in to their
//                    other workspace, and their sessions acting here lose it
//                    at once (every read of the acting workspace treats an
//                    ended membership as none, acting-workspace.ts).
//                D4  anchored here, with no usable seat anywhere else: the
//                    account ends, as it always did (User.status INACTIVE,
//                    deletedAt for a removal, tokenVersion bumped).
//                D5  working here through a membership: that membership
//                    ends (status INACTIVE, removedAt for a removal) and
//                    nothing else changes. The row is never deleted (D8).
//   restoreSeat  D6  the seat being restored comes back. When the person's
//                    anchor is itself ended (they had nowhere else), the
//                    account moves here in the same transaction, so a person
//                    with a usable seat is never left anchored to an ended
//                    one (the invariant of D7).
//   moveToUsableSeat D7  the repair sign-in, Google sign-in and the session
//                    check make: an account whose own seat is ended, or
//                    whose workspace is closed, moves to its best usable
//                    seat elsewhere instead of being refused (step 2).
//
// Both take the person's row lock first (workspace-anchor.ts lockPerson), so
// a move between workspaces landing at the same moment either sees the seat
// ended or is seen by it. Neither checks the plan's seats, the role lock, the
// handover, the Owner guards or who may act: the callers do, as they do today
// (they take lockOrgRoles and lockWorkspaceSeats before these), and run the
// side effects the answer names (endTeammateAccessFor, the audit row) after.
//
// A SEAT THAT ENDS TAKES ITS WORKSPACE'S OPEN INVITATIONS WITH IT (the step
// 2 review H1, seat-invitations.ts): endSeat ends this address's open
// invitations to the workspace in the same transaction, for D4 and D5 here
// and for D3 through the move (reanchorUser does it for any seat it leaves
// ended), so an invitation sent before the end can never undo it.
// restoreSeat never makes two live accounts of one address in one workspace
// (the review L8): it answers "duplicate", writing nothing.
//
// A SEAT THAT ENDS TAKES THE API KEYS ITS PERSON MADE THERE WITH IT (D15,
// seat-api-keys.ts): endSeat revokes them in the same transaction, with an
// audit row each (D3, D4 and D5; `apiKeysRevoked` says how many). A restore
// brings none back.
//
// The routes that end a seat ask first what the end WILL be (endSeatWould,
// the same read under the same lock), and endSeat writes only that end
// (`expect`). Since workspace-status-2.md step 4 (E4, E6) no line moves with
// an end: each workspace's handover moves its own reports first, and a line
// rides on the row that holds the seat (the swap, E3). `leavesOnlyHere`
// says, before the handover runs, whether their other workspaces are not
// affected (the dialogs' D17 note).
//
// SEATS THE ONE-TIME SQL STEP ENDED WITH THE ACCOUNT (endedWithAccount,
// D16; step 1 review M1). Before each workspace had a status of its own,
// only the anchored workspace could end an account, so every membership the
// one-time step of prisma/sql/2026-11-01-membership-status.sql ended is that
// workspace's decision, copied. When restoreSeat brings the ANCHORED seat
// back, every membership of the person still carrying the mark comes back in
// the same transaction, matching the kind (a reactivation brings back the
// deactivated ones at ACTIVE; a restore also clears removedAt), WITH NO SEAT
// CHECK for them: exactly what the account-wide restore did before, which
// brought every workspace back unchecked. Any write of a seat by its own
// workspace (endSeat, restoreSeat on a membership, the seat a move leaves)
// clears its mark, so from then on that workspace alone decides it. For
// that data the worst case is exactly today's behaviour.
//
// The seat rule itself (live, kept, usable: D2) is workspace-seat.ts,
// re-exported here.

import type { AccessLevel, Prisma, UserStatus } from "@/generated/prisma";
import { isErasedAccount } from "@/lib/compliance/erased-account";
import { prisma } from "@/lib/prisma";
import { accountIsLive, lockPerson, reanchorUser, sameEmailKey, takenBySameEmail } from "./workspace-anchor";
import { endOpenInvitations } from "./seat-invitations";
import { revokeKeysMadeHere, type SeatActor } from "./seat-api-keys";
import { ENDED_STATUS, liveSeatWhere, usableSeatWhere, workspaceIsOpen, type SeatRow } from "./workspace-seat";

export type { SeatActor } from "./seat-api-keys";

export {
  CLOSED_WORKSPACE_STATUSES,
  ENDED_STATUS,
  keptSeatSql,
  keptSeatWhere,
  liveSeatSql,
  liveSeatWhere,
  seatIsKept,
  seatIsLive,
  seatIsUsable,
  usableSeatWhere,
  workspaceIsOpen,
  type SeatRow,
} from "./workspace-seat";

type Tx = Prisma.TransactionClient;

/** How a seat ends: a deactivation, or a removal (which also stamps removedAt or deletedAt). */
export type EndKind = "deactivated" | "removed";
/** How a seat comes back: a reactivation of a deactivated seat, or a restore of a removed one. */
export type RestoreKind = "reactivated" | "restored";

/** What endSeat did, and where the person is anchored now. */
export type EndSeatResult =
  /**
   * D3: they were anchored here; the account moved to `anchoredIn`, and this
   * workspace keeps the ended seat on its membership. `apiKeysRevoked`, here
   * and below: the live API keys they made in this workspace, revoked with
   * the seat (D15).
   */
  | { outcome: "moved"; anchoredIn: string; from: string; apiKeysRevoked: number }
  /**
   * D4: they were anchored here with nowhere usable to go; the account ended,
   * its tokenVersion bumped. `strandedIn`: the workspaces where they still
   * hold a usable seat the account could not move to, because an account with
   * the same email is anchored there (a merge is needed; step 1 review L5).
   */
  | { outcome: "account_ended"; anchoredIn: string; strandedIn: string[]; apiKeysRevoked: number }
  /** D5: they work here through a membership; only that membership ended. */
  | { outcome: "membership_ended"; anchoredIn: string; apiKeysRevoked: number }
  /**
   * The seat was already ended this way (a removal of a removed seat, a
   * deactivation of an ended one): nothing written, but for a membership the
   * one-time step ended with the account, its mark is cleared, so this
   * workspace's own decision now holds it ended (see the header).
   */
  | { outcome: "already_ended"; anchoredIn: string }
  /** No account, or no seat here at all: nothing written. */
  | { outcome: "not_here"; anchoredIn: string | null };

/** What restoreSeat did, and where the person is anchored now. */
export type RestoreSeatResult =
  | {
      outcome: "restored";
      /** Which row held the seat: the account (anchored here) or this workspace's membership. */
      seat: "anchor" | "membership";
      anchoredIn: string;
      /** D6: the ended anchor the account moved here from, or null when it did not move. */
      movedFrom: string | null;
      /** True only when the anchor is ended and could not move here (an account with the same email is anchored here already). */
      anchorEnded: boolean;
      /** For the anchored seat: the workspaces whose seat the one-time step had ended with the account, brought back with it (see the header). */
      alsoRestoredIn: string[];
    }
  /** The seat is not ended this way (a restore of a seat never removed, a reactivation of a live one): nothing written. */
  | { outcome: "not_ended"; anchoredIn: string }
  /** A reactivation of a removed seat: a restore brings it back. Nothing written. */
  | { outcome: "removed"; anchoredIn: string }
  /** The account was erased by its own person: never brought back (D10). Nothing written. */
  | { outcome: "erased"; anchoredIn: string }
  /**
   * Another account with the same address (in any case) is live in this
   * workspace: anchored here and live, or holding a live seat here. Bringing
   * this seat back would make two people of one mailbox here, one of whom
   * could never sign in to it (the step 2 review L8). Nothing written; the
   * two accounts need a merge, and `otherAccountId` names the other one.
   */
  | { outcome: "duplicate"; anchoredIn: string; otherAccountId: string }
  /** No account, or no seat here at all: nothing written. */
  | { outcome: "not_here"; anchoredIn: string | null };

/** Whether a seat is already ended the way `kind` would end it. */
export function alreadyEnded(seat: SeatRow, kind: EndKind): boolean {
  return kind === "removed" ? seat.removedAt != null : seat.status === ENDED_STATUS;
}

/** Why a seat cannot come back the way `kind` brings it, or null when it can. */
export function restoreRefusal(seat: SeatRow, kind: RestoreKind): "not_ended" | "removed" | null {
  if (kind === "restored") return seat.removedAt == null ? "not_ended" : null;
  if (seat.removedAt != null) return "removed";
  return seat.status === ENDED_STATUS ? null : "not_ended";
}

/**
 * The usable seat elsewhere an ended anchor moves to (D3): primary first,
 * then oldest, as sign-in picks, passing over a workspace where an account
 * with the same email is already anchored (a move there cannot be made).
 * `stranded` names those passed over.
 */
async function bestUsableSeatElsewhere(
  tx: Tx,
  userId: string,
  email: string,
  notIn: string,
): Promise<{ to: { organizationId: string; role: AccessLevel; name: string | null } | null; stranded: string[] }> {
  const seats = await tx.organizationMembership.findMany({
    where: { userId, organizationId: { not: notIn }, ...usableSeatWhere() },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (seats.length === 0) return { to: null, stranded: [] };
  const taken = await takenBySameEmail(tx, seats.map((s) => ({ organizationId: s.organizationId, email })));
  const open = seats.filter((s) => !taken.has(sameEmailKey(s.organizationId, email)));
  const best = open[0];
  return {
    to: best ? { organizationId: best.organizationId, role: best.role, name: best.organization?.name ?? null } : null,
    stranded: seats.filter((s) => !open.includes(s)).map((s) => s.organizationId),
  };
}

type SeatEndInput = { userId: string; organizationId: string; kind: EndKind };

/** What ending a seat would do, read under the person's row lock (planEnd). */
type EndPlan =
  | { plan: "move"; user: { email: string; deletedAt: Date | null }; to: { organizationId: string; role: AccessLevel } }
  | { plan: "end_account"; user: { email: string }; stranded: string[] }
  | { plan: "end_membership"; user: { organizationId: string; email: string } }
  | { plan: "already_ended"; anchoredIn: string; clearMark: boolean }
  | { plan: "not_here"; anchoredIn: string | null };

/** The one reading of D3, D4 and D5 that endSeat writes and endSeatWould answers. Takes the person's row lock first. */
async function planEnd(tx: Tx, input: SeatEndInput): Promise<EndPlan> {
  const { userId, organizationId, kind } = input;
  await lockPerson(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true, email: true } });
  if (!user) return { plan: "not_here", anchoredIn: null };
  if (user.organizationId === organizationId) {
    if (alreadyEnded({ status: user.status, removedAt: user.deletedAt }, kind)) return { plan: "already_ended", anchoredIn: organizationId, clearMark: false };
    const { to, stranded } = await bestUsableSeatElsewhere(tx, userId, user.email, organizationId);
    if (to) return { plan: "move", user, to: { organizationId: to.organizationId, role: to.role } };
    return { plan: "end_account", user, stranded };
  }
  const seat = await tx.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { status: true, removedAt: true, endedWithAccount: true },
  });
  if (!seat) return { plan: "not_here", anchoredIn: user.organizationId };
  if (alreadyEnded(seat, kind)) return { plan: "already_ended", anchoredIn: user.organizationId, clearMark: seat.endedWithAccount };
  return { plan: "end_membership", user };
}

/** The outcome a plan writes. */
function outcomeOf(p: EndPlan): EndSeatResult["outcome"] {
  return p.plan === "move" ? "moved" : p.plan === "end_account" ? "account_ended" : p.plan === "end_membership" ? "membership_ended" : p.plan;
}

/**
 * What endSeat WILL do to this seat, read the same way under the same row
 * lock, writing nothing: the routes ask it inside their transaction before
 * they write (SCIM's words "in this workspace" follow it; batches 8 and 9
 * moved the lines another workspace relied on only for "account_ended", a
 * move workspace-status-2 step 4 retired, E6). The lock is held to the end
 * of the transaction, so endSeat answers the same, unless a workspace
 * elsewhere changes status in between (no person lock is taken for that):
 * the routes pass this answer to endSeat as `expect`, which then refuses
 * (SeatPlanChanged) rather than write another end than the one planned.
 */
export async function endSeatWould(tx: Tx, input: SeatEndInput): Promise<EndSeatResult["outcome"]> {
  return outcomeOf(await planEnd(tx, input));
}

/**
 * Thrown by endSeat, before it writes anything, when its plan is no longer
 * the one the caller read (`expect`, from endSeatWould): a workspace
 * elsewhere was suspended or reopened in between, so the person would move
 * where the caller planned an end, or the other way round (the step 3 review
 * L1). Retryable: the caller's transaction rolls back whatever it moved for
 * the old plan, and the person tries again.
 */
export class SeatPlanChanged extends Error {
  constructor(readonly expected: EndSeatResult["outcome"], readonly actual: EndSeatResult["outcome"]) {
    super(`The end of this seat was planned as ${expected} and would now be ${actual}.`);
    this.name = "SeatPlanChanged";
  }
}

/** The plain sentence a route answers SeatPlanChanged with (409). */
export const SEAT_PLAN_CHANGED_WORDS = "Their workspaces changed a moment ago, so nothing was done. Try again.";

/**
 * Ends a person's seat in ONE workspace (D3, D4, D5; see the header), inside
 * the caller's transaction. Never deletes a membership row, and never touches
 * another workspace's seat. Revokes the API keys they made here (D15);
 * `actor` is who ended it, for those audit rows. `expect`, endSeatWould's
 * answer read earlier in the same transaction: when the plan differs now,
 * SeatPlanChanged is thrown and nothing is written.
 */
export async function endSeat(
  tx: Tx,
  input: SeatEndInput & { now?: Date; actor?: SeatActor | null; expect?: EndSeatResult["outcome"] },
): Promise<EndSeatResult> {
  const { userId, organizationId, kind } = input;
  const now = input.now ?? new Date();
  const removing = kind === "removed";
  const p = await planEnd(tx, input);
  if (input.expect && outcomeOf(p) !== input.expect) throw new SeatPlanChanged(input.expect, outcomeOf(p));
  const keys = () => revokeKeysMadeHere(tx, { organizationId, userId, ends: kind, now, actor: input.actor });

  switch (p.plan) {
    case "not_here":
      return { outcome: "not_here", anchoredIn: p.anchoredIn };
    case "already_ended":
      // A membership the one-time step ended with the account: this
      // workspace's own decision now holds it (the mark is cleared, see the header).
      if (p.clearMark) await tx.organizationMembership.update({ where: { userId_organizationId: { userId, organizationId } }, data: { endedWithAccount: false } });
      return { outcome: "already_ended", anchoredIn: p.anchoredIn };
    case "move": {
      // D3: somewhere usable to go. The seat left here is the ended one.
      await reanchorUser({ userId, to: p.to, leaving: { status: ENDED_STATUS, removedAt: removing ? now : p.user.deletedAt } }, tx);
      return { outcome: "moved", anchoredIn: p.to.organizationId, from: organizationId, apiKeysRevoked: await keys() };
    }
    case "end_account": {
      // D4: nowhere else. The account ends, and its sessions with it. Only
      // where it is still anchored here and (for a removal) not removed yet:
      // the lock above makes this the row just read.
      const n = await tx.user.updateMany({
        where: { id: userId, organizationId, ...(removing ? { deletedAt: null } : {}) },
        data: { status: ENDED_STATUS, ...(removing ? { deletedAt: now } : {}), tokenVersion: { increment: 1 } },
      });
      if (n.count === 0) return { outcome: "already_ended", anchoredIn: organizationId };
      // This workspace's open invitations for the address end with the seat
      // (seat-invitations.ts; D3's move does the same through reanchorUser).
      await endOpenInvitations(tx, { organizationIds: [organizationId], email: p.user.email, now });
      return { outcome: "account_ended", anchoredIn: organizationId, strandedIn: p.stranded, apiKeysRevoked: await keys() };
    }
    case "end_membership": {
      // D5: a membership here. Only that row changes, and this workspace's own
      // decision replaces a copied one (the mark is cleared, see the header).
      await tx.organizationMembership.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { status: ENDED_STATUS, ...(removing ? { removedAt: now } : {}), endedWithAccount: false },
      });
      await endOpenInvitations(tx, { organizationIds: [organizationId], email: p.user.email, now });
      return { outcome: "membership_ended", anchoredIn: p.user.organizationId, apiKeysRevoked: await keys() };
    }
  }
}

/**
 * Whether ending this person's seat here leaves their account working
 * somewhere else: a membership seat here (D5), or the anchored seat of
 * someone who holds a usable seat elsewhere (D3: they move there). The
 * dialogs then say their other workspaces are not affected (D17). The
 * handover is this workspace's whatever it answers (workspace-status-2.md
 * E6). False for D4 (the account ends with the seat) and for someone with
 * no seat here. A plain read, before the handover; the end itself reads it
 * again under the lock (endSeatWould).
 */
export async function leavesOnlyHere(organizationId: string, userId: string, db: Tx | typeof prisma = prisma): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, email: true } });
  if (!user) return false;
  if (user.organizationId !== organizationId) {
    const seat = await db.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { userId: true } });
    return !!seat;
  }
  return (await withUsableSeatElsewhere([user], db)).has(userId);
}

/**
 * Another account with this address, in any case, that is live in this
 * workspace (see RestoreSeatResult "duplicate"): anchored here and live, or
 * holding a live seat here. Its id, or null.
 */
async function liveTwinIn(tx: Tx, userId: string, organizationId: string, email: string): Promise<string | null> {
  const others = await tx.user.findMany({
    where: { id: { not: userId }, email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, organizationId: true, status: true, deletedAt: true },
  });
  const anchoredHere = others.find((o) => o.organizationId === organizationId && accountIsLive(o));
  if (anchoredHere) return anchoredHere.id;
  const elsewhere = others.filter((o) => o.organizationId !== organizationId).map((o) => o.id);
  if (elsewhere.length === 0) return null;
  const seat = await tx.organizationMembership.findFirst({ where: { organizationId, userId: { in: elsewhere }, ...liveSeatWhere() }, select: { userId: true } });
  return seat?.userId ?? null;
}

/**
 * The memberships the one-time step ended with the account, brought back
 * with the anchored seat (see the header), with no seat check, as the
 * account-wide restore did before. A reactivation brings back only the
 * deactivated ones (a removed one waits for a restore, its mark kept); a
 * restore brings back both. The anchored workspace's own row is left: it is
 * not the seat while the account is anchored there.
 */
async function restoreSeatsEndedWithAccount(tx: Tx, userId: string, anchoredIn: string, restoring: boolean): Promise<string[]> {
  const where = { userId, organizationId: { not: anchoredIn }, endedWithAccount: true, ...(restoring ? {} : { removedAt: null }) };
  const rows = await tx.organizationMembership.findMany({ where, select: { organizationId: true } });
  if (rows.length === 0) return [];
  await tx.organizationMembership.updateMany({ where, data: { status: "ACTIVE", ...(restoring ? { removedAt: null } : {}), endedWithAccount: false } });
  return rows.map((r) => r.organizationId);
}

/**
 * Brings a person's ended seat in ONE workspace back (D6; see the header),
 * inside the caller's transaction, at `status` (ACTIVE when not given; an HR
 * status for a reactivation that sets one). An erased account is never
 * brought back. The caller checks and takes the plan's seat first
 * (lockWorkspaceSeats, seatsFor), as it does today. The anchored seat also
 * brings back the seats the one-time step ended with the account, with no
 * seat check (restoreSeatsEndedWithAccount; `alsoRestoredIn`).
 */
export async function restoreSeat(
  tx: Tx,
  input: { userId: string; organizationId: string; kind: RestoreKind; status?: Exclude<UserStatus, "INACTIVE"> },
): Promise<RestoreSeatResult> {
  const { userId, organizationId, kind } = input;
  const next = input.status ?? "ACTIVE";
  // The type rules it out; a caller passing a plain string is refused, never written.
  if ((next as UserStatus) === ENDED_STATUS) throw new Error("restoreSeat: a restored seat is never INACTIVE");
  const restoring = kind === "restored";
  await lockPerson(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true, email: true } });
  if (!user) return { outcome: "not_here", anchoredIn: null };
  if (user.deletedAt && (await isErasedAccount(tx, userId))) return { outcome: "erased", anchoredIn: user.organizationId };

  if (user.organizationId === organizationId) {
    const refused = restoreRefusal({ status: user.status, removedAt: user.deletedAt }, kind);
    if (refused) return { outcome: refused, anchoredIn: organizationId };
    const twin = await liveTwinIn(tx, userId, organizationId, user.email);
    if (twin) return { outcome: "duplicate", anchoredIn: organizationId, otherAccountId: twin };
    await tx.user.update({ where: { id: userId }, data: { status: next, ...(restoring ? { deletedAt: null } : {}) } });
    const alsoRestoredIn = await restoreSeatsEndedWithAccount(tx, userId, organizationId, restoring);
    return { outcome: "restored", seat: "anchor", anchoredIn: organizationId, movedFrom: null, anchorEnded: false, alsoRestoredIn };
  }

  const key = { userId_organizationId: { userId, organizationId } };
  const seat = await tx.organizationMembership.findUnique({ where: key, select: { status: true, removedAt: true, role: true } });
  if (!seat) return { outcome: "not_here", anchoredIn: user.organizationId };
  const refused = restoreRefusal(seat, kind);
  if (refused) return { outcome: refused, anchoredIn: user.organizationId };
  const twin = await liveTwinIn(tx, userId, organizationId, user.email);
  if (twin) return { outcome: "duplicate", anchoredIn: user.organizationId, otherAccountId: twin };
  await tx.organizationMembership.update({ where: key, data: { status: next, ...(restoring ? { removedAt: null } : {}), endedWithAccount: false } });

  const anchorEnded = user.deletedAt != null || user.status === ENDED_STATUS;
  if (!anchorEnded) return { outcome: "restored", seat: "membership", anchoredIn: user.organizationId, movedFrom: null, anchorEnded: false, alsoRestoredIn: [] };
  // D6: the anchor is ended, so the account comes here. The move keeps the
  // ended seat on the membership it leaves and takes the one just restored.
  const taken = await takenBySameEmail(tx, [{ organizationId, email: user.email }]);
  if (taken.size > 0) return { outcome: "restored", seat: "membership", anchoredIn: user.organizationId, movedFrom: null, anchorEnded: true, alsoRestoredIn: [] };
  await reanchorUser({ userId, to: { organizationId, role: seat.role } }, tx);
  return { outcome: "restored", seat: "membership", anchoredIn: organizationId, movedFrom: user.organizationId, anchorEnded: false, alsoRestoredIn: [] };
}

// ── D7's repair: sign-in, Google sign-in and the session check ──────────

/** Where moveToUsableSeat leaves an account: anchored in a workspace it can work in. */
export interface UsableAnchor {
  organizationId: string;
  /** That workspace's name, when it was read (for the move notice). */
  organizationName: string | null;
  /** The level held there now. */
  accessLevel: AccessLevel;
  /** The workspace the account moved out of; null when it was usable where it was, and nothing was written. */
  movedFrom: string | null;
}

/**
 * D7's repair, and the move out of a closed workspace that sign-in and the
 * session check always made: when the account's own seat is ended (removed
 * or deactivated where it is anchored) or its workspace is SUSPENDED or
 * CANCELLED, the account moves to its best usable seat elsewhere (primary
 * first, then oldest, passing over a workspace where an account with the
 * same email is anchored: bestUsableSeatElsewhere, as endSeat picks).
 *
 * One transaction under the person's row lock, so the seat chosen is the
 * seat moved into: a seat ended at the same moment (endSeat takes the same
 * lock) is never picked, and a move another device made first is seen (the
 * account is usable already: answered as it is, nothing written).
 *
 * Null, with nothing written, when the account can work nowhere: no
 * account, an account its own person erased (never brought back, D10), or
 * no usable seat elsewhere. The callers then refuse exactly as before.
 * `db` is the caller's transaction, when it has one.
 */
export async function moveToUsableSeat(userId: string, db?: Tx): Promise<UsableAnchor | null> {
  const run = async (tx: Tx): Promise<UsableAnchor | null> => {
    await lockPerson(tx, userId);
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, accessLevel: true, status: true, deletedAt: true, email: true, organization: { select: { name: true, status: true } } },
    });
    if (!user) return null;
    if (accountIsLive(user) && workspaceIsOpen(user.organization?.status)) {
      return { organizationId: user.organizationId, organizationName: user.organization?.name ?? null, accessLevel: user.accessLevel, movedFrom: null };
    }
    if (user.deletedAt && (await isErasedAccount(tx, userId))) return null;
    const { to } = await bestUsableSeatElsewhere(tx, userId, user.email, user.organizationId);
    if (!to) return null;
    // The seat was read live under the lock, so the move never meets
    // WouldLandEnded; the account takes that seat's status (reanchorUser).
    await reanchorUser({ userId, to: { organizationId: to.organizationId, role: to.role } }, tx);
    return { organizationId: to.organizationId, organizationName: to.name, accessLevel: to.role, movedFrom: user.organizationId };
  };
  return db ? run(db) : prisma.$transaction((tx) => run(tx));
}

/**
 * Of these accounts, the ids that hold a usable seat (D2) in a workspace
 * other than the one they are anchored to, and not in one where an account
 * with the same address is anchored: exactly the accounts D7's repair can
 * move (moveToUsableSeat, bestUsableSeatElsewhere; the step 2 review L5).
 * The anchored workspace's own membership row is never counted: it is stale
 * while the account is anchored there. A plain read (two when there is a
 * seat to check), with no lock: the session check asks it before it opens
 * the repair's locked transaction.
 */
export async function withUsableSeatElsewhere(
  accounts: ReadonlyArray<{ id: string; organizationId: string; email: string }>,
  db: Tx | typeof prisma = prisma,
): Promise<Set<string>> {
  if (accounts.length === 0) return new Set();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seats = await db.organizationMembership.findMany({
    where: { userId: { in: [...byId.keys()] }, ...usableSeatWhere() },
    select: { userId: true, organizationId: true },
  });
  const elsewhere = seats.filter((s) => byId.get(s.userId)?.organizationId !== s.organizationId);
  if (elsewhere.length === 0) return new Set();
  const emailOf = (userId: string) => byId.get(userId)?.email ?? "";
  const taken = await takenBySameEmail(db, elsewhere.map((s) => ({ organizationId: s.organizationId, email: emailOf(s.userId) })));
  return new Set(elsewhere.filter((s) => !taken.has(sameEmailKey(s.organizationId, emailOf(s.userId)))).map((s) => s.userId));
}
