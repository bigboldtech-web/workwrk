import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Defaults & locks lives behind the Admin door (org-wide configuration).
// It writes OrgPreference (org defaults + lockedKeys), which the effective-
// prefs merge stamps onto every member — so only the two protected admin
// tiers (SUPER_ADMIN / COMPANY_ADMIN) may reach it, matching the PATCH
// /api/org/preferences gate. The guard closes URL-direct access, not just
// nav visibility.
//
// Denial shape (spec-shell 1.6, 2.8): a non-admin who reaches this URL
// sees the AdminOnly card at the same URL, never a redirect and never a
// 404 (nothing under /settings 404s for a signed-in person).
export default async function DefaultsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Defaults & locks" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
