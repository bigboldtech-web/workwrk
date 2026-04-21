import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { AccessLevel } from "@/generated/prisma";
import { prisma } from "./prisma";
import { checkPermission, type PermissionModule, type PermissionMatrix, type AccessLevel as PermAccessLevel } from "./permissions";

export async function getSessionOrFail() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }
  return { error: null, session };
}

export function getOrgId(session: any): string {
  return session.user.organizationId;
}

export function getUserId(session: any): string {
  return session.user.id;
}

export function hasRole(session: any, roles: AccessLevel[]): boolean {
  return roles.includes(session.user.accessLevel);
}

export function isManager(session: any): boolean {
  return hasRole(session, [
    "SUPER_ADMIN" as AccessLevel,
    "COMPANY_ADMIN" as AccessLevel,
    "C_LEVEL" as AccessLevel,
    "VP" as AccessLevel,
    "DIRECTOR" as AccessLevel,
    "MANAGER" as AccessLevel,
    "TEAM_LEAD" as AccessLevel,
    "HR" as AccessLevel,
  ]);
}

/** Organization-level admin. Gates org-structure changes like creating
 *  SOP folders and assigning access to them — the SOP folder system
 *  uses this to keep "who can see what" under a small trusted group. */
export function isOrgAdmin(session: any): boolean {
  return hasRole(session, [
    "SUPER_ADMIN" as AccessLevel,
    "COMPANY_ADMIN" as AccessLevel,
  ]);
}

export function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonSuccess(data: any, status: number = 200, headers?: HeadersInit) {
  return NextResponse.json(data, headers ? { status, headers } : { status });
}

/**
 * Common Cache-Control header for authed, read-only endpoints that return
 * lookup/reference data (departments, roles, categories, offices, etc.)
 * which change infrequently. Keeps per-user caching (`private`), short
 * fresh window, and a longer stale-while-revalidate tail so navigation
 * feels instant while still self-healing after writes.
 */
export const LOOKUP_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
} as const;

// ============================================
// Permission checks
// ============================================

// Per-request cache to avoid hitting DB repeatedly within one request
const permissionCache = new WeakMap<object, PermissionMatrix | null>();

async function getOrgPermissionMatrix(session: any): Promise<PermissionMatrix | null> {
  if (permissionCache.has(session)) return permissionCache.get(session)!;
  try {
    const orgId = getOrgId(session);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    const matrix = ((org?.settings as any)?.permissions || null) as PermissionMatrix | null;
    permissionCache.set(session, matrix);
    return matrix;
  } catch {
    return null;
  }
}

/**
 * Check if the current user has permission for a module/action.
 * Falls back to defaults if no custom matrix exists.
 */
export async function hasPermission(
  session: any,
  module: PermissionModule,
  action: string
): Promise<boolean> {
  const accessLevel = session.user.accessLevel as PermAccessLevel;
  const matrix = await getOrgPermissionMatrix(session);
  return checkPermission(accessLevel, matrix, module, action);
}

/**
 * Convenience: check permission and return a 403 jsonError if denied.
 * Returns null if allowed, the error response if denied.
 */
export async function requirePermission(
  session: any,
  module: PermissionModule,
  action: string
) {
  const allowed = await hasPermission(session, module, action);
  if (!allowed) return jsonError("Forbidden — insufficient permissions", 403);
  return null;
}
