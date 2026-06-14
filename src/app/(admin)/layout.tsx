// Server-side gate for the cross-tenant back-office (admin.workwrk.com).
//
// Platform STAFF only — resolved from the PlatformAdmin allowlist, NOT from
// tenant `User.accessLevel`. A customer's own SUPER_ADMIN is an admin of THEIR
// org, not of WorkwrK, and must never reach this surface or other tenants'
// data/ARR. The matching API routes (/api/admin/*) gate on the same check, so
// the security does not depend on this UI layer alone.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminSession } from "@/lib/platform-admin";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const allowed = await isPlatformAdminSession(session);
  // Non-staff (incl. customers' own super-admins) are bounced to the app and
  // never told the back-office exists.
  // NOTE: once admin.workwrk.com is live (subdomain phase), revisit this
  // target so it doesn't loop on the admin host — redirect to the app host.
  if (!allowed) redirect("/today");

  const email = (session.user as { email?: string | null }).email ?? null;
  return <AdminShell email={email}>{children}</AdminShell>;
}
