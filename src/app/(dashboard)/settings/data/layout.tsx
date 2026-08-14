import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Data & compliance lives behind the Admin door (org-wide export of
// tenant data). Only the two protected admin tiers (SUPER_ADMIN /
// COMPANY_ADMIN) reach it — matching the audit log and the two-door
// settings split. The full-org export in particular pulls people,
// tasks, reviews and the activity trail, so a regular manager must not
// reach this surface even by URL-direct navigation.
export default async function SettingsDataLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
