"use client";

// The legacy client permission hooks (useRole, usePermission, usePermissions),
// moved beside the engine in access step 6 (Phase 8 stage F) from
// src/hooks/use-role.ts and src/hooks/use-permission.ts, unchanged in what
// they answer. They are the one place on the client that still reads the
// level and the stored permission grid; the ESLint rule forbids that reading
// everywhere outside src/lib/access/, so no new copy can appear. They are
// replaced call site by call site with useAccess(ref) / useViewer() as each
// surface moves onto an ObjectRef, and deleted at access step 8.

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { checkPermission, type PermissionMatrix, type PermissionModule, type AccessLevel } from "@/lib/permissions";

// Module-level cache so multiple components share the same matrix fetch.
//
// `cells` (ACCESS_V2_RESOLVER on, Phase 8 stage E): the cells the access
// engine owns (src/lib/access/matrix-rules.ts), answered by the server for
// this person exactly as hasPermission answers them. A cell named there wins
// over the stored matrix, so a control shows exactly when its handler's gate
// lets it through. Null with the flag off, and the matrix decides as before.
let cachedMatrix: PermissionMatrix | null | undefined = undefined;
let cachedCells: Record<string, boolean> | null = null;
let inFlight: Promise<PermissionMatrix | null> | null = null;

async function fetchMatrix(): Promise<PermissionMatrix | null> {
  if (cachedMatrix !== undefined) return cachedMatrix as PermissionMatrix | null;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/permissions")
    .then((r) => (r.ok ? r.json() : { matrix: null }))
    .then((d) => {
      cachedMatrix = d?.matrix || null;
      cachedCells = d?.cells && typeof d.cells === "object" ? (d.cells as Record<string, boolean>) : null;
      return cachedMatrix as PermissionMatrix | null;
    })
    .catch(() => {
      cachedMatrix = null;
      cachedCells = null;
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function invalidatePermissionCache() {
  cachedMatrix = undefined;
  cachedCells = null;
}

function decide(accessLevel: AccessLevel, matrix: PermissionMatrix | null, module: PermissionModule, action: string): boolean {
  const cell = cachedCells?.[`${module}.${action}`];
  if (typeof cell === "boolean") return cell;
  return checkPermission(accessLevel, matrix, module, action);
}

/**
 * Hook to check a single permission. Returns null while loading.
 */
export function usePermission(module: PermissionModule, action: string): boolean | null {
  const { data: session } = useSession();
  const [matrix, setMatrix] = useState<PermissionMatrix | null | undefined>(cachedMatrix);

  useEffect(() => {
    if (matrix === undefined) {
      fetchMatrix().then((m) => setMatrix(m));
    }
  }, [matrix]);

  if (matrix === undefined) return null;

  const accessLevel = ((session?.user as { accessLevel?: string } | undefined)?.accessLevel || "EMPLOYEE") as AccessLevel;
  return decide(accessLevel, matrix, module, action);
}

/**
 * Hook to get the full permission matrix and access level — useful when
 * a component needs to check multiple permissions.
 */
export function usePermissions() {
  const { data: session } = useSession();
  const [matrix, setMatrix] = useState<PermissionMatrix | null | undefined>(cachedMatrix);

  useEffect(() => {
    if (matrix === undefined) {
      fetchMatrix().then((m) => setMatrix(m));
    }
  }, [matrix]);

  const accessLevel = ((session?.user as { accessLevel?: string } | undefined)?.accessLevel || "EMPLOYEE") as AccessLevel;

  return {
    loading: matrix === undefined,
    accessLevel,
    can: (module: PermissionModule, action: string) => {
      if (matrix === undefined) return false;
      return decide(accessLevel, matrix, module, action);
    },
  };
}

// ── useRole (was src/hooks/use-role.ts) ──


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
  const accessLevel = (session?.user as { accessLevel?: string } | undefined)?.accessLevel || "EMPLOYEE";
  const { can, loading } = usePermissions();

  const isExecutive = ["SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL"].includes(accessLevel);
  const isMgr = MANAGER_ROLES.includes(accessLevel);
  const isAdm = ADMIN_ROLES.includes(accessLevel);
  const isSuperAdm = accessLevel === "SUPER_ADMIN";

  // While permissions are loading, fall back to role-based defaults so the
  // UI doesn't flicker. Once loaded, we use the actual permission matrix.

  return {
    accessLevel,
    isManager: isMgr,
    isAdmin: isAdm,
    isSuperAdmin: isSuperAdm,
    isEmployee: accessLevel === "EMPLOYEE" || accessLevel === "AGENT",
    isExecutive,
    canManagePeople: loading ? isMgr : can("people", "edit"),
    canManageSOPs: loading ? isMgr : can("sops", "create"),
    // PATCH /api/sops/[id] asks for sops.edit, and the permission matrix
    // shows "Edit SOPs" as its own cell, so the edit doors on the SOP page
    // ask the same question instead of borrowing sops.create.
    canEditSOPs: loading ? isMgr : can("sops", "edit"),
    // POST /api/policies asks for exactly this, so the "New policy" primary
    // can ask the same question the route answers instead of guessing a tier.
    canManagePolicies: loading ? isMgr : can("policies", "create"),
    canPublishSOPs: loading ? isMgr : can("sops", "publish"),
    canManageReviews: loading ? isMgr : can("reviews", "create"),
    canManageKRAs: loading ? isMgr : can("kras", "create"),
    canInvite: loading ? isMgr : can("people", "create"),
    canViewAnalytics: loading ? isMgr : can("analytics", "view"),
  };
}
