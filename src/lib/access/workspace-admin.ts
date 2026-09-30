// The interim Workspace-settings write gates (Phase 8). ONE place, inside
// src/lib/access, so no route reads a level itself:
//
//   sessionIsWorkspaceAdmin     Owner and Admin (SUPER_ADMIN, COMPANY_ADMIN),
//                               the people who can open the settings page the
//                               route serves.
//   sessionIsWorkspaceOwner     an Owner: SUPER_ADMIN, or the org's earliest
//                               live COMPANY_ADMIN (org-role.ts spec 2.1,
//                               ownerIdsFor in src/lib/admin/company-detail).
//   sessionMayManageOwnerPage   the Owner-only pages and actions (Security,
//                               API, Billing, Retention, Danger zone). Until
//                               SETTINGS_OWNER_SPLIT=true (default OFF) every
//                               Admin still counts, which is today's reach:
//                               the split turns on only after the pre-flight
//                               report naming each org's Owner is approved.
//
// The engine's requireCan("manage", { type: "settings", page }) replaces
// these at the door-gate stage without touching the call sites' shape.
import { legacyIsAdminLevel, legacyIsManagerLevel } from "./legacy-levels";
import { ownerIdsFor } from "@/lib/admin/company-detail";
import { prisma } from "@/lib/prisma";

type SessionLike = { user?: { id?: string; accessLevel?: string; organizationId?: string } } | null | undefined;

export function sessionIsWorkspaceAdmin(session: unknown): boolean {
  const level = (session as SessionLike)?.user?.accessLevel;
  return legacyIsAdminLevel(level);
}

/**
 * Who may open Members, Access and Scoring today (the legacy manager tier,
 * HR included), read-only below Admin. The engine's People-team rule
 * replaces this at the door-gate stage.
 */
export function sessionIsSettingsReader(session: unknown): boolean {
  return legacyIsManagerLevel((session as SessionLike)?.user?.accessLevel);
}

/** Read at request time, so a local test can flip it in .env.local without a restart of the code path. */
export function ownerSplitOn(): boolean {
  return process.env.SETTINGS_OWNER_SPLIT === "true";
}

export async function sessionIsWorkspaceOwner(session: unknown): Promise<boolean> {
  const u = (session as SessionLike)?.user;
  if (!u?.id || !u.organizationId || !legacyIsAdminLevel(u.accessLevel)) return false;
  if (u.accessLevel === "SUPER_ADMIN") return true;
  const owners = await ownerIdsFor(u.organizationId);
  return owners.includes(u.id);
}

export async function sessionMayManageOwnerPage(session: unknown): Promise<boolean> {
  if (!sessionIsWorkspaceAdmin(session)) return false;
  if (!ownerSplitOn()) return true;
  return sessionIsWorkspaceOwner(session);
}

export type FreshActor =
  | { ok: true; level: string; admin: boolean; owner: boolean }
  | { ok: false; status: 401 | 403; error: string; code: "stale_session" };

const STALE: FreshActor = {
  ok: false,
  status: 403,
  error: "Your access changed a moment ago. Reload the page and sign in again if asked.",
  code: "stale_session",
};

/**
 * The actor as the DATABASE has them now, for every route that changes who
 * can do what (role changes, ownership, sign-out-everyone, the sign-in
 * policy, retention, API keys). The session token is re-checked only every
 * five minutes (src/lib/auth.ts), so an Admin demoted a moment ago still
 * carries an Admin token; on these routes that token is refused at once
 * (access invariant 9: lowered access lands on the very next request).
 *
 * Refused when the account is removed or deactivated, when its tokenVersion
 * moved past the one this session carries (signed out elsewhere, or a
 * demotion's bump), or when the level held in the workspace this session
 * acts in is no longer an admin level while the session says Admin.
 */
export async function freshWorkspaceActor(session: unknown): Promise<FreshActor> {
  const u = (session as SessionLike & { user?: { tokenVersion?: number } })?.user;
  if (!u?.id || !u.organizationId) return { ok: false, status: 401, error: "Unauthorized", code: "stale_session" };
  const row = await prisma.user.findUnique({
    where: { id: u.id },
    select: { deletedAt: true, status: true, accessLevel: true, organizationId: true, tokenVersion: true },
  });
  if (!row || row.deletedAt || row.status === "INACTIVE") return STALE;
  if (typeof u.tokenVersion === "number" && u.tokenVersion !== row.tokenVersion) return STALE;
  let level: string | null = row.organizationId === u.organizationId ? row.accessLevel : null;
  if (level === null) {
    const held = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: u.id, organizationId: u.organizationId } },
      select: { role: true },
    });
    level = held?.role ?? null;
  }
  if (!level) return STALE;
  // Both must say Admin: the database (a demotion lands now) and the session
  // (a promotion lands on the next session check, as before). A move between
  // the two admin levels (an implicit Owner written as an explicit one by an
  // ownership transfer) never refuses anyone.
  const admin = legacyIsAdminLevel(level) && legacyIsAdminLevel(u.accessLevel);
  if (legacyIsAdminLevel(u.accessLevel) && !admin) return STALE;
  const owner = admin && (level === "SUPER_ADMIN" || (await ownerIdsFor(u.organizationId)).includes(u.id));
  return { ok: true, level, admin, owner };
}

/** freshWorkspaceActor, then the Owner page rule (every Admin until SETTINGS_OWNER_SPLIT). */
export function freshMayManageOwnerPage(a: FreshActor): boolean {
  return a.ok && a.admin && (!ownerSplitOn() || a.owner);
}
