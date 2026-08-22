import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Apps lives behind the Admin door (org-wide configuration). It writes
// OrgPreference.sidebarDefault.apps, the org rail config every member's
// left rail renders from, so only the two protected admin tiers
// (SUPER_ADMIN / COMPANY_ADMIN) may reach it, matching the PATCH
// /api/org/preferences gate. The guard closes URL-direct access, not
// just nav visibility. Same pattern as settings/defaults/layout.tsx.
export default async function AppsSettingsLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
