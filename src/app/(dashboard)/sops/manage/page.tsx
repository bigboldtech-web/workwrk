"use client";

/* SOPs · Organize — the taxonomy admin home.
 *
 * Mounts the folder + tag manager and the category/subcategory manager
 * (both previously built but imported nowhere). This is where SOPs are
 * administered, reachable from the "Organize" action on the SOP library.
 *
 * Gated to users who can manage SOPs. The underlying folder/tag write
 * endpoints additionally enforce org-admin; the category endpoints
 * enforce manager — so a manager-but-not-admin still lands here and sees
 * honest 403 toasts on admin-only actions rather than a hidden page.
 */

import Link from "next/link";
import { ArrowLeft, FolderTree } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useRole } from "@/hooks/use-role";
import { SopFoldersTagsManager } from "@/components/settings/sop-folders-tags-manager";
import { SopCategoryManager } from "@/components/settings/sop-category-manager";

export default function SopManagePage() {
  const { canManageSOPs } = useRole();

  return (
    <>
      <OsTitleBar
        title="Organize SOPs"
        showStandardActions={false}
        Icon={FolderTree}
        iconGradient={GRAD.tealGreen}
        description="Folders, tags, categories — the taxonomy SOP authors pick from."
        actions={
          <Link
            href="/sops"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50"
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
            subtitle="Organizing SOP folders, tags, and categories is limited to people who can manage SOPs."
          />
        ) : (
          <div className="max-w-4xl space-y-6">
            <SopFoldersTagsManager />
            <SopCategoryManager />
          </div>
        )}
      </div>
    </>
  );
}
