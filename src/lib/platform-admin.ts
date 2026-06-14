import { prisma } from "./prisma";
import { jsonError } from "./api-helpers";

/**
 * Platform-staff gate for the cross-tenant back-office (admin.workwrk.com).
 *
 * "Platform staff" = WorkwrK's OWN employees, looked up in the PlatformAdmin
 * allowlist by email. This is deliberately decoupled from tenant
 * `User.accessLevel` — a customer's SUPER_ADMIN is an admin of THEIR org, not
 * of the platform, and must never see other tenants' data or ARR.
 */
export async function isPlatformAdminEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const row = await prisma.platformAdmin.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  return Boolean(row);
}

interface SessionLike {
  user?: { id?: string; email?: string | null } | null;
}

/** Resolve platform-staff status from a NextAuth session. */
export async function isPlatformAdminSession(
  session: SessionLike | null | undefined,
): Promise<boolean> {
  const email = session?.user?.email;
  if (email) return isPlatformAdminEmail(email);
  // Session had no email claim — fall back to the user row.
  const id = session?.user?.id;
  if (!id) return false;
  const u = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  return isPlatformAdminEmail(u?.email);
}

/**
 * API-route guard. Returns a 403 response when the caller isn't platform
 * staff, or `null` when they are (so the route continues).
 *
 *   const denied = await requirePlatformAdminApi(session);
 *   if (denied) return denied;
 */
export async function requirePlatformAdminApi(
  session: SessionLike | null | undefined,
) {
  const ok = await isPlatformAdminSession(session);
  return ok ? null : jsonError("Forbidden", 403);
}
