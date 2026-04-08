"use client";

import { useSession } from "next-auth/react";
import { usePermissions } from "./use-permission";

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
  const { can, loading } = usePermissions();

  const isExecutive = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL"].includes(accessLevel);
  const isMgr = MANAGER_ROLES.includes(accessLevel);
  const isAdm = ADMIN_ROLES.includes(accessLevel);

  // While permissions are loading, fall back to role-based defaults so the
  // UI doesn't flicker. Once loaded, we use the actual permission matrix.

  return {
    accessLevel,
    isManager: isMgr,
    isAdmin: isAdm,
    isEmployee: accessLevel === "EMPLOYEE" || accessLevel === "AGENT",
    isExecutive,
    canManagePeople: loading ? isMgr : can("people", "edit"),
    canManageSOPs: loading ? isMgr : can("sops", "create"),
    canManageReviews: loading ? isMgr : can("reviews", "create"),
    canManageKRAs: loading ? isMgr : can("kras", "create"),
    canInvite: loading ? isMgr : can("people", "create"),
    canViewAnalytics: loading ? isMgr : can("analytics", "view"),
  };
}
