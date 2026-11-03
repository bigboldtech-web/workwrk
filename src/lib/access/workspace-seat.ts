// A person's seat in one workspace: whether it is live, and whether it is
// usable (docs/plans/workspace-status.md D2). THE one statement of the rule,
// in its three forms: a Prisma `where` for OrganizationMembership, a
// predicate over a row already read, and SQL for a raw statement. Nothing
// else writes the condition out by hand. Re-exported by workspace-status.ts,
// which writes seats (endSeat, restoreSeat); this file is a leaf (no reads,
// no writes), so workspace-anchor.ts and acting-workspace.ts can read the
// rule without importing the writers.
//
// A seat is the account row where the account is anchored (User.status,
// User.deletedAt) and a membership row everywhere else
// (OrganizationMembership.status, removedAt). This file states the
// membership side; the anchored side keeps its own readers (D1).
//
//   live     status is not INACTIVE and removedAt is null. The HR statuses
//            (On leave, Probation, PIP, Notice period) are live: they are
//            labels, not access.
//   kept     removedAt is null: live or deactivated, never removed. What a
//            workspace still lists, as an anchored row with deletedAt null.
//   usable   live, in a workspace that is neither SUSPENDED nor CANCELLED.

import { Prisma } from "@/generated/prisma";
import type { OrgStatus, UserStatus } from "@/generated/prisma";

/** The status that ends a seat (deactivated, and removed too). */
export const ENDED_STATUS = "INACTIVE" satisfies UserStatus;

/** The workspace statuses nobody works in. */
export const CLOSED_WORKSPACE_STATUSES = ["SUSPENDED", "CANCELLED"] as const satisfies readonly OrgStatus[];

/** What the rule reads of a seat: its status and its removal there. */
export interface SeatRow {
  status: UserStatus | string;
  removedAt: Date | null;
}

/** A live seat: not deactivated and not removed there. */
export function seatIsLive(seat: SeatRow): boolean {
  return seat.status !== ENDED_STATUS && seat.removedAt == null;
}

/** A kept seat: not removed there (it may be deactivated). */
export function seatIsKept(seat: SeatRow): boolean {
  return seat.removedAt == null;
}

/** A workspace someone can work in: neither SUSPENDED nor CANCELLED (and known). */
export function workspaceIsOpen(status: OrgStatus | string | null | undefined): boolean {
  return typeof status === "string" && !(CLOSED_WORKSPACE_STATUSES as readonly string[]).includes(status);
}

/** A usable seat (D2): live, in an open workspace. */
export function seatIsUsable(seat: SeatRow, workspaceStatus: OrgStatus | string | null | undefined): boolean {
  return seatIsLive(seat) && workspaceIsOpen(workspaceStatus);
}

/** The `where` for a live membership, for a caller that checks the workspace's status itself (or need not). */
export function liveSeatWhere(): Prisma.OrganizationMembershipWhereInput {
  return { status: { not: ENDED_STATUS }, removedAt: null };
}

/** The `where` for a kept membership: not removed, deactivated or not. */
export function keptSeatWhere(): Prisma.OrganizationMembershipWhereInput {
  return { removedAt: null };
}

/** The `where` for a usable membership (D2): live, in an open workspace. */
export function usableSeatWhere(): Prisma.OrganizationMembershipWhereInput {
  return { ...liveSeatWhere(), organization: { status: { notIn: [...CLOSED_WORKSPACE_STATUSES] } } };
}

function plainAlias(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error(`workspace-seat: "${alias}" is not a plain alias`);
  return alias;
}

/**
 * A live membership in SQL, for the "OrganizationMembership" row aliased
 * `alias`. Every value in it is this module's own constant, so it carries no
 * parameter; nest it in a tagged $queryRaw.
 */
export function liveSeatSql(alias: string): Prisma.Sql {
  const a = plainAlias(alias);
  return Prisma.raw(`(${a}."status" <> '${ENDED_STATUS}' AND ${a}."removedAt" IS NULL)`);
}

/** A kept membership in SQL (not removed), as liveSeatSql. */
export function keptSeatSql(alias: string): Prisma.Sql {
  const a = plainAlias(alias);
  return Prisma.raw(`${a}."removedAt" IS NULL`);
}
