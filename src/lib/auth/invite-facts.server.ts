// The facts /join shows about an invitation, read from the rows that
// already hold them (spec-account-auth `/join` "Shape change to the GET").
// Invitation has no inviter or message column: both are read back from the
// audit row the sending route wrote (`user.invited` targets the invitation;
// a Space email invite writes `access.invited` with metadata.invitationId).
// An invitation sent before the message was recorded simply shows none:
// only the facts the invitation actually carries render, nothing invented.
//
// Server-only (prisma).

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { managerCandidateIn } from "@/lib/access/manager-candidate";
import { seatIsLive } from "@/lib/access/workspace-seat";
import { withUsableSeatElsewhere } from "@/lib/access/workspace-status";

export interface InviteRow {
  id: string;
  email: string;
  organizationId: string;
  departmentId: string | null;
  managerId: string | null;
  spaceId: string | null;
  spaceRole: string | null;
}

export interface InviteSender {
  inviterId: string | null;
  inviterName: string | null;
  message: string | null;
}

function fullName(u: { firstName: string | null; lastName: string | null } | null | undefined): string | null {
  if (!u) return null;
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || null;
}

export async function inviteSender(inv: Pick<InviteRow, "id" | "organizationId">): Promise<InviteSender> {
  const row = await prisma.activityLog.findFirst({
    where: {
      organizationId: inv.organizationId,
      OR: [
        { type: "user.invited", targetId: inv.id },
        { type: "access.invited", metadata: { path: ["invitationId"], equals: inv.id } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { actorId: true, metadata: true, actor: { select: { firstName: true, lastName: true } } },
  });
  const meta = (row?.metadata ?? null) as { message?: unknown } | null;
  const message = typeof meta?.message === "string" && meta.message.trim() ? meta.message.trim().slice(0, 1000) : null;
  return { inviterId: row?.actorId ?? null, inviterName: fullName(row?.actor), message };
}

export async function invitePlacement(inv: Pick<InviteRow, "organizationId" | "departmentId" | "managerId" | "spaceId">): Promise<{
  departmentName: string | null;
  managerName: string | null;
  space: { id: string; name: string } | null;
}> {
  const [dept, manager, space, managerId] = await Promise.all([
    inv.departmentId ? prisma.department.findFirst({ where: { id: inv.departmentId, organizationId: inv.organizationId }, select: { name: true } }) : null,
    // Named only when managerOnAccept writes them, which asks whether they
    // are in the workspace (anchored there or a membership there, batch 5).
    inv.managerId ? prisma.user.findFirst({ where: { id: inv.managerId, deletedAt: null }, select: { firstName: true, lastName: true } }) : null,
    inv.spaceId ? prisma.space.findFirst({ where: { id: inv.spaceId, organizationId: inv.organizationId, archivedAt: null }, select: { id: true, name: true } }) : null,
    managerOnAccept(inv),
  ]);
  // /join names the manager the acceptance will write, never one it won't (an Agent).
  return { departmentName: dept?.name ?? null, managerName: managerId ? fullName(manager) : null, space: space ?? null };
}

/**
 * The manager an accepted invitation writes: the one it names, while they are
 * still a live person in the workspace who may manage. Never an Agent (access
 * 2.4): the invitation may predate their move to the Agent tier, or have come
 * from a path that did not check (sendInvitation checks now). Never someone
 * removed or deactivated since (batch 3: "live" is both; a deactivated person
 * holds no reports, invariant 13). Otherwise none, so the new person joins
 * with no manager rather than under someone who cannot manage them, and an
 * Admin sets one in Members.
 *
 * `db` is the acceptance's own transaction, under the role lock, so a role
 * change to Agent waits for it or is seen by it (rule 6's race).
 */
export async function managerOnAccept(inv: Pick<InviteRow, "organizationId" | "managerId">, db?: Prisma.TransactionClient): Promise<string | null> {
  if (!inv.managerId) return null;
  return (await managerCandidateIn(inv.organizationId, inv.managerId, { db, live: true })) === "ok" ? inv.managerId : null;
}

/**
 * The department, job title and office an accepted invitation writes: each
 * only while it is a row of the invited workspace (docs-found fixes batch 6).
 * sendInvitation checks them now (batch 5), but an invitation sent before
 * that stored them as sent, so its acceptance could place the new person in
 * another workspace's department, job title or office. A value that is not
 * the workspace's own is left blank, for an Admin to set in Members. Three
 * reads by primary key, in the acceptance's transaction.
 */
export async function placementOnAccept(
  inv: { organizationId: string; departmentId: string | null; roleId: string | null; officeId: string | null },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ departmentId: string | null; roleId: string | null; officeId: string | null }> {
  const organizationId = inv.organizationId;
  const [department, role, office] = await Promise.all([
    inv.departmentId ? db.department.findFirst({ where: { id: inv.departmentId, organizationId }, select: { id: true } }) : null,
    inv.roleId ? db.role.findFirst({ where: { id: inv.roleId, organizationId }, select: { id: true } }) : null,
    inv.officeId ? db.office.findFirst({ where: { id: inv.officeId, organizationId }, select: { id: true } }) : null,
  ]);
  return { departmentId: department?.id ?? null, roleId: role?.id ?? null, officeId: office?.id ?? null };
}

/**
 * A live account anywhere on the platform for this address (the person who
 * can log in with it): live where it is anchored, oldest first; else one
 * ended where it is anchored that still holds a usable seat in another
 * workspace (docs/plans/workspace-status.md D7, an old row), which its next
 * sign-in moves there. Never one that can work nowhere.
 */
export async function liveAccountFor(email: string): Promise<{ id: string; organizationId: string } | null> {
  const address = { equals: email.trim(), mode: "insensitive" } as const;
  const live = await prisma.user.findFirst({
    where: { email: address, deletedAt: null, status: { not: "INACTIVE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true },
  });
  if (live) return live;
  // None live where anchored: every row with the address is ended there.
  const ended = await prisma.user.findMany({ where: { email: address }, orderBy: { createdAt: "asc" }, select: { id: true, organizationId: true, email: true }, take: 20 });
  if (ended.length === 0) return null;
  const movable = await withUsableSeatElsewhere(ended);
  const found = ended.find((r) => movable.has(r.id));
  return found ? { id: found.id, organizationId: found.organizationId } : null;
}

/**
 * The refusal when someone who may not bring back an ended seat invites the
 * address (sendInvitation, v1/people, a resend): only an Admin, read fresh,
 * decides that (the step 2 review M1). The Space dialog's own words name the
 * Space too.
 */
export const ENDED_SEAT_INVITE_REFUSAL = "They were deactivated or removed here. An Admin can bring them back from Members.";
export const ENDED_SEAT_SPACE_REFUSAL =
  "This person no longer has access to your workspace. An Owner or Admin can invite them back from Settings, Members, then add them to the Space.";

/**
 * Whether this address is already in the invited workspace, as its own row or
 * as a membership. `removed`: removed here (its own row: Directory, Removed,
 * to restore). `inactive`: removed or deactivated here. `elsewhere`: through
 * a membership, so the person is anchored in (working in) another workspace.
 *
 * A membership holds this workspace's own status (docs/plans/workspace-status.md
 * D1). A live one is a member. One this workspace ended (deactivated or
 * removed here) is NOT a member (D13): an invitation brings it back on
 * acceptance, so sendInvitation and /join treat the address as someone to
 * invite. It comes back with `inactive` (and `removed`) for the callers that
 * must not bring it back themselves (a Space editor's invitation or resend,
 * an account made directly, anyone below Admin): they refuse on `inactive`.
 *
 * Read from the membership's own seat whatever the account's state where it
 * is anchored (D1: User.deletedAt is the removal THERE; the step 2 review
 * M2): an account removed at home with a live seat here is a member here,
 * and one with an ended seat here is `inactive`. An erased account never
 * matches: its address is anonymised and every seat it had is ended.
 */
export async function alreadyInOrg(email: string, organizationId: string): Promise<{ member: boolean; inactive: boolean; removed: boolean; elsewhere: boolean }> {
  const own = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, organizationId },
    select: { deletedAt: true, status: true },
  });
  if (own) return { member: true, inactive: !!own.deletedAt || own.status === "INACTIVE", removed: !!own.deletedAt, elsewhere: false };
  const seats = await prisma.organizationMembership.findMany({
    where: { organizationId, user: { email: { equals: email.trim(), mode: "insensitive" } } },
    select: { status: true, removedAt: true },
  });
  if (seats.some(seatIsLive)) return { member: true, inactive: false, removed: false, elsewhere: true };
  if (seats.length > 0) return { member: false, inactive: true, removed: seats.some((m) => m.removedAt != null), elsewhere: true };
  return { member: false, inactive: false, removed: false, elsewhere: false };
}
