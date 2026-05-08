import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Studio is org-admin only — workflows + custom fields are
// platform-shaping concerns; only people who own the org's
// configuration should see this surface.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
