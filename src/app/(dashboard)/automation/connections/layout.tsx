// /automation/connections is an Owner and Admin page (sidebar-map 3 row 9,
// naming-canon 2.13): connecting a provider needs the org's credentials and
// the API refuses everyone else. A Member who reaches the URL gets the
// LockedPage at the same URL (back-map 3), with the rail, sidebar and bar
// intact and no Request access, because a role is not something an owner
// can grant from a request. Server layout, so a typed URL meets the same
// gate as the sidebar row.

import { isOrgAdminViewer } from "@/lib/route-guard";
import { LockedPage } from "@/components/access";

export default async function ConnectionsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return (
      <LockedPage
        name="Connections"
        sentence="Connections are managed by workspace Owners and Admins."
        back={{ fallbackHref: "/automation/workflows", label: "Workflows" }}
      />
    );
  }
  return <>{children}</>;
}
