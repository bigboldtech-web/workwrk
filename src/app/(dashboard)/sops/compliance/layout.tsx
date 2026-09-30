// SOP compliance is a manager's dashboard, and the denial is a 404.
//
// Spec: docs/plans/ui-refresh/spec-process.md section 1 ("/sops/compliance,
// /policies/compliance | hasReports (their chain), People team, Owner, Admin
// | everyone else, Guests included: 404 inside the shell ... No LockedPage:
// there is no object and so no grant to request") and sidebar-map section 6
// row 12, which hides the row from the same people.
//
// WHAT IT REPLACES. Nothing gated the route, so a Member who found the URL
// got the page, which then rendered its 403 as a LOAD ERROR: "Couldn't load
// compliance / Manager access required. / Try again": a retry link on a
// permission the person will never have. A denial is not a failed fetch.
//
// The tier check is the same helper the Docs sidebar's `managerOnly` rows
// resolve through, so the row and the route cannot disagree.

import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { personScope } from "@/lib/process-scope";

export default async function SopComplianceLayout({ children }: { children: React.ReactNode }) {
  // The ledger's own API rule (personScope, the chain, the People team and
  // admins), so the page and GET /api/.../compliance give one answer: a
  // person the API would refuse gets the in-shell 404, not a load error.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!(await personScope(session)).canView) notFound();
  return <>{children}</>;
}
