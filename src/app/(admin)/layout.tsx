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
// gets a rendered denial, whose links are the ABSOLUTE app URL (only when
// NEXT_PUBLIC_APP_URL is set) and /login, which the admin host allows.

import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminSession, staffDenialReason } from "@/lib/platform-admin";
import { recordDeniedAccess, requestIp } from "@/lib/staff-audit";
import { LockedPage } from "@/components/access";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { getEffectivePreferences, DEFAULT_DENSITY, DEFAULT_THEME, type DensityPref } from "@/lib/preferences";
import { loadConsoleMe, staffEmailOf } from "@/lib/admin/console-me";
import { isAdminHost, productHref } from "@/lib/admin/console-nav";
import { AdminShell } from "./admin-shell";

/**
 * The staff member's OWN product preferences, read (never written) for the
 * console: appearance, density and Language & region. Their one home is My
 * settings > Preferences; a failure reads as the product defaults, never as
 * a broken console.
 */
async function personPrefs(userId: string | undefined, organizationId: string | undefined) {
  if (!userId || !organizationId) return { density: DEFAULT_DENSITY, appearance: DEFAULT_THEME.appearance, locale: {} };
  try {
    const p = await getEffectivePreferences(userId, organizationId);
    return { density: p.density as DensityPref, appearance: p.theme.appearance, locale: p.home.locale ?? {} };
  } catch {
    return { density: DEFAULT_DENSITY, appearance: DEFAULT_THEME.appearance, locale: {} };
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }

  const requestHeaders = await headers();
  const onAdmin = isAdminHost(requestHeaders.get("host"), process.env.ADMIN_HOST);

  const allowed = await isPlatformAdminSession(session);
  if (!allowed) {
    const backHref = productHref(WORK_HOME_HREF, appUrl, onAdmin);
    const user = session.user as { id?: string; email?: string | null };
    const email = user.email ?? "an account with no email";
    // One row per would-be viewer per ten minutes (spec section 1 Denial):
    // a person who hits the wall is recorded on /admin/audit, a script
    // hammering the host bumps one row's hit count. Never throws.
    await recordDeniedAccess({ email, userId: user.id ?? null, ip: requestIp(requestHeaders) });
    // The allow-list names an address, and only an account that has PROVEN
    // it owns that address gets in (platform-admin.ts). A real staff member
    // who has not verified yet is told how, not that they are not staff.
    const reason = await staffDenialReason(session);
    const sentence =
      reason === "unverified"
        ? `You are signed in as ${email}, which is on the WorkwrK staff list, but this account has not verified its email address. Verify it from My settings > Security, then open the console again.`
        : reason === "duplicate"
          ? `You are signed in as ${email}. More than one verified WorkwrK account uses this address, so the console opens for none of them. Ask another staff member to check the accounts.`
          : `You are signed in as ${email}. That account is not on the WorkwrK staff list.`;
    return (
      <div className="workwrk-os min-h-screen bg-app text-ink">
        <LockedPage
          glyph="shield"
          name="This console is for WorkwrK staff"
          sentence={sentence}
          // Absolute on the admin host, which bounces relative paths to
          // /admin: with no NEXT_PUBLIC_APP_URL there is no back link there
          // at all rather than one that loops to this page (productHref).
          back={backHref ? { fallbackHref: backHref, label: "WorkwrK" } : undefined}
          // A staff member signed in with their customer account (the
          // session cookie is shared across subdomains) switches here.
          elsewhere={{ href: "/login?callbackUrl=/admin", label: "Sign in with a different account" }}
        />
      </div>
    );
  }

  const user = session.user as { id?: string; email?: string | null; name?: string | null; organizationId?: string };
  const [email, prefs] = await Promise.all([staffEmailOf(session), personPrefs(user.id, user.organizationId)]);
  const me = await loadConsoleMe(email ?? "", user.name ?? null);
  const runbook = process.env.STAFF_RUNBOOK_URL?.trim() || null;

  return (
    <AdminShell
      staff={me.staff}
      prefs={me.prefs}
      recents={me.recents}
      persisted={me.persisted}
      density={prefs.density}
      appearance={prefs.appearance}
      datePrefs={{
        timezone: prefs.locale.timezone ?? null,
        dateFormat: prefs.locale.dateFormat ?? null,
        timeFormat: prefs.locale.timeFormat ?? null,
        language: prefs.locale.language ?? null,
      }}
      appUrl={appUrl}
      mySettingsHref={productHref("/account/preferences?tab=appearance", appUrl, onAdmin)}
      runbookUrl={runbook}
    >
      {children}
    </AdminShell>
  );
}
