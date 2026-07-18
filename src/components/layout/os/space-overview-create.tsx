"use client";

// Subtle "+" create affordances for the Space Overview cards (ClickUp keeps the
// prominent New Folder / New Board buttons out of the header and puts a small
// "+" on the Folders / Lists card headers instead). onMouseDown stops the
// react-grid drag handle from swallowing the click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { NewFolderDialog } from "./new-folder-dialog";
import { useOsShell } from "./shell-context";

const BTN =
  "inline-flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors";

// parentFolderId → create the new folder nested inside a folder (from a Folder
// page); null/omitted → at the Space root (the Space Overview card).
export function FolderCardCreate({ spaceId, parentFolderId = null }: { spaceId: string; parentFolderId?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        className={BTN}
        title="New Folder"
        aria-label="New Folder"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <NewFolderDialog
        open={open}
        onOpenChange={setOpen}
        spaceId={spaceId}
        parentFolderId={parentFolderId}
        onCreated={() => router.refresh()}
      />
    </>
  );
}

// folderId → the created List lands inside that folder; omitted → Space root.
export function ListCardCreate({ spaceId, folderId }: { spaceId: string; folderId?: string }) {
  const { openCreateList } = useOsShell();
  return (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => openCreateList({ spaceId, folderId })}
      className={BTN}
      title="New List"
      aria-label="New List"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  );
}
