// Policy compliance is a manager's dashboard, and the denial is a 404.
//
// Same rule and same reason as (dashboard)/sops/compliance/layout.tsx:
// spec-process section 1 puts both ledgers behind hasReports, the People team
// and admins, and sidebar-map section 6 row 14 hides the row from everybody
// else. Without a gate the page rendered its own 403 as "Couldn't load
// compliance / Try again", which offers a retry for a permission.

import { requireManagerOr404 } from "@/lib/route-guard";

export default async function PolicyComplianceLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOr404();
  return <>{children}</>;
}
