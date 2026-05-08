import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Policy management is org-admin only — same rationale as
// /settings/tags. Managers view/use policies but only owners
// shape them.
export default async function TimeOffPoliciesLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
