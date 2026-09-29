import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { NOT_STAFF_CODE } from "./api-fetch";

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
  const lower = email.toLowerCase();
  const row = await prisma.platformAdmin.findUnique({
    where: { email: lower },
    select: { id: true },
  });
  if (row) return true;
  return bootstrapEmails().has(lower);
}

/**
 * The words every product path that would CREATE an account (or rename one)
 * with an address on the staff list answers with. Such an account's
 * password or identity provider is chosen by whoever creates it, not by the
 * owner of the mailbox, so it is refused at the door as well as at the
 * console's gate (staffAccountPasses). A staff member joins a customer
 * workspace by invitation, which proves the mailbox.
 */
export const STAFF_ADDRESS_REFUSAL =
  "This email address is reserved and can't be used here. Invite the person instead, so they accept from their own inbox.";

/** True when an account with this address may not be created or renamed to (see STAFF_ADDRESS_REFUSAL). */
export async function isReservedStaffAddress(email: string | null | undefined): Promise<boolean> {
  return isPlatformAdminEmail(email?.trim());
}

/**
 * LOCAL DEVELOPMENT ONLY. A fresh database has an empty PlatformAdmin table
 * and the only way onto the staff list is to be added by someone already on
 * it (POST /api/admin/platform-staff is itself staff-gated), so nobody can be
 * first. `PLATFORM_STAFF_BOOTSTRAP_EMAILS` (comma-separated, in .env.local)
 * names who counts as staff until their row exists: add yourself through
 * Staff console › Staff, then clear it. It is ignored entirely in production
 * (`next start` sets NODE_ENV=production), so the allow-list table stays the
 * one security boundary there.
 */
function bootstrapEmails(): Set<string> {
  if (process.env.NODE_ENV === "production") return new Set();
  const raw = process.env.PLATFORM_STAFF_BOOTSTRAP_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

interface SessionLike {
  user?: { id?: string; email?: string | null } | null;
}

/** The account facts the staff gate decides on (a User row, read by id). */
export interface StaffGateAccount {
  email: string;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  status: string;
}

/**
 * Pure rule for "this account may open the Staff console", given that its
 * email is on the staff list. The allow-list names an EMAIL, but User.email
 * is unique only per company: any customer admin can create a person in
 * their own workspace with a staff address that has no WorkwrK login yet and
 * choose its password. So a match counts only for an account whose address
 * was PROVEN (emailVerifiedAt, set solely by the emailed verify link, and
 * cleared by SCIM whenever it renames the address), that is live, and whose
 * session claim is still that address (a renamed account is refused until
 * it signs in again, so a StaffAction row always names the real address).
 */
export function staffAccountPasses(account: StaffGateAccount | null, claim: string | null | undefined): boolean {
  if (!account) return false;
  if (account.deletedAt) return false;
  if (account.status === "INACTIVE") return false;
  if (!account.emailVerifiedAt) return false;
  if (claim && claim.trim().toLowerCase() !== account.email.trim().toLowerCase()) return false;
  return true;
}

/**
 * Resolve platform-staff status from a NextAuth session. The decision is
 * made on the session's USER ROW, never on the email claim alone (see
 * staffAccountPasses for the takeover this closes).
 */
export async function isPlatformAdminSession(
  session: SessionLike | null | undefined,
): Promise<boolean> {
  const id = session?.user?.id;
  if (!id) return false;
  const account = await prisma.user.findUnique({
    where: { id },
    select: { email: true, emailVerifiedAt: true, deletedAt: true, status: true },
  });
  if (!account?.email) return false;
  if (!(await isPlatformAdminEmail(account.email))) return false;
  if (!staffAccountPasses(account, session?.user?.email ?? null)) return false;
  return (await otherVerifiedAccounts(id, account.email)) === 0;
}

/**
 * Live, verified accounts OTHER than this one that carry the same address.
 * Verification is by emailed link and the link names a row, not a mailbox
 * owner's intent: a staff member tricked into clicking a verify mail for a
 * look-alike account made by a customer would otherwise hand that account
 * the console. Two verified rows for one staff address therefore open the
 * console for neither (a lock-out another staff member resolves), never for
 * the wrong one.
 */
async function otherVerifiedAccounts(id: string, email: string): Promise<number> {
  return prisma.user.count({
    where: {
      id: { not: id },
      email: { equals: email.trim(), mode: "insensitive" },
      deletedAt: null,
      emailVerifiedAt: { not: null },
    },
  });
}

/**
 * Why a signed-in person is outside the console, for the denial copy only.
 * "unverified" means the address IS on the staff list but this account has
 * not proven it owns the mailbox, so the page can say how to get in.
 */
export async function staffDenialReason(
  session: SessionLike | null | undefined,
): Promise<"not_staff" | "unverified" | "duplicate"> {
  const id = session?.user?.id;
  if (!id) return "not_staff";
  const account = await prisma.user.findUnique({
    where: { id },
    select: { email: true, emailVerifiedAt: true, deletedAt: true, status: true },
  });
  if (!account?.email || !(await isPlatformAdminEmail(account.email))) return "not_staff";
  if (account.deletedAt || account.status === "INACTIVE") return "not_staff";
  if (!account.emailVerifiedAt) return "unverified";
  if ((await otherVerifiedAccounts(id, account.email)) > 0) return "duplicate";
  return "not_staff";
}

/**
 * The body of the staff gate's 403. The `code` is what the console's browser
 * side recognises (api-fetch.ts, NOT_STAFF_CODE): a staff member removed
 * while the console is open is told their access is gone instead of seeing
 * an endless "Could not load... Retry". It says nothing a non-staff caller
 * did not already know.
 */
export function staffGateRefusal() {
  return NextResponse.json(
    { error: "This account is not on the WorkwrK staff list", code: NOT_STAFF_CODE },
    { status: 403 },
  );
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
  return ok ? null : staffGateRefusal();
}
