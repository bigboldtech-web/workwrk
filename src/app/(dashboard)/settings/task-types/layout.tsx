import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Task system is a Workspace-settings page (settings-registry gate). A viewer
// below the gate who reaches this URL sees the AdminOnly card at the same
// URL (spec-shell 1.6, 2.8): never a redirect, never read-only org data and
// never a 404, because the personal door shares the /settings prefix.
export default async function GatedSettingsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Task system" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
