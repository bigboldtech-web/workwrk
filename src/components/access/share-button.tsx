"use client";

// ShareButton — the one Share control in a title row, for any container.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 3 (Deleted:
// `space-share-button.tsx`, `board-share-button.tsx`, `share-board-button.tsx`;
// "one `ShareButton` reading `useAccess` replaces the three") and section 2,
// where every detail route's title row carries "Share ghost button (reads
// 'Can view' / 'Can comment' / 'Can edit' as a chip for viewers below Full
// access without toggle 4 and opens 'Who has access')".
//
// Three buttons existed because three dialogs existed, and each one hard-coded
// the id prop name of exactly one object kind. With one `ShareDialog` there is
// one button, and a surface that gains a new container kind gets Share for
// free instead of a fourth copy.
//
// READ-ONLY IS A LABEL, NOT A DISABLED BUTTON (access model, the read-only
// rule): a viewer below Full access still opens the dialog, and it reads "Who
// has access" rather than pretending the control is broken.

import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { ShareDialog, type ShareTarget } from "./share-dialog";

interface Props {
  target: ShareTarget;
  /** Full access (or Can edit under toggle 4). Below that the label changes. */
  canManage?: boolean;
  onChanged?: () => void;
  className?: string;
}

export function ShareButton({ target, canManage = true, onChanged, className }: Props) {
  const [open, setOpen] = useState(false);
  const label = canManage ? "Share" : "Who has access";
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
      {/* The label and the BODY move together now. They did not: both branches
          opened the identical write dialog, so "Who has access" handed a reader
          every control their role cannot commit. */}
      <ShareDialog open={open} onOpenChange={setOpen} target={target} onChanged={onChanged} readOnly={!canManage} />
    </>
  );
}
