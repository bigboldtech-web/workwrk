"use client";

// SpaceActions — client island mounted in the (server-rendered) Space
// detail page. Owns the "+" buttons for adding folders and boards;
// opens the corresponding dialogs and calls router.refresh() on success
// so the page re-fetches Folders + Boards without a full reload.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Plus } from "lucide-react";
import { NewFolderDialog } from "./new-folder-dialog";
import { NewBoardDialog } from "./new-board-dialog";

export function SpaceActions({ spaceId, folderId }: { spaceId: string; folderId?: string | null }) {
  const router = useRouter();
  const [folderOpen, setFolderOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFolderOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm border border-border hover:bg-surface-2"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          New Folder
        </button>
        <button
          type="button"
          onClick={() => setBoardOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)]"
        >
          <Plus className="w-3.5 h-3.5" />
          New Board
        </button>
      </div>

      <NewFolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        spaceId={spaceId}
        parentFolderId={folderId ?? null}
        onCreated={() => router.refresh()}
      />

      <NewBoardDialog
        open={boardOpen}
        onOpenChange={setBoardOpen}
        spaceId={spaceId}
        folderId={folderId ?? null}
        onCreated={() => router.refresh()}
      />
    </>
  );
}
