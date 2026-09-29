"use client";

// ShareButton: the one Share control in a title row, for any node.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 3 (Deleted:
// `space-share-button.tsx`, `board-share-button.tsx`, `share-board-button.tsx`;
// "one `ShareButton` reading `useAccess` replaces the three") and section 2,
// where every detail route's title row carries a Share ghost button that reads
// "Who has access" for viewers below Full access.
//
// READ-ONLY IS A LABEL, NOT A DISABLED BUTTON (access model, the read-only
// rule): a viewer below Full access still opens the dialog, and it reads "Who
// has access" rather than pretending the control is broken.
//
// THE PAGE UNDER IT UPDATES (problem 48). The Space and Folder pages are
// server-rendered: their member counts, their Restricted lock and their
// visibility come from the server, so after any change the dialog agreed to
// this refreshes the route, unless the host says it refetches on its own.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { ShareDialog, type ShareTarget } from "./share-dialog";
import type { AccessPanel } from "@/lib/access/access-panel";

interface Props {
  target: ShareTarget;
  /** Full access on this node (Can edit on a doc). Below that the label changes. */
  canManage?: boolean;
  onChanged?: (panel: AccessPanel | null) => void;
  /** Refresh the server-rendered route after every change (default on). */
  refreshOnChange?: boolean;
  /** The button's word when the viewer manages access (default "Share"). */
  label?: string;
  className?: string;
}

export function ShareButton({ target, canManage = true, onChanged, refreshOnChange = true, label: manageLabel = "Share", className }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const label = canManage ? manageLabel : "Who has access";
  const Icon = canManage ? UserPlus : Users;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "os-chrome inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
        }
        aria-haspopup="dialog"
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
      {/* The label and the BODY move together: the dialog opens read-only
          exactly when the label says "Who has access". */}
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        target={target}
        readOnly={!canManage}
        onChanged={(panel) => {
          onChanged?.(panel);
          if (refreshOnChange) router.refresh();
        }}
      />
    </>
  );
}
