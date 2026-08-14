import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Audit log lives behind the Admin door (org configuration). Only the
// two protected admin tiers (SUPER_ADMIN / COMPANY_ADMIN) reach it —
// matching the export route, which is admin-only, and the two-door
// settings split. Regular managers see the operational surfaces, not
// the org-wide audit trail.
export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
