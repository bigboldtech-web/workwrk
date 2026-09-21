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

import { requireManagerOr404 } from "@/lib/route-guard";

export default async function SopComplianceLayout({ children }: { children: React.ReactNode }) {
  await requireManagerOr404();
  return <>{children}</>;
}
