"use client";

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

  const accessLevel = ((session?.user as any)?.accessLevel || "EMPLOYEE") as AccessLevel;
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

  const accessLevel = ((session?.user as any)?.accessLevel || "EMPLOYEE") as AccessLevel;

  return {
    loading: matrix === undefined,
    accessLevel,
    can: (module: PermissionModule, action: string) => {
      if (matrix === undefined) return false;
      return decide(accessLevel, matrix, module, action);
    },
  };
}
