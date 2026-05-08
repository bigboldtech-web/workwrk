import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Identity (SAML / SCIM) is org-admin only — same trust level as
// billing or security. Configuring an IdP wrong locks employees
// out, so this is intentionally narrower than manager+.
export default async function IdentityLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
