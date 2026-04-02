"use client";

import { useSession } from "next-auth/react";

const MANAGER_ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "VP",
  "DIRECTOR",
  "MANAGER",
  "TEAM_LEAD",
  "HR",
];

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "C_LEVEL",
  "HR",
];

export function useRole() {
  const { data: session } = useSession();
  const accessLevel = (session?.user as any)?.accessLevel || "EMPLOYEE";

  return {
    accessLevel,
    isManager: MANAGER_ROLES.includes(accessLevel),
    isAdmin: ADMIN_ROLES.includes(accessLevel),
    isEmployee: accessLevel === "EMPLOYEE" || accessLevel === "AGENT",
    canManagePeople: ADMIN_ROLES.includes(accessLevel),
    canManageSOPs: MANAGER_ROLES.includes(accessLevel),
    canManageReviews: MANAGER_ROLES.includes(accessLevel),
    canManageKRAs: MANAGER_ROLES.includes(accessLevel),
    canInvite: ADMIN_ROLES.includes(accessLevel),
    canViewAnalytics: MANAGER_ROLES.includes(accessLevel),
  };
}
