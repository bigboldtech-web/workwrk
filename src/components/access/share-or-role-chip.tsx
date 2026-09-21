"use client";

// ShareOrRoleChip (access-model 5.4 as one component): the Share ghost button
// for a viewer who can manage access (Full access, or Can edit under toggle
// 4), and the role chip ("Can edit" / "Can comment" / "Can view") for
// everyone else. Both open the same door: Share opens the dialog in write
// mode, the chip opens it read-only ("Who has access").
//
// The dialog itself is whatever the object has today: the one ShareDialog for
// containers, the doc's own restyled modal until the access flip (step 6 of
// spec-docs-knowledge section 4). The caller passes `onOpen(mode)`; this
// component owns only the rule of WHICH control renders.

import { Share2 } from "lucide-react";
import { OBJECT_ROLE_LABEL } from "@/lib/access/labels";
import type { ObjectRole } from "@/lib/access/types";
import { cn } from "@/lib/utils";

export type ShareChipRole = ObjectRole | "none";

/** The one rule: Full access shares; Can edit shares only under toggle 4. */
export function canShareWithRole(role: ShareChipRole, editorsCanShare = false): boolean {
  if (role === "FULL") return true;
  if (role === "EDIT") return editorsCanShare;
  return false;
}

export function ShareOrRoleChip({
  role,
  editorsCanShare = false,
  onOpen,
  className,
}: {
  role: ShareChipRole;
  editorsCanShare?: boolean;
  /** "share" = the write dialog; "who" = the read-only Who has access body. */
  onOpen: (mode: "share" | "who") => void;
  className?: string;
}) {
  const canShare = canShareWithRole(role, editorsCanShare);
  if (canShare) {
    return (
      <button
        type="button"
        onClick={() => onOpen("share")}
        aria-haspopup="dialog"
        title="Share"
        className={cn("os-chrome inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink", className)}
      >
        <Share2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        Share
      </button>
    );
  }
  const label = role === "none" ? OBJECT_ROLE_LABEL.VIEW : OBJECT_ROLE_LABEL[role];
  return (
    <button
      type="button"
      onClick={() => onOpen("who")}
      aria-haspopup="dialog"
      title="Who has access"
      className={cn("os-chrome inline-flex h-6 shrink-0 items-center rounded-md bg-active px-2 text-xs font-medium text-ink hover:bg-hover", className)}
    >
      {label}
    </button>
  );
}
