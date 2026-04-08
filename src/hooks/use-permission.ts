"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { checkPermission, type PermissionMatrix, type PermissionModule, type AccessLevel } from "@/lib/permissions";

// Module-level cache so multiple components share the same matrix fetch
let cachedMatrix: PermissionMatrix | null | undefined = undefined;
let inFlight: Promise<PermissionMatrix | null> | null = null;

async function fetchMatrix(): Promise<PermissionMatrix | null> {
  if (cachedMatrix !== undefined) return cachedMatrix as PermissionMatrix | null;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/permissions")
    .then((r) => (r.ok ? r.json() : { matrix: null }))
    .then((d) => {
      cachedMatrix = d?.matrix || null;
      return cachedMatrix as PermissionMatrix | null;
    })
    .catch(() => {
      cachedMatrix = null;
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function invalidatePermissionCache() {
  cachedMatrix = undefined;
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
  return checkPermission(accessLevel, matrix, module, action);
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
      return checkPermission(accessLevel, matrix, module, action);
    },
  };
}
