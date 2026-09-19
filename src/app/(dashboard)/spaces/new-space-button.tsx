"use client";

// The one primary on /spaces.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/spaces`
// Toolbar: "the one primary 'New Space' (`Plus`, 36px, `--os-brand`) rendered
// only when the viewer may create one". audit Low #30: the page that lists
// Spaces had no way to make one, and the only door was a "+" that appears on
// hover of a sidebar section label.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { NewSpaceDialog } from "@/components/layout/os/new-space-dialog";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { treeChanged } from "@/lib/work/container-events";

export function NewSpaceButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 text-base font-medium text-ink-inv hover:bg-brand-hover"
      >
        <Plus className="h-4 w-4" />
        New Space
      </button>
      <NewSpaceDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(s) => {
          setOpen(false);
          refreshSidebar();
          treeChanged({ kind: "space", action: "created" });
          if (s?.slug) router.push(`/spaces/${s.slug}`);
          else router.refresh();
        }}
      />
    </>
  );
}
