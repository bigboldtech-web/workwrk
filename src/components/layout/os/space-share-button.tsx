"use client";

// SpaceShareButton: the Space page's title-row Share, a client island on a
// server page. It keeps its props (the page passes the Space's id, name and
// visibility) and renders the one ShareButton for a Space, so the Space opens
// the same Manage access dialog every other node does, and the page refreshes
// after a change (ShareButton's refreshOnChange). The dialog's title follows
// what the server says the viewer may do there.

import { ShareButton } from "@/components/access/share-button";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";

interface Props {
  spaceId: string;
  spaceName: string;
  initialVisibility: Visibility;
}

export function SpaceShareButton({ spaceId, spaceName, initialVisibility }: Props) {
  // Share reads the same for everyone here, as it always did: whether the
  // dialog writes or only reads is the server's answer, not this button's.
  return (
    <ShareButton
      target={{ kind: "space", id: spaceId, name: spaceName, visibility: initialVisibility }}
      canManage
      label="Share"
      className="os-chrome inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
    />
  );
}
