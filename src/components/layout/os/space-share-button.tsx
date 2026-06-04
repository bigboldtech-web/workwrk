"use client";

// SpaceShareButton — client island for the Space detail page's
// title-row "Share" button. Mounts ShareSpaceDialog on click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { ShareSpaceDialog } from "./share-space-dialog";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";

interface Props {
  spaceId: string;
  spaceName: string;
  initialVisibility: Visibility;
}

export function SpaceShareButton({ spaceId, spaceName, initialVisibility }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
      >
        <Share2 className="w-3.5 h-3.5" />
        Share
      </button>
      <ShareSpaceDialog
        open={open}
        onOpenChange={setOpen}
        spaceId={spaceId}
        spaceName={spaceName}
        initialVisibility={initialVisibility}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
