import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { redirect } from "next/navigation";
import { AccessLevel } from "@/generated/prisma";

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(allowedRoles: AccessLevel[]) {
  const session = await requireAuth();
  const userRole = (session.user as any).accessLevel as AccessLevel;
  if (!allowedRoles.includes(userRole)) {
    redirect("/dashboard");
  }
  return session;
}

export function canManageUsers(accessLevel: AccessLevel): boolean {
  const managerRoles: AccessLevel[] = [
    AccessLevel.SUPER_ADMIN,
    AccessLevel.COMPANY_ADMIN,
    AccessLevel.C_LEVEL,
    AccessLevel.VP,
    AccessLevel.DIRECTOR,
    AccessLevel.MANAGER,
    AccessLevel.HR,
  ];
  return managerRoles.includes(accessLevel);
}

export function canViewAllData(accessLevel: AccessLevel): boolean {
  const viewAllRoles: AccessLevel[] = [
    AccessLevel.SUPER_ADMIN,
    AccessLevel.COMPANY_ADMIN,
    AccessLevel.C_LEVEL,
  ];
  return viewAllRoles.includes(accessLevel);
}

export function canManageOrg(accessLevel: AccessLevel): boolean {
  const orgAdminRoles: AccessLevel[] = [
    AccessLevel.SUPER_ADMIN,
    AccessLevel.COMPANY_ADMIN,
  ];
  return orgAdminRoles.includes(accessLevel);
}
