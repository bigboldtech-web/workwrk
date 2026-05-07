import { requireOrgAdminOrRedirect } from "@/lib/route-guard";

// Tags are an org-wide configuration surface. Manager+ shouldn't
// be able to create / rename / delete cost centers or business
// units — that's owner-level metadata.
export default async function SettingsTagsLayout({ children }: { children: React.ReactNode }) {
  await requireOrgAdminOrRedirect();
  return <>{children}</>;
}
