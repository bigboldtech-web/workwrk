import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Payroll is org-admin only. Pay groups, pay runs, and paystub
// totals contain salary data that managers shouldn't browse.
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
