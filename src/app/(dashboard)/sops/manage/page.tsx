"use client";

/* SOPs · Organize — the taxonomy admin home.
 *
 * One taxonomy: the SOPFolder tree IS the category system (top-level =
 * Category, child = Subcategory), so only SopFoldersTagsManager mounts
 * here. The legacy string-based SopCategoryManager (/api/sop-categories)
 * must NOT be mounted again — it would let admins edit category strings
 * the API now mirrors from the tree. Reachable from the "Organize" action
 * on the SOP library.
 *
 * Gated to users who can manage SOPs; everyone else gets the LockedPage at
 * this URL (spec-shell 1.6, back-map 6), never an empty-state drawing. The
 * underlying write endpoints additionally enforce org-admin, so a
 * manager-but-not-admin still lands here and sees honest 403 toasts on
 * admin-only actions rather than a hidden page.
 */


import { OsPageHeader } from "@/components/layout/os/page-header";
import { LockedPage } from "@/components/access";
import { useRole } from "@/hooks/use-role";
import { SopFoldersTagsManager } from "@/components/settings/sop-folders-tags-manager";

export default function SopManagePage() {
  const { canManageSOPs } = useRole();

  if (!canManageSOPs) {
    return (
      <LockedPage
        name="Organize SOPs"
        sentence="Organizing SOP categories and tags is limited to people who can manage SOPs."
        back={{ fallbackHref: "/sops", label: "SOPs" }}
      />
    );
  }

  return (
    <>
      <OsPageHeader
        title="Organize SOPs"
        back={{ fallbackHref: "/sops", label: "SOPs" }}
      />

      <div className="px-6 py-5">
        <div className="max-w-4xl space-y-6">
          <SopFoldersTagsManager />
        </div>
      </div>
    </>
  );
}
