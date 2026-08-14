import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Defaults & locks lives behind the Admin door (org-wide configuration).
// It writes OrgPreference (org defaults + lockedKeys), which the effective-
// prefs merge stamps onto every member — so only the two protected admin
// tiers (SUPER_ADMIN / COMPANY_ADMIN) may reach it, matching the PATCH
// /api/org/preferences gate. The guard closes URL-direct access, not just
// nav visibility.
export default async function DefaultsLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
