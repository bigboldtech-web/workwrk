// Server-side gate for the Staff console (admin.workwrk.com).
//
// Platform STAFF only, resolved from the PlatformAdmin allow-list, NOT from
// tenant `User.accessLevel`. A customer's own SUPER_ADMIN is an admin of THEIR
// workspace, not of WorkwrK, and must never reach this surface or another
// company's data. The matching API routes (/api/admin/*) gate on the same
// check (src/app/api/admin/require-platform-admin.test.ts asserts it for
// every file), so security does not depend on this layout alone.
//
// LOOP SAFETY: on the admin host the proxy bounces every non-/admin path back
// to /admin. So this file never redirects to a relative app path: an
// unauthenticated person goes to /login (allowed on the admin host, with
// callbackUrl bringing them back), and a signed-in person who is not staff
// gets a rendered denial, whose only link is the ABSOLUTE app URL.

import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminSession } from "@/lib/platform-admin";
import { recordDeniedAccess, requestIp } from "@/lib/staff-audit";
import { LockedPage } from "@/components/access";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }

  const allowed = await isPlatformAdminSession(session);
  if (!allowed) {
    const user = session.user as { id?: string; email?: string | null };
    const email = user.email ?? "an account with no email";
    // One row per would-be viewer per ten minutes (spec section 1 Denial):
    // a person who hits the wall is recorded on /admin/audit, a script
    // hammering the host bumps one row's hit count. Never throws.
    await recordDeniedAccess({ email, userId: user.id ?? null, ip: requestIp(await headers()) });
    return (
      <div className="workwrk-os min-h-screen bg-app text-ink">
        <LockedPage
          glyph="shield"
          name="This console is for WorkwrK staff"
          sentence={`You are signed in as ${email}. That account is not on the WorkwrK staff list.`}
          back={{
            // Absolute on purpose: the admin host bounces relative paths to /admin.
            fallbackHref: appUrl ? `${appUrl}${WORK_HOME_HREF}` : WORK_HOME_HREF,
            label: "WorkwrK",
          }}
        />
      </div>
    );
  }

  const email = (session.user as { email?: string | null }).email ?? null;
  return <AdminShell email={email}>{children}</AdminShell>;
}
