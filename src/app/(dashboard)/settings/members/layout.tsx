import { requireManagerTierViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Members is a Workspace-settings page (registry gate owner-admin with the
// People team reading). The page renders read-only below Admin and the
// invitations API admits the manager tier, which is why the Teams "+" sends
// managers here with ?invite=1, so the gate is the manager tier: an
// Employee or Agent who types the URL gets the AdminOnly card at the same
// URL (spec-shell 1.6, 2.8), never a redirect and never a 404 (nothing
// under /settings 404s for a signed-in person).
export default async function MembersLayout({ children }: { children: React.ReactNode }) {
  if (!(await requireManagerTierViewer())) {
    return <AdminOnly page="Members" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
