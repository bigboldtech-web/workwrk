import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Identity (SAML / SCIM) is org-admin only — same trust level as
// billing or security. Configuring an IdP wrong locks employees
// out, so this is intentionally narrower than manager+.
//
// Denial shape (spec-shell 1.6, 2.8): a non-admin who reaches this URL
// sees the AdminOnly card at the same URL, never a redirect and never a
// 404 (nothing under /settings 404s for a signed-in person).
export default async function IdentityLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Identity & culture" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
