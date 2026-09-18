import { isOrgAdminViewer } from "@/lib/route-guard";
import { AdminOnly } from "@/components/access";
import { SHELL_LABELS } from "@/lib/nav/labels";

// Tags are an org-wide configuration surface. Manager+ shouldn't
// be able to create / rename / delete cost centers or business
// units — that's owner-level metadata.
//
// Denial shape (spec-shell 1.6, 2.8): a non-admin who reaches this URL
// sees the AdminOnly card at the same URL, never a redirect and never a
// 404 (nothing under /settings 404s for a signed-in person).
export default async function SettingsTagsLayout({ children }: { children: React.ReactNode }) {
  if (!(await isOrgAdminViewer())) {
    return <AdminOnly page="Tags & labels" back={{ fallbackHref: "/account/profile", label: SHELL_LABELS.mySettings }} />;
  }
  return <>{children}</>;
}
