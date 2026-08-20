"use client";

// BoardShareButton — client island for the Board detail page's title-row
// "Share" control. Mirrors SpaceShareButton: it opens the existing
// ShareBoardDialog (visibility + board members). Kept out of the board-view
// renderers so the server board page can drop it straight into the chrome.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { ShareBoardDialog } from "./share-board-dialog";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";

interface Props {
  boardId: string;
  boardName: string;
  visibility: Visibility;
  parentSpaceName?: string | null;
}

export function BoardShareButton({ boardId, boardName, visibility, parentSpaceName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13.5px] text-zinc-700 hover:text-zinc-900 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-zinc-100"
      >
        <Share2 className="w-3.5 h-3.5" />
        Share
      </button>
      <ShareBoardDialog
        open={open}
        onOpenChange={setOpen}
        boardId={boardId}
        boardName={boardName}
        initialVisibility={visibility}
        parentSpaceName={parentSpaceName}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
