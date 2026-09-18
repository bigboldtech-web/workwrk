import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { SettingsOverviewClient } from "./overview-client";

// The Workspace settings Overview (registry gate owner-admin). A signed-in
// person below Admin who types /settings gets the AdminOnly card at the same
// URL (spec-shell 1.6, 2.8): never a redirect and never a 404, because the
// personal door shares the prefix. The card body is overview-client.tsx.
export default async function SettingsOverviewPage() {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Workspace settings" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <SettingsOverviewClient />;
}
