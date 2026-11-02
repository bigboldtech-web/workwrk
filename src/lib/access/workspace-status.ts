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
//
// Both take the person's row lock first (workspace-anchor.ts lockPerson), so
// a move between workspaces landing at the same moment either sees the seat
// ended or is seen by it. Neither checks the plan's seats, the role lock, the
// handover, the Owner guards or who may act: the callers do, as they do today
// (they take lockOrgRoles and lockWorkspaceSeats before these), and run the
// side effects the answer names (endTeammateAccessFor, the audit row) after.
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
import { lockPerson, reanchorUser, takenBySameEmail } from "./workspace-anchor";
import { ENDED_STATUS, usableSeatWhere, type SeatRow } from "./workspace-seat";

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
  /** D3: they were anchored here; the account moved to `anchoredIn`, and this workspace keeps the ended seat on its membership. */
  | { outcome: "moved"; anchoredIn: string; from: string }
  /**
   * D4: they were anchored here with nowhere usable to go; the account ended,
   * its tokenVersion bumped. `strandedIn`: the workspaces where they still
   * hold a usable seat the account could not move to, because an account with
   * the same email is anchored there (a merge is needed; step 1 review L5).
   */
  | { outcome: "account_ended"; anchoredIn: string; strandedIn: string[] }
  /** D5: they work here through a membership; only that membership ended. */
  | { outcome: "membership_ended"; anchoredIn: string }
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
): Promise<{ to: { organizationId: string; role: AccessLevel } | null; stranded: string[] }> {
  const seats = await tx.organizationMembership.findMany({
    where: { userId, organizationId: { not: notIn }, ...usableSeatWhere() },
    select: { organizationId: true, role: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (seats.length === 0) return { to: null, stranded: [] };
  const taken = await takenBySameEmail(tx, seats.map((s) => ({ organizationId: s.organizationId, email })));
  const open = seats.filter((s) => !taken.has(`${s.organizationId}\n${email}`));
  return { to: open[0] ?? null, stranded: seats.filter((s) => !open.includes(s)).map((s) => s.organizationId) };
}

/**
 * Ends a person's seat in ONE workspace (D3, D4, D5; see the header), inside
 * the caller's transaction. Never deletes a membership row, and never touches
 * another workspace's seat.
 */
export async function endSeat(
  tx: Tx,
  input: { userId: string; organizationId: string; kind: EndKind; now?: Date },
): Promise<EndSeatResult> {
  const { userId, organizationId, kind } = input;
  const now = input.now ?? new Date();
  const removing = kind === "removed";
  await lockPerson(tx, userId);
  const user = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true, status: true, deletedAt: true, email: true } });
  if (!user) return { outcome: "not_here", anchoredIn: null };

  if (user.organizationId === organizationId) {
    if (alreadyEnded({ status: user.status, removedAt: user.deletedAt }, kind)) return { outcome: "already_ended", anchoredIn: organizationId };
    // D3: somewhere usable to go. The seat left here is the ended one.
    const { to, stranded } = await bestUsableSeatElsewhere(tx, userId, user.email, organizationId);
    if (to) {
      await reanchorUser({ userId, to, leaving: { status: ENDED_STATUS, removedAt: removing ? now : user.deletedAt } }, tx);
      return { outcome: "moved", anchoredIn: to.organizationId, from: organizationId };
    }
    // D4: nowhere else. The account ends, and its sessions with it. Only
    // where it is still anchored here and (for a removal) not removed yet:
    // the lock above makes this the row just read.
    const n = await tx.user.updateMany({
      where: { id: userId, organizationId, ...(removing ? { deletedAt: null } : {}) },
      data: { status: ENDED_STATUS, ...(removing ? { deletedAt: now } : {}), tokenVersion: { increment: 1 } },
    });
    return n.count > 0 ? { outcome: "account_ended", anchoredIn: organizationId, strandedIn: stranded } : { outcome: "already_ended", anchoredIn: organizationId };
  }

  // D5: a membership here. Only that row changes, and this workspace's own
  // decision replaces a copied one (the mark is cleared, see the header).
  const key = { userId_organizationId: { userId, organizationId } };
  const seat = await tx.organizationMembership.findUnique({ where: key, select: { status: true, removedAt: true, endedWithAccount: true } });
  if (!seat) return { outcome: "not_here", anchoredIn: user.organizationId };
  if (alreadyEnded(seat, kind)) {
    if (seat.endedWithAccount) await tx.organizationMembership.update({ where: key, data: { endedWithAccount: false } });
    return { outcome: "already_ended", anchoredIn: user.organizationId };
  }
  await tx.organizationMembership.update({ where: key, data: { status: ENDED_STATUS, ...(removing ? { removedAt: now } : {}), endedWithAccount: false } });
  return { outcome: "membership_ended", anchoredIn: user.organizationId };
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
    await tx.user.update({ where: { id: userId }, data: { status: next, ...(restoring ? { deletedAt: null } : {}) } });
    const alsoRestoredIn = await restoreSeatsEndedWithAccount(tx, userId, organizationId, restoring);
    return { outcome: "restored", seat: "anchor", anchoredIn: organizationId, movedFrom: null, anchorEnded: false, alsoRestoredIn };
  }

  const key = { userId_organizationId: { userId, organizationId } };
  const seat = await tx.organizationMembership.findUnique({ where: key, select: { status: true, removedAt: true, role: true } });
  if (!seat) return { outcome: "not_here", anchoredIn: user.organizationId };
  const refused = restoreRefusal(seat, kind);
  if (refused) return { outcome: refused, anchoredIn: user.organizationId };
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
