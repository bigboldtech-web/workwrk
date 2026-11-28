// A person as the alignment pages show them, by the seat they hold in THIS
// workspace (pen test 2026-11-28, V-43, and the step 4c review): their
// account's workspace alone missed everyone here through a membership, so a
// manager got "User not found" for a report who had opened another
// workspace, and that person could not open their own career home here.
// Their job title, department and manager are their seat's here; a removed
// seat is no one here.

import { prisma } from "@/lib/prisma";
import { personSeatIn } from "@/lib/access/acting-workspace";

export interface AlignmentCard {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  role: { id: string; title: string; description: string | null; level: string | null; department: { id: string; name: string } | null } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  department: { id: string; name: string } | null;
}

export async function alignmentPersonCard(organizationId: string, userId: string): Promise<AlignmentCard | null> {
  const seat = await personSeatIn(organizationId, userId);
  if (!seat || seat.removedAt) return null;
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, avatar: true, roleId: true, departmentId: true },
  });
  if (!account) return null;
  const roleId = seat.kind === "anchor" ? account.roleId : seat.placement?.roleId ?? null;
  const departmentId = seat.kind === "anchor" ? account.departmentId : seat.placement?.departmentId ?? null;
  const [role, manager, department] = await Promise.all([
    roleId
      ? prisma.role.findFirst({
          where: { id: roleId, organizationId },
          select: { id: true, title: true, description: true, level: true, department: { select: { id: true, name: true } } },
        })
      : null,
    seat.managerId ? prisma.user.findUnique({ where: { id: seat.managerId }, select: { id: true, firstName: true, lastName: true } }) : null,
    departmentId ? prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true, name: true } }) : null,
  ]);
  return {
    id: account.id,
    firstName: account.firstName,
    lastName: account.lastName,
    avatar: account.avatar ?? null,
    role: role ? { ...role, level: role.level == null ? null : String(role.level) } : null,
    manager,
    department,
  };
}
