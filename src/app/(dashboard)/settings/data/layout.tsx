import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Data & compliance lives behind the Admin door (org-wide export of
// tenant data). Only the two protected admin tiers (SUPER_ADMIN /
// COMPANY_ADMIN) reach it — matching the audit log and the two-door
// settings split. The full-org export in particular pulls people,
// tasks, reviews and the activity trail, so a regular manager must not
// reach this surface even by URL-direct navigation.
//
// Denial shape (spec-shell 1.6, 2.8): a non-admin who reaches this URL
// sees the AdminOnly card at the same URL, never a redirect and never a
// 404 (nothing under /settings 404s for a signed-in person).
export default async function SettingsDataLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Data" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
