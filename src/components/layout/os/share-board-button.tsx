"use client";

// ShareBoardButton — small client island for the Space detail page's
// per-board rows. Renders a tiny "Share" link + lock-icon hint when
// the board is already PRIVATE; opens ShareBoardDialog on click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Share2 } from "lucide-react";
import { ShareBoardDialog } from "./share-board-dialog";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";

interface Props {
  boardId: string;
  boardName: string;
  visibility: Visibility;
  parentSpaceName?: string | null;
}

export function ShareBoardButton({ boardId, boardName, visibility, parentSpaceName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 px-1.5 py-0.5 rounded hover:bg-zinc-100"
        title={visibility === "PRIVATE" ? "Private — manage members" : "Manage access"}
      >
        {visibility === "PRIVATE" ? (
          <Lock className="h-3 w-3 text-zinc-500" />
        ) : (
          <Share2 className="h-3 w-3" />
        )}
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
