"use client";

// The two ghost rows at the foot of a Folder's Contents table.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2, `/folders/[id]`:
// "'+ New list' ghost row last (Can edit and above)".
//
// `space-overview-create.tsx` renders the same two actions as bare 24px "+"
// glyphs, which reads fine in the corner of a card whose title already says
// "Lists" and reads as nothing at the bottom of an empty table. Same
// destinations (`openCreateList` and `NewFolderDialog`), with the words.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { NewFolderDialog } from "@/components/layout/os/new-folder-dialog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { treeChanged } from "@/lib/work/container-events";

const ROW =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-base text-ink-2 hover:bg-hover hover:text-ink transition-colors";

export function NewListGhostRow({ spaceId, folderId }: { spaceId: string; folderId: string }) {
  const { openCreateList } = useOsShell();
  return (
    <button type="button" className={ROW} onClick={() => openCreateList({ spaceId, folderId })}>
      <Plus className="h-3.5 w-3.5" />
      New list
    </button>
  );
}

export function NewFolderGhostRow({ spaceId, parentFolderId }: { spaceId: string; parentFolderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={ROW} onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        New folder
      </button>
      <NewFolderDialog
        open={open}
        onOpenChange={setOpen}
        spaceId={spaceId}
        parentFolderId={parentFolderId}
        onCreated={() => {
          setOpen(false);
          refreshSidebar();
          treeChanged({ kind: "folder", action: "created" });
          router.refresh();
        }}
      />
    </>
  );
}
