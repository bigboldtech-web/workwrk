import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Benefits is org-admin only. Carrier rates + dependent PII are
// not appropriate for line managers.
export default async function BenefitsLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
