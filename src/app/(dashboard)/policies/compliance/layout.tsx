// Policy compliance is a manager's dashboard, and the denial is a 404.
//
// Same rule and same reason as (dashboard)/sops/(app)/compliance/layout.tsx:
// spec-process section 1 puts both ledgers behind hasReports, the People team
// and admins, and sidebar-map section 6 row 14 hides the row from everybody
// else. Without a gate the page rendered its own 403 as "Couldn't load
// compliance / Try again", which offers a retry for a permission.

import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { personScope } from "@/lib/process-scope";

export default async function PolicyComplianceLayout({ children }: { children: React.ReactNode }) {
  // The ledger's own API rule (personScope, the chain, the People team and
  // admins), so the page and GET /api/.../compliance give one answer: a
  // person the API would refuse gets the in-shell 404, not a load error.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!(await personScope(session)).canView) notFound();
  return <>{children}</>;
}
