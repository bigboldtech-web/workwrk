import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Core Financials is org-admin only — GL data shouldn't surface
// under any other role. Reports are read-only views over the same
// tables; a future Phase 5 v2 may open them to designated finance
// roles via a dedicated AccessLevel tier.
export default async function FinancialsLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
