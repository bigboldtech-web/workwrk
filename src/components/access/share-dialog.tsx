"use client";

// ShareDialog: one door for "who can open this", whatever "this" is.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 0 (`ShareSpaceDialog`,
// `ShareBoardDialog`, `ShareFolderDialog` become one `ShareDialog`) and the
// access decisions A1 and A7: ONE Manage access dialog, the same for all seven
// kinds (Space, Folder, List, doc with its sub-pages, table, canvas, form).
//
// Three dialogs meant three call shapes, and every host had to know which one
// it wanted and what props that one took; that is why the sidebar List menu's
// "Sharing & Permissions" row once toasted instead of opening anything. One
// entry point with one prop shape means any host opens the right dialog for
// any node, and the body is now the same body for every kind:
// ManageAccessDialog, which reads GET /api/access/<kind>/<id> and writes
// people through its grants route. The three container bodies, the table and
// form share dialog and the doc popover stay exported for their own files'
// pieces (the visibility controls, the Restricted switch, the public links),
// which the one dialog composes; nothing mounts them any more.
//
// `visibility` and `parentSpaceName` stay on the target so no host changes:
// the dialog reads the truth from the server rather than from a prop that
// could be stale.

import { ManageAccessDialog } from "./manage-access-dialog";
import type { AccessPanel } from "@/lib/access/access-panel";

export type ShareKind = "space" | "folder" | "list" | "doc" | "table" | "canvas" | "form";

export interface ShareTarget {
  kind: ShareKind;
  id: string;
  name: string;
  /** PRIVATE reads as "Restricted"; WORKSPACE as "Inherits". The dialog reads the server's value. */
  visibility?: "PRIVATE" | "WORKSPACE" | "ORG";
  /** Named in the "inherits from" line on a Folder and a List. The dialog reads the server's name. */
  parentSpaceName?: string | null;
}

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget | null;
  /**
   * Fired after any grant or general-access write, with the host node's fresh
   * panel (null when the viewer lost access to it), so the host can refetch or
   * adopt a changed field. A host passing a no-argument callback still compiles.
   */
  onChanged?: (panel: AccessPanel | null) => void;
  /**
   * The viewer cannot change access to the node the host opened: the dialog
   * reads "Who has access" and renders no control (the access model's
   * read-only rule: absent, never disabled, never present-then-403). After a
   * "Manage in <name>" door the dialog follows what the server says instead.
   */
  readOnly?: boolean;
}

export function ShareDialog({ open, onOpenChange, target, onChanged, readOnly = false }: ShareDialogProps) {
  if (!target) return null;
  return (
    <ManageAccessDialog
      open={open}
      onOpenChange={onOpenChange}
      target={{ kind: target.kind, id: target.id, name: target.name }}
      readOnly={readOnly}
      onChanged={onChanged}
    />
  );
}
