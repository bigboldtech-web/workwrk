"use client";

// ShareDialog — one door for "who can open this", whatever "this" is.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 0 (`ShareSpaceDialog`,
// `ShareBoardDialog`, `ShareFolderDialog` become one `ShareDialog`) and section
// 3 (the three container flavours), against access-model-spec section 6.1.
//
// WHAT THIS FIXES TODAY, before the three bodies are merged line by line. Three
// dialogs meant three call shapes, and every host had to know which one it
// wanted and what props that one took: `share-space-button.tsx`,
// `board-share-button.tsx`, `share-board-button.tsx` and
// `folder-more-menu.tsx` each hard-wired a different component with a different
// prop name for the same id. That is why the sidebar List menu's "Sharing &
// Permissions" row TOASTED instead of opening anything (audit Medium #14): the
// host it was rendered from had no `onRequestShare` to pass, and there was no
// neutral component it could mount itself. One entry point with one prop shape
// means any host can open the right dialog for any container, and the row never
// has to apologise.
//
// WHAT IS DELIBERATELY NOT DONE HERE. The three bodies keep their own
// implementations for now: the Space body has the visibility tri-state plus
// People / Departments / Offices tabs, the List body has the tri-state, and the
// Folder body has the Restricted switch this stage added. Merging their
// internals into one list with one grant vocabulary is the access unit's own
// step 5 and lands with `AccessGrant`; collapsing the CALL SITES first is what
// lets every menu row work in the meantime, and it means the merge has exactly
// one consumer to satisfy.

import { WhoHasAccess } from "./who-has-access";
import { ShareSpaceDialog } from "@/components/layout/os/share-space-dialog";
import { ShareBoardDialog } from "@/components/layout/os/share-board-dialog";
import { ShareFolderDialog } from "@/components/layout/os/share-folder-dialog";

export type ShareKind = "space" | "folder" | "list";

export interface ShareTarget {
  kind: ShareKind;
  id: string;
  name: string;
  /** PRIVATE reads as "Restricted"; WORKSPACE as "Inherits". Spaces and Lists only today. */
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  /** Named in the "inherits from" line on a Folder and a List. */
  parentSpaceName?: string | null;
}

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget | null;
  /** Fired after any grant or visibility write, so the host can refetch. */
  onChanged?: () => void;
  /**
   * The viewer cannot change access. Renders `WhoHasAccess` instead of the
   * write body: "Who has access" used to be a label on the Share button and
   * nothing more, so a reader was shown the Restricted switch, the Add-people
   * picker and a role select that all answer 403 (access model, read-only
   * rule: the control is absent, never disabled and never present-then-403).
   */
  readOnly?: boolean;
}

export function ShareDialog({ open, onOpenChange, target, onChanged, readOnly = false }: ShareDialogProps) {
  if (!target) return null;

  if (readOnly) {
    return <WhoHasAccess open={open} onOpenChange={onOpenChange} target={target} />;
  }

  if (target.kind === "space") {
    return (
      <ShareSpaceDialog
        open={open}
        onOpenChange={onOpenChange}
        spaceId={target.id}
        spaceName={target.name}
        initialVisibility={target.visibility ?? "WORKSPACE"}
        onChanged={onChanged}
      />
    );
  }

  if (target.kind === "folder") {
    return (
      <ShareFolderDialog
        open={open}
        onOpenChange={onOpenChange}
        folderId={target.id}
        folderName={target.name}
        initialVisibility={target.visibility ?? "WORKSPACE"}
        parentSpaceName={target.parentSpaceName ?? null}
        onChanged={onChanged}
      />
    );
  }

  return (
    <ShareBoardDialog
      open={open}
      onOpenChange={onOpenChange}
      boardId={target.id}
      boardName={target.name}
      initialVisibility={target.visibility ?? "WORKSPACE"}
      parentSpaceName={target.parentSpaceName ?? ""}
      onChanged={onChanged}
    />
  );
}
