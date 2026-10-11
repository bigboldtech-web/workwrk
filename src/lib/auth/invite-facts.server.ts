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
    inv.managerId ? prisma.user.findFirst({ where: { id: inv.managerId, organizationId: inv.organizationId, deletedAt: null }, select: { firstName: true, lastName: true } }) : null,
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

/** A live account anywhere on the platform for this address (the person who can log in with it). */
export async function liveAccountFor(email: string): Promise<{ id: string; organizationId: string } | null> {
  return prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, deletedAt: null, status: { not: "INACTIVE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true },
  });
}

/**
 * Whether this address is already in the invited workspace, as its own row or
 * as a membership. `removed`: its own row was removed (Directory, Removed, to
 * restore). `inactive`: removed or deactivated. `elsewhere`: in only through a
 * membership, so the person is anchored in (working in) another workspace.
 */
export async function alreadyInOrg(email: string, organizationId: string): Promise<{ member: boolean; inactive: boolean; removed: boolean; elsewhere: boolean }> {
  const own = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" }, organizationId },
    select: { deletedAt: true, status: true },
  });
  if (own) return { member: true, inactive: !!own.deletedAt || own.status === "INACTIVE", removed: !!own.deletedAt, elsewhere: false };
  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId, user: { email: { equals: email.trim(), mode: "insensitive" }, deletedAt: null } },
    select: { id: true },
  });
  return { member: !!membership, inactive: false, removed: false, elsewhere: !!membership };
}
