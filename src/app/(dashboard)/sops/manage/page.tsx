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
 * Gated to users who can manage SOPs. The underlying write endpoints
 * additionally enforce org-admin — so a manager-but-not-admin still lands
 * here and sees honest 403 toasts on admin-only actions rather than a
 * hidden page.
 */

import Link from "next/link";
import { ArrowLeft, FolderTree } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useRole } from "@/hooks/use-role";
import { SopFoldersTagsManager } from "@/components/settings/sop-folders-tags-manager";

export default function SopManagePage() {
  const { canManageSOPs } = useRole();

  return (
    <>
      <OsTitleBar
        title="Organize SOPs"
        showStandardActions={false}
        Icon={FolderTree}
        iconGradient={GRAD.tealGreen}
        description="Categories, subcategories and tags — how your SOP library is organized."
        actions={
          <Link
            href="/sops"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to SOPs
          </Link>
        }
      />

      <div className="px-6 py-5">
        {!canManageSOPs ? (
          <OsEmptyView
            Icon={FolderTree}
            iconGradient={GRAD.redPink}
            title="Manager access required"
            subtitle="Organizing SOP categories, subcategories, and tags is limited to people who can manage SOPs."
          />
        ) : (
          <div className="max-w-4xl space-y-6">
            <SopFoldersTagsManager />
          </div>
        )}
      </div>
    </>
  );
}
