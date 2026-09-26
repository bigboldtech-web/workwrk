// /automation/connections is an Owner and Admin page (sidebar-map 3 row 9,
// naming-canon 2.13): connecting a provider needs the org's credentials and
// the API refuses everyone else. A Member who reaches the URL gets the
// LockedPage at the same URL (back-map 3), with the rail, sidebar and bar
// intact and no Request access, because a role is not something an owner
// can grant from a request. Server layout, so a typed URL meets the same
// gate as the sidebar row.

import { isOrgAdminViewer } from "@/lib/route-guard";
import { viewerFromSession } from "@/lib/access/viewer";
import { listOrgAdmins } from "@/lib/access/admins";
import { LockedPage } from "@/components/access";

export default async function ConnectionsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    // The Owners and Admins who can connect things, so "Ask an admin" has
    // someone to reach (spec-ai-automation 1.4 item 5).
    const viewer = await viewerFromSession().catch(() => null);
    const admins = viewer ? await listOrgAdmins(viewer.organizationId).catch(() => []) : [];
    return (
      <LockedPage
        admins={admins}
        name="Connections"
        sentence="Connections are managed by workspace Owners and Admins."
        back={{ fallbackHref: "/automation/workflows", label: "Workflows" }}
        elsewhere={{ href: "/integrations", label: "Browse Integrations" }}
      />
    );
  }
  return <>{children}</>;
}
